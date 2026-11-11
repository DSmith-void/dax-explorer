using DaxExplorer.Helper.Model;
using Microsoft.AnalysisServices.AdomdClient;

namespace DaxExplorer.Helper.Server;

/// <summary>The last command one engine session ran, and the application whose connection owns the session.</summary>
public sealed record SessionCommand(string? Application, DateTime? StartTimeUtc, string? Text);

/// <summary>A visual query found in the engine's session list.</summary>
public sealed record RecentQuery(DateTimeOffset? At, string Text);

/// <summary>Reads the engine's session list. Abstracted so it can be tested without Power BI.</summary>
public interface ISessionCommands
{
    IReadOnlyList<SessionCommand> Read(int port);
}

/// <summary>
/// The visual queries Power BI Desktop ran most recently, from the engine's own session list
/// ($SYSTEM.DISCOVER_SESSIONS: each session's last command). Read-only, nothing is changed or kept.
/// Desktop runs its visuals' queries one after another on one connection, so this is usually the one
/// visual it calculated last (the one just added, changed or filtered).
/// </summary>
public static class RecentVisuals
{
    public static IReadOnlyList<RecentQuery> Pick(IEnumerable<SessionCommand> commands) =>
        commands
            .Where(c => c.Application?.StartsWith("Power BI Desktop", StringComparison.OrdinalIgnoreCase) == true)
            .Where(c => c.Text is { } text && IsDaxVisualQuery(text))
            .OrderByDescending(c => c.StartTimeUtc)
            .Select(c => new RecentQuery(c.StartTimeUtc is { } t ? new DateTimeOffset(DateTime.SpecifyKind(t, DateTimeKind.Utc)) : null, c.Text!))
            .ToList();

    /// <summary>A DAX query (not an XMLA command such as a refresh) that builds a visual's table of values.</summary>
    private static bool IsDaxVisualQuery(string text)
    {
        var start = text.TrimStart();
        return !start.StartsWith('<') && text.Contains("SUMMARIZECOLUMNS", StringComparison.OrdinalIgnoreCase);
    }
}

internal sealed class AdomdSessionCommands : ISessionCommands
{
    public IReadOnlyList<SessionCommand> Read(int port)
    {
        using var connection = new AdomdConnection(ModelReader.DesktopConnectionString(port));
        connection.Open();
        var applications = new Dictionary<long, string?>();
        using (var command = new AdomdCommand("SELECT CONNECTION_ID, CONNECTION_HOST_APPLICATION FROM $SYSTEM.DISCOVER_CONNECTIONS", connection))
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                applications[Convert.ToInt64(reader.GetValue(0), System.Globalization.CultureInfo.InvariantCulture)] = reader.GetValue(1) as string;
            }
        }
        var sessions = new List<SessionCommand>();
        using (var command = new AdomdCommand(
            "SELECT SESSION_CONNECTION_ID, SESSION_LAST_COMMAND_START_TIME, SESSION_LAST_COMMAND FROM $SYSTEM.DISCOVER_SESSIONS", connection))
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                var connectionId = Convert.ToInt64(reader.GetValue(0), System.Globalization.CultureInfo.InvariantCulture);
                sessions.Add(new SessionCommand(
                    applications.GetValueOrDefault(connectionId),
                    reader.GetValue(1) as DateTime?,
                    reader.GetValue(2) as string));
            }
        }
        return sessions;
    }
}
