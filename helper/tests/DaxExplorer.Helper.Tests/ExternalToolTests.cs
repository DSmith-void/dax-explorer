using System.Text.Json;
using DaxExplorer.Helper.Server;
using Xunit;

namespace DaxExplorer.Helper.Tests;

public sealed class ExternalToolTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "DaxExplorerToolTests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_folder)) Directory.Delete(_folder, recursive: true);
    }

    [Theory]
    [InlineData("localhost:51234", "a1b2c3", 51234, "a1b2c3")]
    [InlineData("LOCALHOST:5000", null, 5000, null)]
    [InlineData("127.0.0.1:61000", "db", 61000, "db")]
    public void Reads_the_report_Power_BI_passes_when_started_from_the_ribbon(string server, string? database, int port, string? expectedDatabase)
    {
        var args = database is null ? new[] { server } : new[] { server, database };
        Assert.Equal((port, expectedDatabase), ExternalTool.ParseLaunch(args));
    }

    [Theory]
    [InlineData("--port")]
    [InlineData("describe")]
    [InlineData("example.com:51234")] // never a remote server
    [InlineData("localhost:99999")]
    [InlineData("localhost")]
    public void Ignores_anything_else(string first) => Assert.Null(ExternalTool.ParseLaunch([first, "x"]));

    [Fact]
    public void Writes_a_pbitool_file_that_starts_this_program_with_the_report()
    {
        ExternalTool.Install(_folder, @"C:\Tools\DaxExplorer.exe", "iVBOR");
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(_folder, ExternalTool.FileName)));
        var root = json.RootElement;
        Assert.Equal("1.0", root.GetProperty("version").GetString());
        Assert.Equal("DAX Explorer", root.GetProperty("name").GetString());
        Assert.Equal(@"C:\Tools\DaxExplorer.exe", root.GetProperty("path").GetString());
        Assert.Equal("\"%server%\" \"%database%\"", root.GetProperty("arguments").GetString());
        Assert.Equal("data:image/png;base64,iVBOR", root.GetProperty("iconData").GetString());

        Assert.Equal((true, true), ExternalTool.Status(_folder, @"C:\Tools\DaxExplorer.exe"));
        Assert.Equal((true, false), ExternalTool.Status(_folder, @"D:\Elsewhere\DaxExplorer.exe")); // installed, but for another copy
        ExternalTool.Remove(_folder);
        Assert.Equal((false, false), ExternalTool.Status(_folder, @"C:\Tools\DaxExplorer.exe"));
    }

    [Fact]
    public void Ships_its_ribbon_icon()
    {
        var icon = ExternalTool.IconBase64();
        Assert.NotNull(icon);
        Assert.StartsWith("iVBOR", icon); // PNG
    }
}
