using System.Collections.Concurrent;
using System.Data;
using System.Diagnostics;
using DaxExplorer.Helper.Model;
using Microsoft.AnalysisServices;
using Microsoft.AnalysisServices.AdomdClient;
using AmoServer = Microsoft.AnalysisServices.Server;
using AmoTrace = Microsoft.AnalysisServices.Trace;

namespace DaxExplorer.Helper.Server;

/// <summary>One storage-engine scan (or a scan answered from the cache).</summary>
/// <param name="Text">The scan in the engine's own query language (xmSQL).</param>
/// <param name="StartMs">Start, in milliseconds after the query started (null when the engine didn't say).</param>
public sealed record TimingScan(string Text, long? DurationMs, long? CpuMs, double? StartMs, double? EndMs, bool FromCache);

/// <summary>What the engine reported for one query. Everything here comes from the engine's trace.</summary>
public sealed record TimingResult(long TotalMs, long? TotalCpuMs, IReadOnlyList<TimingScan> Scans, long Rows, bool ClearedCache);

/// <summary>Runs a query while tracing it, to see where its time goes. Abstracted for tests.</summary>
public interface ITimingSource
{
    /// <exception cref="TimingUnavailableException">The trace could not be started, or its events never came.</exception>
    TimingResult Measure(int port, string database, string query, bool clearCache, TimeSpan timeout);
}

public sealed class TimingUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Server timings with a short trace on the connected report, limited to DAX Explorer's own connection (by
/// session). The trace starts, a tiny "ping" query waits until its events arrive (they come late, about
/// two seconds), then the query runs; its events are matched by its text and a request id not seen before.
/// The trace is always removed afterwards. Nothing is logged.
/// </summary>
internal sealed class AmoTimingSource : ITimingSource
{
    private const string Prefix = "DaxExplorerTimings_";
    private static readonly Lock OneAtATime = new();

