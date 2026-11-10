using System.Text;
using DaxExplorer.Helper.Discovery;

namespace DaxExplorer.Helper.Tests;

/// <summary>Discovery against a fake workspace folder tree; no Power BI needed.</summary>
public sealed class DesktopDiscoveryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "daxexplorer-tests-" + Guid.NewGuid().ToString("N"));

    public DesktopDiscoveryTests() => Directory.CreateDirectory(_root);

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string Workspace(string name, string? portFileContent)
    {
        var dir = Path.Combine(_root, name);
        Directory.CreateDirectory(Path.Combine(dir, "Data"));
        if (portFileContent is not null)
        {
            File.WriteAllBytes(Path.Combine(dir, "Data", "msmdsrv.port.txt"), Encoding.Unicode.GetBytes(portFileContent));
        }
        return dir;
    }

    [Fact]
    public void Returns_only_engines_that_are_listening()
    {
        var live = Workspace("AnalysisServicesWorkspace_live", "1111");
        Workspace("AnalysisServicesWorkspace_stale", "2222"); // left behind by a crashed Desktop
        var discovery = new DesktopDiscovery([_root], port => port == 1111 ? new ListenerOwner(42, "Synthetic Sales") : null);

        var instance = Assert.Single(discovery.Find());
        Assert.Equal(new DesktopInstance(1111, live, 42, "Synthetic Sales"), instance);
    }

    [Fact]
    public void Skips_workspaces_without_a_valid_port_file()
    {
        Workspace("no-file", null);
        Workspace("garbage", "not a port");
        var discovery = new DesktopDiscovery([_root], _ => new ListenerOwner(1, "Any"));

        Assert.Empty(discovery.Find());
    }

    [Fact]
    public void Ignores_roots_that_do_not_exist()
    {
        var discovery = new DesktopDiscovery([Path.Combine(_root, "missing")], _ => new ListenerOwner(1, "Any"));
        Assert.Empty(discovery.Find());
    }

    [Fact]
    public void Orders_by_report_name_then_port_with_unknown_names_last()
    {
        Workspace("a", "3000");
        Workspace("b", "1000");
        Workspace("c", "2000");
        var names = new Dictionary<int, string?> { [3000] = "Alpha", [1000] = null, [2000] = "beta" };
        var discovery = new DesktopDiscovery([_root], port => new ListenerOwner(port, names[port]));

        Assert.Equal([3000, 2000, 1000], discovery.Find().Select(i => i.Port));
    }

    [Theory]
    [InlineData("Synthetic Sales - Power BI Desktop", "Synthetic Sales")]
    [InlineData("Untitled - Power BI Desktop", "Untitled")]
    [InlineData("A - B - Power BI Desktop", "A - B")]
    [InlineData("Power BI Desktop", "Power BI Desktop")]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Takes_the_report_name_from_the_window_title(string? title, string? expected) =>
        Assert.Equal(expected, WindowsProcesses.ReportNameFromTitle(title));
}
