using System.Reflection;
using DaxExplorer.Helper.Model;
using Microsoft.AnalysisServices.AdomdClient;

namespace DaxExplorer.Helper.Server;

public sealed record ConnectRequest(int Port);


/// <summary>The helper's data endpoints. All are under /api and require the token.</summary>
public static class Endpoints
{
    public static void Map(WebApplication app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/status", (ConnectionState state) =>
        {
            var (connection, model) = state.Current;
            return Results.Ok(new
            {
                helperVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown",
                connection,
                modelSummary = model is null
                    ? null
                    : new { tables = model.Tables.Count, columns = model.Columns.Count, measures = model.Measures.Count, relationships = model.Relationships.Count },
            });
        });

        api.MapGet("/desktop/instances", (IDesktopInstances instances) =>
            Results.Ok(instances.Find().Select(i => new { port = i.Port, reportName = i.ReportName })));

        api.MapPost("/connect", (ConnectRequest request, IDesktopInstances instances, IModelSource source, ConnectionState state, CaptureState capture, ILogger<ConnectionState> log) =>
        {
            // Only connect to a port that discovery reports as a running Desktop engine:
            // the API cannot be used to make the helper connect to arbitrary ports.
            return ConnectToDesktop(request.Port, instances, source, state, capture, log) switch
            {
                ConnectOutcome.Connected => Results.Ok(new { connected = true }),
                ConnectOutcome.NotOpen => Results.NotFound(new { error = "That Power BI Desktop report is no longer open. Refresh the list and try again." }),
                _ => Results.Problem(
                    title: "Could not read the model from Power BI Desktop.",
                    detail: "Make sure the report has finished loading, then try again.",
                    statusCode: StatusCodes.Status502BadGateway),
            };
        });

        // Power BI's External Tools ribbon: is DAX Explorer on it, and adding or removing it (Windows asks
        // for administrator rights, since the folder is under Program Files).
        api.MapGet("/external-tool", (ExternalToolPlace place) =>
        {
            var (installed, startsThisProgram) = ExternalTool.Status(place.Folder, place.ExePath);
            return Results.Ok(new { installed, startsThisProgram });
        });
        api.MapPost("/external-tool/install", (ExternalToolPlace place, IElevation elevation, ILogger<ConnectionState> log) =>
            ChangeExternalTool(ExternalTool.InstallArgument, place, elevation, log));
        api.MapPost("/external-tool/remove", (ExternalToolPlace place, IElevation elevation, ILogger<ConnectionState> log) =>
            ChangeExternalTool(ExternalTool.RemoveArgument, place, elevation, log));

