using System.IO.Pipes;
using System.Security.Principal;
using System.Text.Json;

namespace DaxExplorer.Helper.Server;

/// <summary>
/// What a second start of DAX Explorer asks the one already running to do: open the app in the browser,
/// connecting first to a Power BI Desktop report when started from its External Tools ribbon.
/// </summary>
public sealed record InstanceRequest(int? ConnectPort = null, string? Database = null);

/// <summary>The running DAX Explorer's answer.</summary>
public sealed record InstanceReply(bool Ok, string? Message = null);

/// <summary>
/// Only one DAX Explorer runs per Windows user. The first one to start owns a named mutex and listens on a
/// named pipe that only the same Windows user can open; a later start sends its request there and exits.
/// Nothing secret travels over the pipe (the running one opens the browser with its own token).
/// </summary>
public static class SingleInstance
{
    private const int MaxMessageBytes = 4096;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>A name unique to this Windows user (pipes are visible machine-wide; the mutex per session).</summary>
    public static string NameForCurrentUser()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return $"DaxExplorer-{identity.User?.Value ?? Environment.UserName}";
    }

    /// <summary>
    /// Claims "the running DAX Explorer" for this user. Returns the held mutex (keep it alive and dispose it
    /// on exit), or null when another DAX Explorer already holds it.
    /// </summary>
    public static Mutex? TryClaim(string name)
    {
        var mutex = new Mutex(initiallyOwned: true, $@"Local\{name}", out var createdNew);
        if (createdNew) return mutex;
        mutex.Dispose();
        return null;
    }

    public static byte[] Encode<T>(T message) => JsonSerializer.SerializeToUtf8Bytes(message, Json);

    public static T? Decode<T>(ReadOnlySpan<byte> bytes) where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(bytes, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Sends <paramref name="request"/> to the running DAX Explorer. It may still be starting, so this
    /// waits up to <paramref name="timeout"/> for it to listen. Null when nobody answered.
    /// </summary>
    public static async Task<InstanceReply?> SendAsync(string pipeName, InstanceRequest request, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await pipe.ConnectAsync(cts.Token);
            pipe.ReadMode = PipeTransmissionMode.Message;
            await pipe.WriteAsync(Encode(request), cts.Token);
            pipe.WaitForPipeDrain();
            return Decode<InstanceReply>(await ReadMessageAsync(pipe, cts.Token));
        }
        catch (Exception ex) when (ex is OperationCanceledException or IOException or TimeoutException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// Answers requests from later starts until <paramref name="stop"/> is cancelled, one at a time.
    /// A bad or oversized message gets a "not understood" reply; the listener keeps going.
    /// </summary>
    public static async Task ListenAsync(string pipeName, Func<InstanceRequest, InstanceReply> handle, CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(
                    pipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Message,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(stop);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                var bytes = await ReadMessageAsync(pipe, timeout.Token);
                var request = bytes.Length is > 0 and <= MaxMessageBytes ? Decode<InstanceRequest>(bytes) : null;
                InstanceReply reply;
                try
                {
                    reply = request is null ? new InstanceReply(false, "Request not understood.") : handle(request);
                }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    reply = new InstanceReply(false, "DAX Explorer could not do that.");
                }
                await pipe.WriteAsync(Encode(reply), timeout.Token);
                pipe.WaitForPipeDrain();
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex) when (ex is IOException or OperationCanceledException or TimeoutException)
            {
                // A start that gave up halfway, or a slow one: wait for the next.
            }
        }
    }

    /// <summary>Reads one pipe message (capped: anything longer is cut, which then fails to decode).</summary>
    private static async Task<byte[]> ReadMessageAsync(PipeStream pipe, CancellationToken token)
    {
        using var memory = new MemoryStream();
        var buffer = new byte[1024];
        do
        {
            var read = await pipe.ReadAsync(buffer, token);
            if (read == 0) break;
            if (memory.Length + read > MaxMessageBytes + 1) return [];
            memory.Write(buffer, 0, read);
        }
        while (!pipe.IsMessageComplete);
        return memory.ToArray();
    }
}
