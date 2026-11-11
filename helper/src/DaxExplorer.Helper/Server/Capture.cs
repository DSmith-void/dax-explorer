using AmoServer = Microsoft.AnalysisServices.Server;
using AmoTrace = Microsoft.AnalysisServices.Trace;
using TraceColumn = Microsoft.AnalysisServices.TraceColumn;
using TraceEventClass = Microsoft.AnalysisServices.TraceEventClass;

namespace DaxExplorer.Helper.Server;

/// <summary>One query the engine finished, as reported by a trace.</summary>
public sealed record CapturedQueryEvent(string? Text, string? EventSubclass, string? ApplicationName);

/// <summary>A visual's query, captured from Power BI Desktop. Kept in memory only.</summary>
public sealed record CapturedQuery(int Id, DateTimeOffset At, string Text);

/// <summary>Starts a trace on a Power BI Desktop engine. Abstracted so the capture can be tested without Power BI.</summary>
public interface ICaptureSource
{
    /// <summary>Starts listening; disposing the result stops the trace and removes it from the engine.</summary>
    IDisposable Start(int port, Action<CapturedQueryEvent> onQuery);
}

/// <summary>
/// "Capture from Desktop": while listening, keeps the queries Power BI Desktop's visuals send to the
/// connected report's engine. Only after the user presses Capture, only on the connected report, at most
/// <see cref="Duration"/> at a time, the last <see cref="MaxQueries"/> queries, in memory only, never logged.
/// </summary>
public sealed class CaptureState(ICaptureSource source, TimeProvider clock, ILogger<CaptureState> log) : IDisposable
{
    public static readonly TimeSpan Duration = TimeSpan.FromMinutes(5);
    public const int MaxQueries = 50;

    private readonly Lock _lock = new();
    private readonly List<CapturedQuery> _queries = [];
    private IDisposable? _session;
    private ITimer? _timer;
    private DateTimeOffset? _stopsAt;
    private int _nextId = 1;
    private int _seen;

    /// <summary>True for the queries visuals send: DAX queries from Power BI Desktop that build a table of values.</summary>
    public static bool IsVisualQuery(CapturedQueryEvent e) =>
        string.Equals(e.EventSubclass, "DAXQuery", StringComparison.OrdinalIgnoreCase)
        && e.ApplicationName?.StartsWith("Power BI Desktop", StringComparison.OrdinalIgnoreCase) == true
        && e.Text?.Contains("SUMMARIZECOLUMNS", StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>
    /// Starts listening on the engine at this port (stopping any earlier capture first). Stops by itself after
    /// <see cref="Duration"/>, unless <paramref name="untilDisconnect"/> (the "listen while connected" setting).
    /// </summary>
    public void Start(int port, bool untilDisconnect = false)
    {
        Stop();
        var session = source.Start(port, OnQuery); // may throw: the caller reports it
        lock (_lock)
        {
            _queries.Clear();
            _seen = 0;
            _session = session;
            if (!untilDisconnect)
            {
                _stopsAt = clock.GetUtcNow() + Duration;
                _timer = clock.CreateTimer(_ => Stop(), null, Duration, Timeout.InfiniteTimeSpan);
            }
        }
        log.LogInformation("Capture started on port {Port}", port); // no query text in logs, ever
    }

    /// <summary>Stops listening and removes the trace. The captured queries stay readable until the next start.</summary>
    public void Stop()
    {
        IDisposable? session;
        ITimer? timer;
        lock (_lock)
        {
            session = _session;
            timer = _timer;
            _session = null;
            _timer = null;
            _stopsAt = null;
        }
        timer?.Dispose();
        if (session is null) return;
        // Outside the lock: stopping a trace can wait for its event thread, which may be waiting for the lock.
        session.Dispose();
        log.LogInformation("Capture stopped");
    }

    /// <summary>Whether it is listening, until when, and the queries captured after <paramref name="afterId"/>.</summary>
    /// <summary>How many finished queries the trace has reported since the capture started (visual or not): for diagnosing a capture that stays empty.</summary>
    public int Seen { get { lock (_lock) return _seen; } }

    public (bool Listening, DateTimeOffset? StopsAt, IReadOnlyList<CapturedQuery> Queries) Read(int afterId)
    {
        bool expired;
        lock (_lock) expired = _stopsAt is { } stopsAt && clock.GetUtcNow() >= stopsAt;
        if (expired) Stop();
        lock (_lock) return (_session is not null, _stopsAt, _queries.Where(q => q.Id > afterId).ToList());
    }

    private void OnQuery(CapturedQueryEvent e)
    {
        lock (_lock) _seen++;
        if (!IsVisualQuery(e)) return;
        lock (_lock)
        {
            if (_session is null) return;
            _queries.Add(new CapturedQuery(_nextId++, clock.GetUtcNow(), e.Text!));
            if (_queries.Count > MaxQueries) _queries.RemoveRange(0, _queries.Count - MaxQueries);
        }
    }

    public void Dispose() => Stop();
}

/// <summary>A server trace (Microsoft.AnalysisServices) on Power BI Desktop's local engine.</summary>
internal sealed class AmoCaptureSource : ICaptureSource
{
    private const string Prefix = "DaxExplorer_";

    public IDisposable Start(int port, Action<CapturedQueryEvent> onQuery)
    {
        var server = new AmoServer();
        try
        {
            server.Connect($"Data Source=localhost:{port}");
            // A capture left behind by a DAX Explorer that didn't close properly is removed first.
            foreach (var leftover in server.Traces.Cast<AmoTrace>().Where(t => t.Name.StartsWith(Prefix, StringComparison.Ordinal)).ToList())
            {
                try
                {
                    if (leftover.IsStarted) leftover.Stop();
                    leftover.Drop();
                }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    // Best effort: an old trace that can't be removed doesn't stop a new capture.
                }
            }

            var trace = server.Traces.Add($"{Prefix}{Guid.NewGuid():N}");
            var queryEnd = trace.Events.Add(TraceEventClass.QueryEnd);
            queryEnd.Columns.Add(TraceColumn.TextData);
            queryEnd.Columns.Add(TraceColumn.EventSubclass);
            queryEnd.Columns.Add(TraceColumn.ApplicationName);
            queryEnd.Columns.Add(TraceColumn.Duration);
            trace.OnEvent += (_, e) => onQuery(new CapturedQueryEvent(e.TextData, e.EventSubclass.ToString(), e.ApplicationName));
            trace.Update();
            trace.Start();
            return new Session(server, trace);
        }
        catch
        {
            server.Dispose();
            throw;
        }
    }

    private sealed class Session(AmoServer server, AmoTrace trace) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 1) return;
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
            }
            server.Dispose();
        }
    }
}
