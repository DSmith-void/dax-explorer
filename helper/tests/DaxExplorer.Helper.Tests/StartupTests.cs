using System.Net;
using System.Net.Sockets;
using DaxExplorer.Helper.Server;

namespace DaxExplorer.Helper.Tests;

public sealed class StartupTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "daxexplorer-startup-" + Guid.NewGuid().ToString("N"));

    public StartupTests() => Directory.CreateDirectory(_root);

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private void CreateApp(string folder)
    {
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "index.html"), "<!doctype html>");
    }

    [Fact]
    public void Finds_the_app_folder_next_to_the_packaged_program()
    {
        var exeFolder = Path.Combine(_root, "DaxExplorer");
        CreateApp(Path.Combine(exeFolder, "app"));
        Assert.Equal(Path.Combine(exeFolder, "app"), HelperServer.FindAppPath(exeFolder));
    }

    [Fact]
    public void Finds_the_repository_build_when_run_from_source()
    {
        File.WriteAllText(Path.Combine(_root, "package.json"), "{}");
        CreateApp(Path.Combine(_root, "dist"));
        var binFolder = Path.Combine(_root, "helper", "src", "bin", "Debug");
        Directory.CreateDirectory(binFolder);
        Assert.Equal(Path.Combine(_root, "dist"), HelperServer.FindAppPath(binFolder));
    }

    [Fact]
    public void Returns_null_when_there_is_no_built_app() => Assert.Null(HelperServer.FindAppPath(_root));

    [Fact]
    public void Detects_whether_a_loopback_port_is_free()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var taken = ((IPEndPoint)listener.LocalEndpoint).Port;
            Assert.False(HelperServer.IsPortFree(taken));
        }
        finally
        {
            listener.Stop();
        }
    }
}
