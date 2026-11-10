namespace DaxExplorer.Helper.Discovery;

/// <summary>A running Power BI Desktop engine that a client can connect to.</summary>
/// <param name="Port">Loopback TCP port of the local Analysis Services engine.</param>
/// <param name="WorkspacePath">Desktop's temporary workspace folder for this engine.</param>
/// <param name="EngineProcessId">Process id of the engine (msmdsrv.exe).</param>
/// <param name="ReportName">The report's name from the Desktop window title, when it can be determined.</param>
public sealed record DesktopInstance(int Port, string WorkspacePath, int EngineProcessId, string? ReportName);

/// <summary>Which process is listening on a port, and the Desktop report it belongs to.</summary>
public sealed record ListenerOwner(int ProcessId, string? ReportName);

/// <summary>
/// Finds running Power BI Desktop engines without admin rights: Desktop writes each engine's
/// port into a file under the user's profile. Only engines that are actually listening are
/// returned, so folders left behind by a crashed Desktop are ignored.
/// </summary>
public sealed class DesktopDiscovery(IReadOnlyList<string> workspaceRoots, Func<int, ListenerOwner?> findListener)
{
    /// <summary>Both known locations: the Microsoft Store version and the installer version.</summary>
    public static IReadOnlyList<string> DefaultWorkspaceRoots() =>
    [
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Microsoft", "Power BI Desktop Store App", "AnalysisServicesWorkspaces"),
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Microsoft", "Power BI Desktop", "AnalysisServicesWorkspaces"),
    ];

    public static DesktopDiscovery CreateDefault() => new(DefaultWorkspaceRoots(), WindowsProcesses.FindListener);

    public IReadOnlyList<DesktopInstance> Find()
    {
        var instances = new List<DesktopInstance>();
        foreach (var root in workspaceRoots)
        {
            if (!Directory.Exists(root)) continue;
            foreach (var workspace in Directory.EnumerateDirectories(root))
            {
                var port = TryReadPort(Path.Combine(workspace, PortFile.RelativePath));
                if (port is null) continue;
                var owner = findListener(port.Value);
                if (owner is null) continue; // stale workspace: nothing is listening on that port
                instances.Add(new DesktopInstance(port.Value, workspace, owner.ProcessId, owner.ReportName));
            }
        }
        return instances
            .OrderBy(i => i.ReportName ?? "￿", StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(i => i.Port)
            .ToList();
    }

    private static int? TryReadPort(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            // Desktop may still hold the file open; allow shared access.
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var buffer = new byte[Math.Min(stream.Length, 64)];
            var read = stream.Read(buffer, 0, buffer.Length);
            return PortFile.Parse(buffer.AsSpan(0, read));
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }
}