    public TimingResult Measure(int port, string database, string query, bool clearCache, TimeSpan timeout)
    {
        lock (OneAtATime)
        {
            using var connection = new AdomdConnection(ModelReader.DesktopConnectionString(port));
            connection.Open();
            connection.ChangeDatabase(database);
            var session = connection.SessionID;

            using var server = new AmoServer();
            server.Connect($"Data Source=localhost:{port}");
            RemoveLeftovers(server);

            var events = new ConcurrentQueue<TraceEventArgs>();
            AmoTrace trace;
            try
            {
                trace = server.Traces.Add($"{Prefix}{Guid.NewGuid():N}");
                // Exactly the columns each event has (asking for others makes the engine refuse the trace).
                TraceColumn[] common = [TraceColumn.EventClass, TraceColumn.TextData, TraceColumn.SessionID, TraceColumn.RequestID];
                TraceColumn[] timed = [TraceColumn.EventSubclass, TraceColumn.Duration, TraceColumn.CpuTime, TraceColumn.StartTime, TraceColumn.EndTime];
                Add(trace, TraceEventClass.QueryEnd, [.. common, .. timed]);
                Add(trace, TraceEventClass.VertiPaqSEQueryEnd, [.. common, .. timed]);
                Add(trace, TraceEventClass.VertiPaqSEQueryCacheMatch, [.. common, TraceColumn.EventSubclass]);
                trace.OnEvent += (_, e) =>
                {
                    if (e.SessionID == session) events.Enqueue(e);
                };
                trace.Update();
                trace.Start();
            }
            catch (Exception ex) when (ex is OperationException or AmoException)
            {
                throw new TimingUnavailableException("Power BI Desktop did not allow a timing trace.", ex);
            }

            try
            {
                var clock = Stopwatch.StartNew();
                WaitUntilTracing(connection, events, clock, timeout);
                if (clearCache)
                {
                    server.Execute(
                        $"<ClearCache xmlns=\"http://schemas.microsoft.com/analysisservices/2003/engine\"><Object><DatabaseID>{System.Security.SecurityElement.Escape(database)}</DatabaseID></Object></ClearCache>");
                }
                var before = events.Where(e => e.EventClass == TraceEventClass.QueryEnd).Select(e => e.RequestID).ToHashSet();
                var rows = Run(connection, query, timeout);
                var end = WaitFor(
                    () => events.FirstOrDefault(e => e.EventClass == TraceEventClass.QueryEnd && SameText(e.TextData, query) && !before.Contains(e.RequestID)),
                    clock,
                    timeout) ?? throw new TimingUnavailableException("The query ran, but its timings never arrived from Power BI Desktop.");
                // Scans can be reported a moment after the query's end.
                Thread.Sleep(200);
                return Build(end, events.Where(e => e.RequestID == end.RequestID).ToList(), rows, clearCache);
            }
            finally
            {
                try
                {
                    if (trace.IsStarted) trace.Stop();
                }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                }
                try
                {
                    trace.Drop();
                }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    // Left for the next run to remove (see RemoveLeftovers); it also goes when Desktop closes.
                }
            }
        }
    }

    internal static TimingResult Build(TraceEventArgs end, IReadOnlyList<TraceEventArgs> events, long rows, bool clearedCache)
    {
        var start = Try(() => end.StartTime);
        double? Offset(DateTime? at) => at is { } t && start is { } s ? (t - s).TotalMilliseconds : null;
        var scans = new List<TimingScan>();
        foreach (var e in events)
        {
            if (e.EventClass == TraceEventClass.VertiPaqSEQueryEnd)
            {
                // "Internal" scans are the engine's own copies of the scans below: counting them would count twice.
                if (Try(() => e.EventSubclass) == TraceEventSubclass.VertiPaqScanInternal) continue;
                scans.Add(new TimingScan(e.TextData ?? "", Try(() => e.Duration), Try(() => e.CpuTime), Offset(Try(() => e.StartTime)), Offset(Try(() => e.EndTime)), false));
            }
            else if (e.EventClass == TraceEventClass.VertiPaqSEQueryCacheMatch)
            {
                scans.Add(new TimingScan(e.TextData ?? "", null, null, null, null, true));
            }
        }
        return new TimingResult(Try(() => end.Duration) ?? 0, Try(() => end.CpuTime), scans, rows, clearedCache);
    }

    private static T? Try<T>(Func<T> read) where T : struct
    {
        try
        {
            return read();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return null;
        }
    }

    private static void Add(AmoTrace trace, TraceEventClass eventClass, TraceColumn[] columns)
    {
        var traceEvent = trace.Events.Add(eventClass);
        foreach (var column in columns) traceEvent.Columns.Add(column);
    }

    private static void RemoveLeftovers(AmoServer server)
    {
        foreach (var leftover in server.Traces.Cast<AmoTrace>().Where(t => t.Name.StartsWith(Prefix, StringComparison.Ordinal)).ToList())
        {
            try
            {
                if (leftover.IsStarted) leftover.Stop();
                leftover.Drop();
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                // Best effort.
            }
        }
    }

    /// <summary>Trace events only start arriving a moment after the trace starts: ping until one does.</summary>
    private static void WaitUntilTracing(AdomdConnection connection, ConcurrentQueue<TraceEventArgs> events, Stopwatch clock, TimeSpan timeout)
    {
        var ping = Guid.NewGuid().ToString("N");
        var ready = false;
        while (!ready && clock.Elapsed < timeout)
        {
            Run(connection, $"EVALUATE {{ \"{ping}\" }}", timeout);
            var until = clock.Elapsed + TimeSpan.FromMilliseconds(250);
            while (!ready && clock.Elapsed < until)
            {
                Thread.Sleep(10);
                ready = events.Any(e => e.EventClass == TraceEventClass.QueryEnd && (e.TextData ?? "").Contains(ping, StringComparison.Ordinal));
            }
        }
        if (!ready) throw new TimingUnavailableException("Power BI Desktop's timing trace did not start in time.");
    }

    private static TraceEventArgs? WaitFor(Func<TraceEventArgs?> find, Stopwatch clock, TimeSpan timeout)
    {
        TraceEventArgs? found;
        while ((found = find()) is null && clock.Elapsed < timeout) Thread.Sleep(20);
        return found;
    }

    private static bool SameText(string? reported, string query) =>
        string.Equals(Normalize(reported), Normalize(query), StringComparison.Ordinal);

    private static string Normalize(string? text) => (text ?? "").Replace("\r\n", "\n", StringComparison.Ordinal).Trim();

    /// <summary>Runs the query and reads every row (the engine finishes the query only once they are read).</summary>
    private static long Run(AdomdConnection connection, string query, TimeSpan timeout)
    {
        using var command = new AdomdCommand(query, connection) { CommandTimeout = (int)timeout.TotalSeconds };
        using var reader = command.ExecuteReader(CommandBehavior.SequentialAccess);
        long rows = 0;
        while (reader.Read()) rows++;
        return rows;
    }
}
