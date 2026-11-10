using DaxExplorer.Helper.Model;

namespace DaxExplorer.Helper.Server;

/// <summary>What the app is currently connected to.</summary>
/// <param name="IsSample">True when connected to DAX Explorer's own sample report (Initech).</param>
public sealed record ConnectionInfo(string Source, int Port, string? ReportName, DateTimeOffset ConnectedAt, bool IsSample = false);

/// <summary>
/// The current connection and its model metadata. In memory only: nothing about the
/// connected model is ever written to disk or logged.
/// </summary>
public sealed class ConnectionState
{
    private readonly Lock _lock = new();
    private ConnectionInfo? _connection;
    private ModelMetadata? _model;

    public (ConnectionInfo? Connection, ModelMetadata? Model) Current
    {
        get
        {
            lock (_lock) return (_connection, _model);
        }
    }

    public void Set(ConnectionInfo connection, ModelMetadata model)
    {
        lock (_lock)
        {
            _connection = connection;
            _model = model;
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _connection = null;
            _model = null;
        }
    }
}