        // The sample: open it in Power BI Desktop (if it isn't open yet), then the app calls /sample/connect
        // every few seconds until Desktop has loaded it.
        api.MapPost("/sample/open", (ISampleLauncher launcher, SampleLaunches launches, IDesktopInstances instances, ILogger<ConnectionState> log) =>
        {
            if (!launcher.IsAvailable)
            {
                return Results.NotFound(new { error = "The sample is not included with this copy of DAX Explorer." });
            }
            if (instances.Find().Any(IsNamedLikeSample))
            {
                launches.Reset();
                return Results.Ok(new { state = "open" });
            }
            if (!launches.TryStart()) return Results.Ok(new { state = "starting" });
            try
            {
                launcher.Open();
                log.LogInformation("Opening the sample in Power BI Desktop");
                return Results.Ok(new { state = "starting" });
            }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                launches.Reset();
                log.LogWarning("Could not open the sample: {Error}", ex.GetType().Name);
                return Results.Problem(
                    title: "Could not open the sample in Power BI Desktop.",
                    detail: "Make sure Power BI Desktop is installed, then try again.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

        api.MapPost("/sample/connect", (IDesktopInstances instances, IModelSource source, ConnectionState state, SampleLaunches launches, CaptureState capture, ILogger<ConnectionState> log) =>
        {
            var foundOtherReport = false;
            foreach (var instance in instances.Find().Where(IsNamedLikeSample))
            {
                ModelMetadata model;
                try
                {
                    model = source.ReadDesktopModel(instance.Port);
                }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    continue; // still loading
                }
                if (model.Tables.Count == 0) continue; // still loading
                if (!Sample.IsSampleModel(model))
                {
                    foundOtherReport = true;
                    continue;
                }
                capture.Stop();
                state.Set(new ConnectionInfo("Power BI Desktop", instance.Port, instance.ReportName, DateTimeOffset.Now, IsSample: true), model);
                launches.Reset();
                log.LogInformation("Connected to the sample on port {Port}", instance.Port);
                return Results.Ok(new { state = "connected" });
            }
            return foundOtherReport
                ? Results.Conflict(new
                {
                    error = $"A report named \"{Sample.ReportName}\" is open in Power BI Desktop, but it isn't DAX Explorer's sample, so DAX Explorer did not connect to it. Close that report and try again.",
                })
                : Results.Ok(new { state = "waiting" });
        });

        // Runs a read-only DAX query on the connected report. The app sends an expression; the statement
        // (always EVALUATE ...) is written here. Neither the query nor its results are logged.
        api.MapPost("/evaluate", (EvaluateRequest request, ConnectionState state, IQueryRunner runner) =>
        {
            var (connection, model) = state.Current;
            if (connection is null || model is null)
            {
                return Results.Conflict(new { error = "Connect to a report first: values come from Power BI Desktop." });
            }
            var (query, maxRows, error) = QueryBuilder.Build(request);
            if (query is null) return Results.BadRequest(new { error });
            try
            {
                var result = runner.Run(connection.Port, model.DatabaseName, query, maxRows, TimeSpan.FromSeconds(60));
                return Results.Ok(new { columns = result.Columns, rows = result.Rows, truncated = result.Truncated });
            }
            catch (AdomdErrorResponseException ex)
            {
                // The engine's own message (for example "The column ... cannot be found") helps fix the DAX.
                return Results.UnprocessableEntity(new { error = ex.Message });
            }
            catch (AdomdConnectionException)
            {
                return Results.Problem(
                    title: "Power BI Desktop is not responding.",
                    detail: "The report may have been closed. Reconnect and try again.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // "Run with timings": the same query as /evaluate, traced to see where its time goes (see AmoTimingSource).
        // Optionally clears the report's cache first (a "cold" run); that changes no data and no model.
        api.MapPost("/timings", (TimingsRequest request, ConnectionState state, ITimingSource timings) =>
        {
            var (connection, model) = state.Current;
            if (connection is null || model is null)
            {
                return Results.Conflict(new { error = "Connect to a report first: timings come from Power BI Desktop." });
            }
            var (query, _, error) = QueryBuilder.Build(new EvaluateRequest(request.Kind, request.Dax, null));
            if (query is null) return Results.BadRequest(new { error });
            try
            {
                var result = timings.Measure(connection.Port, model.DatabaseName, query, request.ClearCache ?? false, TimeSpan.FromSeconds(60));
                return Results.Ok(result);
            }
            catch (TimingUnavailableException ex)
            {
                return Results.Problem(title: ex.Message, detail: "Try again; if it keeps happening, the timings aren't available for this report.", statusCode: StatusCodes.Status502BadGateway);
            }
            catch (AdomdErrorResponseException ex)
            {
                return Results.UnprocessableEntity(new { error = ex.Message });
            }
            catch (AdomdConnectionException)
            {
                return Results.Problem(
                    title: "Power BI Desktop is not responding.",
                    detail: "The report may have been closed. Reconnect and try again.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

        // Capture from Desktop: the queries visuals send, while the user is listening (see CaptureState).
        // ?untilDisconnect=true: listen until the report is disconnected (the "listen while connected" setting).
        api.MapPost("/capture/start", (bool? untilDisconnect, ConnectionState state, CaptureState capture, ILogger<CaptureState> log) =>
        {
            var (connection, _) = state.Current;
            if (connection is null)
            {
                return Results.Conflict(new { error = "Connect to a report first: the capture listens to that report in Power BI Desktop." });
            }
            try
            {
                capture.Start(connection.Port, untilDisconnect ?? false);
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                log.LogWarning("Could not start the capture: {Error}", ex.GetType().Name);
                return Results.Problem(
                    title: "Could not listen to Power BI Desktop.",
                    detail: "Make sure the report is still open, then try again. Copying the query from Performance analyzer still works.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
            var (listening, stopsAt, _) = capture.Read(int.MaxValue);
            return Results.Ok(new { listening, stopsAt });
        });

        // The visual queries Desktop ran most recently, from the engine's session list (a read; nothing is kept).
        api.MapGet("/visuals/recent", (ConnectionState state, ISessionCommands sessions, ILogger<ConnectionState> log) =>
        {
            var (connection, _) = state.Current;
            if (connection is null)
            {
                return Results.Conflict(new { error = "Connect to a report first." });
            }
            try
            {
                return Results.Ok(new { queries = RecentVisuals.Pick(sessions.Read(connection.Port)) });
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                log.LogWarning("Could not read the recent visual queries: {Error}", ex.GetType().Name);
                return Results.Problem(
                    title: "Could not read the recent visual queries from Power BI Desktop.",
                    detail: "Make sure the report is still open, then try again.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

        api.MapPost("/capture/stop", (CaptureState capture) =>
        {
            capture.Stop();
            return Results.Ok(new { listening = false });
        });

        api.MapGet("/capture", (CaptureState capture, int? after) =>
        {
            var (listening, stopsAt, queries) = capture.Read(after ?? 0);
            return Results.Ok(new { listening, stopsAt, queries, seen = capture.Seen });
        });

        api.MapPost("/disconnect", (ConnectionState state, CaptureState capture) =>
        {
            capture.Stop();
            state.Clear();
            return Results.Ok(new { connected = false });
        });

        api.MapGet("/model", (ConnectionState state) =>
        {
            var (_, model) = state.Current;
            return model is null ? Results.NotFound(new { error = "Not connected." }) : Results.Ok(model);
        });
    }

    private static bool IsNamedLikeSample(DaxExplorer.Helper.Discovery.DesktopInstance instance) =>
        string.Equals(instance.ReportName, Sample.ReportName, StringComparison.OrdinalIgnoreCase);

    public enum ConnectOutcome { Connected, NotOpen, Failed }

    /// <summary>
    /// Connects to a Power BI Desktop report by its engine port, but only one that discovery reports as a
    /// running Desktop engine: neither the API nor the command line can make the helper connect anywhere else.
    /// </summary>
    public static ConnectOutcome ConnectToDesktop(int port, IDesktopInstances instances, IModelSource source, ConnectionState state, CaptureState capture, ILogger log)
    {
        var instance = instances.Find().FirstOrDefault(i => i.Port == port);
        if (instance is null) return ConnectOutcome.NotOpen;
        try
        {
            var model = source.ReadDesktopModel(instance.Port);
            capture.Stop(); // a capture belongs to one connection
            state.Set(new ConnectionInfo("Power BI Desktop", instance.Port, instance.ReportName, DateTimeOffset.Now), model);
            log.LogInformation("Connected to a Power BI Desktop report on port {Port}", instance.Port); // no model details in logs
            return ConnectOutcome.Connected;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            state.Clear();
            log.LogWarning("Could not read the model on port {Port}: {Error}", instance.Port, ex.GetType().Name);
            return ConnectOutcome.Failed;
        }
    }

    private static IResult ChangeExternalTool(string argument, ExternalToolPlace place, IElevation elevation, ILogger log)
    {
        if (place.ExePath.Length == 0) return Results.Problem(title: "DAX Explorer couldn't tell where its program file is.", statusCode: StatusCodes.Status500InternalServerError);
        var result = elevation.RunElevated(argument);
        log.LogInformation("External Tools change ({Argument}): {Result}", argument, result);
        var (installed, startsThisProgram) = ExternalTool.Status(place.Folder, place.ExePath);
        return Results.Ok(new { result, installed, startsThisProgram });
    }
}
