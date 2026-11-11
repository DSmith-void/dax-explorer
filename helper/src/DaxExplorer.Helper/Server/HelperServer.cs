using System.Net;
using Microsoft.AspNetCore.HostFiltering;
using Microsoft.Extensions.FileProviders;

namespace DaxExplorer.Helper.Server;

/// <param name="Port">Loopback port to listen on.</param>
/// <param name="AppPath">Folder with the built web app (index.html), or null if not found.</param>
/// <param name="Token">Secret the app must send with every /api request.</param>
public sealed record HelperOptions(int Port, string? AppPath, string Token);

public static class HelperServer
{
    public const int DefaultPort = 5092;

    /// <summary>True if nothing is listening on the loopback port yet.</summary>
    public static bool IsPortFree(int port)
    {
        try
        {
            var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, port);
            probe.Start();
            probe.Stop();
            return true;
        }
        catch (System.Net.Sockets.SocketException)
        {
            return false;
        }
    }

    /// <summary>
    /// Builds the helper: loopback-only, host-checked, token-protected data endpoints, and the
    /// web app's files. Tests pass <paramref name="configureTest"/> to swap services and use an
    /// in-memory server instead of a real port.
    /// </summary>
    public static WebApplication Build(HelperOptions options, Action<WebApplicationBuilder>? configureTest = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { ContentRootPath = AppContext.BaseDirectory });

        // Only this computer can connect: the loopback address, never the network.
        builder.WebHost.ConfigureKestrel(kestrel => kestrel.Listen(IPAddress.Loopback, options.Port));

        // Reject requests whose Host header is not ours (defends against DNS rebinding).
        builder.Services.Configure<HostFilteringOptions>(o => o.AllowedHosts = ["127.0.0.1", "localhost"]);

        builder.Services.AddSingleton(new TokenGuard(options.Token));
        builder.Services.AddSingleton<ConnectionState>();
        builder.Services.AddSingleton<IDesktopInstances, DesktopInstances>();
        builder.Services.AddSingleton<IModelSource, AdomdModelSource>();
        builder.Services.AddSingleton<IQueryRunner, AdomdQueryRunner>();
        builder.Services.AddSingleton<ICaptureSource, AmoCaptureSource>();
        builder.Services.AddSingleton<CaptureState>();
        builder.Services.AddSingleton<ISessionCommands, AdomdSessionCommands>();
        builder.Services.AddSingleton<ISampleLauncher>(new ShellSampleLauncher(Sample.FindProject(AppContext.BaseDirectory)));
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton<SampleLaunches>();

        configureTest?.Invoke(builder);

        var app = builder.Build();

        // A capture must never outlive DAX Explorer: stop it (and remove the trace) when the helper stops.
        app.Lifetime.ApplicationStopping.Register(() => app.Services.GetRequiredService<CaptureState>().Stop());

        app.Use(async (context, next) =>
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["Referrer-Policy"] = "no-referrer";
            headers["X-Frame-Options"] = "DENY";
            headers["Cache-Control"] = context.Request.Path.StartsWithSegments("/api") ? "no-store" : "no-cache";
            await next(context);
        });

        var guard = app.Services.GetRequiredService<TokenGuard>();
        app.Use(guard.InvokeAsync);

        Endpoints.Map(app);
        app.MapFallback("/api/{**rest}", () => Results.NotFound(new { error = "Unknown endpoint." }));

        if (options.AppPath is not null && File.Exists(Path.Combine(options.AppPath, "index.html")))
        {
            var files = new PhysicalFileProvider(options.AppPath);
            app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
            app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
        }
        else
        {
            app.MapGet("/", () => Results.Text(
                "The DAX Execution Explorer app has not been built yet. Run 'npm run build' in the project folder, then restart the helper.",
                "text/plain"));
        }

        return app;
    }

    /// <summary>
    /// Finds the built web app: an "app" folder next to the program (the packaged DaxExplorer.exe),
    /// otherwise the repository's "dist" folder found by walking up (when run from source).
    /// </summary>
    public static string? FindAppPath(string startDirectory)
    {
        var packaged = Path.Combine(startDirectory, "app");
        if (File.Exists(Path.Combine(packaged, "index.html"))) return packaged;

        for (var dir = new DirectoryInfo(startDirectory); dir is not null; dir = dir.Parent)
        {
            var dist = Path.Combine(dir.FullName, "dist");
            if (File.Exists(Path.Combine(dist, "index.html")) && File.Exists(Path.Combine(dir.FullName, "package.json")))
            {
                return dist;
            }
        }
        return null;
    }
}
