using System.Diagnostics;
using DaxExplorer.Helper.Discovery;
using DaxExplorer.Helper.Model;
using DaxExplorer.Helper.Server;
using Microsoft.AnalysisServices.AdomdClient;

// DAX Execution Explorer helper.
//   (no arguments)        start the local helper, serve the app and open it in the browser
//   --port <n>            listen on another loopback port (default 5092)
//   --app <folder>        folder with the built app (default: the repository's dist folder)
//   --no-browser          don't open the browser
//   describe [port]       print what the helper finds in Power BI Desktop, then exit

if (args is ["describe", ..])
{
    return Describe(args.Length > 1 && int.TryParse(args[1], out var describePort) ? describePort : null);
}

var port = HelperServer.DefaultPort;
string? appPath = null;
var openBrowser = true;
for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--port" when i + 1 < args.Length && int.TryParse(args[i + 1], out var p) && p is > 0 and <= 65535:
            port = p;
            i++;
            break;
        case "--app" when i + 1 < args.Length:
            appPath = Path.GetFullPath(args[++i]);
            break;
        case "--no-browser":
            openBrowser = false;
            break;
        default:
            Console.Error.WriteLine($"Unknown option: {args[i]}");
            return 2;
    }
}

// A fixed token can be supplied for development (the Vite dev server forwards it); otherwise a new random one.
var token = Environment.GetEnvironmentVariable("DAXEXPLORER_HELPER_TOKEN") is { Length: >= 16 } devToken
    ? devToken
    : TokenGuard.NewToken();
appPath ??= HelperServer.FindAppPath(AppContext.BaseDirectory);

var app = HelperServer.Build(new HelperOptions(port, appPath, token));
var url = $"http://127.0.0.1:{port}/#token={token}";

app.Lifetime.ApplicationStarted.Register(() =>
{
    Console.WriteLine();
    Console.WriteLine("DAX Execution Explorer helper is running (this computer only).");
    Console.WriteLine($"Open the app: {url}");
    Console.WriteLine(appPath is null ? "Note: the app has not been built yet; run 'npm run build' first." : $"Serving the app from: {appPath}");
    Console.WriteLine("Press Ctrl+C to stop.");
    if (openBrowser)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Console.WriteLine("Could not open the browser automatically; use the link above.");
        }
    }
});

try
{
    app.Run();
    return 0;
}
catch (IOException ex) when (ex.InnerException is System.Net.Sockets.SocketException || ex.Message.Contains("address already in use", StringComparison.OrdinalIgnoreCase))
{
    Console.Error.WriteLine($"Port {port} is already in use. Start the helper with --port <another port>.");
    return 3;
}

static int Describe(int? requestedPort)
{
    var instances = DesktopDiscovery.CreateDefault().Find();
    Console.WriteLine($"Power BI Desktop instances: {instances.Count}");
    foreach (var instance in instances)
    {
        Console.WriteLine($"  port {instance.Port}  report: {instance.ReportName ?? "(unknown)"}  engine pid: {instance.EngineProcessId}");
    }

    var target = requestedPort is { } rp
        ? instances.FirstOrDefault(i => i.Port == rp)
        : instances.Count == 1 ? instances[0] : null;
    if (target is null)
    {
        Console.WriteLine(instances.Count == 0
            ? "Open a report in Power BI Desktop and try again."
            : "Several instances are open: run 'describe <port>' to choose one.");
        return instances.Count == 0 ? 1 : 2;
    }

    using var connection = new AdomdConnection(ModelReader.DesktopConnectionString(target.Port));
    connection.Open();
    var model = ModelReader.Read(connection);

    Console.WriteLine($"\nModel of '{target.ReportName ?? "(unknown report)"}'");
    Console.WriteLine($"Tables ({model.Tables.Count}): {string.Join(", ", model.Tables.Select(t => t.Name))}");
    Console.WriteLine($"Columns ({model.Columns.Count}):");
    foreach (var c in model.Columns) Console.WriteLine($"  '{c.Table}'[{c.Name}]  {c.DataType}  {c.Kind}{(c.IsHidden ? "  (hidden)" : "")}");
    Console.WriteLine($"Measures ({model.Measures.Count}):");
    foreach (var m in model.Measures) Console.WriteLine($"  [{m.Name}] (home table {m.Table}) = {m.Expression}");
    Console.WriteLine($"Relationships ({model.Relationships.Count}):");
    foreach (var r in model.Relationships)
    {
        Console.WriteLine($"  '{r.FromTable}'[{r.FromColumn}] ({r.FromCardinality}) -> '{r.ToTable}'[{r.ToColumn}] ({r.ToCardinality})  {(r.IsActive ? "active" : "inactive")}, {r.CrossFilteringBehavior}");
    }
    return 0;
}
