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
//                         (with --port: a developer run; no tray icon and no "only one DAX Explorer")
//   describe [port]       print what the helper finds in Power BI Desktop, then exit
//   "localhost:<port>" "<database>"
//                         started from Power BI's External Tools ribbon: connect to that report right away
//   --install-external-tool / --remove-external-tool
//                         add or remove the External Tools button (needs administrator rights; the app runs
//                         these for you, after Windows asks)

// No console window of its own: DAX Explorer lives in the tray. From a terminal, it writes there.
var terminal = ConsoleWindow.UseParentTerminal();

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

// Only one DAX Explorer per Windows user (developer runs with --port excepted): a later start (a second
// click on Power BI's ribbon, a double-click) hands its request to the running one and exits.
var instanceName = SingleInstance.NameForCurrentUser();
using var running = portChosen ? null : SingleInstance.TryClaim(instanceName);
if (!portChosen && running is null)
{
    var reply = await SingleInstance.SendAsync(instanceName, new InstanceRequest(launch?.Port, launch?.Database), TimeSpan.FromSeconds(20));
    if (reply is null) return StartupFailed("DAX Explorer is already running but did not answer. Quit it from its icon in the taskbar's notification area, then try again.", 6);
    return 0;
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
var autoQuit = new AutoQuit(TimeProvider.System, AutoQuit.DefaultGrace);
if (launch is not null) autoQuit.Arm();
Tray? tray = null;
using var stopping = new CancellationTokenSource();

void OpenBrowser()
{
    if (url.Length == 0) return;
    try
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
    catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
    {
        tray?.Notify("DAX Explorer", "Could not open the browser. Try Open DAX Explorer in the tray menu.");
    }
}

Endpoints.ConnectOutcome ConnectTo(int reportPort)
{
    var services = app.Services;
    return Endpoints.ConnectToDesktop(
        reportPort,
        services.GetRequiredService<IDesktopInstances>(),
        services.GetRequiredService<IModelSource>(),
        services.GetRequiredService<ConnectionState>(),
        services.GetRequiredService<CaptureState>(),
        services.GetRequiredService<ILogger<ConnectionState>>());
}

// A later start's request: connect to the report it came from (ribbon), then open a new tab.
InstanceReply Handle(InstanceRequest request)
{
    string? message = null;
    if (request.ConnectPort is { } reportPort)
    {
        autoQuit.Arm();
        if (ConnectTo(reportPort) != Endpoints.ConnectOutcome.Connected)
        {
            message = "The report could not be read yet; connect from the data button in the app.";
            tray?.Notify("DAX Explorer", message);
        }
    }
    else
    {
        autoQuit.Disarm();
    }
    OpenBrowser();
    return new InstanceReply(true, message);
}

// Started from the ribbon: quit a minute after the last Power BI Desktop closes (with a notice first).
async Task WatchDesktopAsync()
{
    var instances = app.Services.GetRequiredService<IDesktopInstances>();
    using var timer = new PeriodicTimer(AutoQuit.CheckEvery);
    try
    {
        while (await timer.WaitForNextTickAsync(stopping.Token).ConfigureAwait(false))
        {
            if (!autoQuit.Armed) continue;
            int open;
            try
            {
                open = instances.Find().Count;
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                continue;
            }
            switch (autoQuit.Check(open))
            {
                case AutoQuit.Step.Warn:
                    tray?.Notify("Power BI Desktop closed", "DAX Explorer will quit in a minute, unless a report is opened again.");
                    break;
                case AutoQuit.Step.Quit:
                    app.Lifetime.StopApplication();
                    return;
            }
        }
    }
    catch (OperationCanceledException)
    {
        // Stopping.
    }
}

app.Lifetime.ApplicationStarted.Register(() =>
{
    // From the External Tools ribbon: connect to that report first, so the app opens already connected
    // (the person chose this report by clicking the button in it).
    if (launch is { } from)
    {
        var outcome = ConnectTo(from.Port);
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
    Console.WriteLine(portChosen ? "Press Ctrl+C to stop." : "Quit from DAX Explorer's icon in the taskbar's notification area.");

    if (!portChosen)
    {
        tray = Tray.Start(new TrayActions(
            Open: OpenBrowser,
            Quit: app.Lifetime.StopApplication,
            ConnectedTo: () => app.Services.GetRequiredService<ConnectionState>().Current.Connection?.ReportName));
        _ = SingleInstance.ListenAsync(instanceName, Handle, stopping.Token);
        _ = WatchDesktopAsync();
    }
    if (openBrowser) OpenBrowser();
});
app.Lifetime.ApplicationStopping.Register(() =>
{
    stopping.Cancel();
    tray?.Dispose();
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

// Shows a startup error: in the terminal, or (double-clicked, started by Power BI) in a message box.
int StartupFailed(string message, int exitCode)
{
    if (terminal)
    {
        Console.Error.WriteLine();
        Console.Error.WriteLine(message);
    }
    else
    {
        System.Windows.Forms.MessageBox.Show(message, "DAX Explorer", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Warning);
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
