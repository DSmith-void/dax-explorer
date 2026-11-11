using System.Diagnostics;
using DaxExplorer.Helper;
using DaxExplorer.Helper.Discovery;
using DaxExplorer.Helper.Model;
using DaxExplorer.Helper.Server;
using Microsoft.AnalysisServices.AdomdClient;

// DAX Execution Explorer helper.
//   (no arguments)        start the local helper, serve the app and open it in the browser
//   --port <n>            listen on this loopback port (default 5092, or a free one if 5092 is taken)
//   --app <folder>        folder with the built app (default: "app" next to the program, else the repo's dist)
//   --no-browser          don't open the browser
//   describe [port]       print what the helper finds in Power BI Desktop, then exit
//   "localhost:<port>" "<database>"
//                         started from Power BI's External Tools ribbon: connect to that report right away
//   --install-external-tool / --remove-external-tool
//                         add or remove the External Tools button (needs administrator rights; the app runs
//                         these for you, after Windows asks)

if (args is ["describe", ..])
{
    return Describe(args.Length > 1 && int.TryParse(args[1], out var describePort) ? describePort : null);
}

if (args is [ExternalTool.InstallArgument] or [ExternalTool.RemoveArgument])
{
    try
    {
        if (args[0] == ExternalTool.InstallArgument) ExternalTool.Install(ExternalTool.DefaultFolder, Environment.ProcessPath!, ExternalTool.IconBase64());
        else ExternalTool.Remove(ExternalTool.DefaultFolder);
        return 0;
    }
    catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
    {
        Console.Error.WriteLine($"Could not change Power BI's External Tools: {ex.Message}");
        return 5;
    }
}

// Started from Power BI's External Tools ribbon: "localhost:<port>" "<database>" come first.
var launch = ExternalTool.ParseLaunch(args);
if (launch is not null) args = args.Skip(args.Length > 1 && !args[1].StartsWith("--", StringComparison.Ordinal) ? 2 : 1).ToArray();

var port = HelperServer.DefaultPort;
var portChosen = false;
string? appPath = null;
var openBrowser = true;
for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--port" when i + 1 < args.Length && int.TryParse(args[i + 1], out var p) && p is > 0 and <= 65535:
            port = p;
            portChosen = true;
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

// If the usual port is taken (for example DAX Explorer is already running), let Windows pick a free one,
// unless a port was chosen explicitly.
if (!portChosen && !HelperServer.IsPortFree(port)) port = 0;

var app = HelperServer.Build(new HelperOptions(port, appPath, token));
var url = "";

app.Lifetime.ApplicationStarted.Register(() =>
{
    // From the External Tools ribbon: connect to that report first, so the app opens already connected
    // (the person chose this report by clicking the button in it).
    if (launch is { } from)
    {
        var services = app.Services;
        var outcome = Endpoints.ConnectToDesktop(
            from.Port,
            services.GetRequiredService<IDesktopInstances>(),
            services.GetRequiredService<IModelSource>(),
            services.GetRequiredService<ConnectionState>(),
            services.GetRequiredService<CaptureState>(),
            services.GetRequiredService<ILogger<ConnectionState>>());
        Console.WriteLine(outcome == Endpoints.ConnectOutcome.Connected
            ? "Opened from Power BI: connected to the report."
            : "Opened from Power BI, but the report could not be read yet; connect from the data button in the app.");
    }

    var address = app.Urls.FirstOrDefault() ?? $"http://127.0.0.1:{port}";
    url = $"{address.TrimEnd('/')}/#token={token}";
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
    return StartupFailed($"Port {port} is already in use. Close the program using it, or start DAX Explorer with --port <another port>.", 3);
}
catch (Exception ex) when (ex is not OutOfMemoryException)
{
    return StartupFailed($"DAX Explorer could not start: {ex.Message}", 4);
}

// Shows a startup error. When DAX Explorer was double-clicked, Windows created a console window just for it,
// and that window would close the moment the program exits; keep it open so the message can be read.
static int StartupFailed(string message, int exitCode)
{
    Console.Error.WriteLine();
    Console.Error.WriteLine(message);
    if (ConsoleWindow.IsOwnedOnlyByThisProcess())
    {
        Console.Error.WriteLine();
        Console.Error.WriteLine("Press any key to close this window.");
        Console.ReadKey(intercept: true);
    }
    return exitCode;
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
