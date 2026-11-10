using System.Reflection;
using DaxExplorer.Helper.Model;

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

        api.MapPost("/connect", (ConnectRequest request, IDesktopInstances instances, IModelSource source, ConnectionState state, ILogger<ConnectionState> log) =>
        {
            // Only connect to a port that discovery reports as a running Desktop engine:
            // the API cannot be used to make the helper connect to arbitrary ports.
            var instance = instances.Find().FirstOrDefault(i => i.Port == request.Port);
            if (instance is null)
            {
                return Results.NotFound(new { error = "That Power BI Desktop report is no longer open. Refresh the list and try again." });
            }
            try
            {
                var model = source.ReadDesktopModel(instance.Port);
                state.Set(new ConnectionInfo("Power BI Desktop", instance.Port, instance.ReportName, DateTimeOffset.Now), model);
                log.LogInformation("Connected to a Power BI Desktop report on port {Port}", instance.Port); // no model details in logs
                return Results.Ok(new { connected = true });
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                state.Clear();
                log.LogWarning("Could not read the model on port {Port}: {Error}", instance.Port, ex.GetType().Name);
                return Results.Problem(
                    title: "Could not read the model from Power BI Desktop.",
                    detail: "Make sure the report has finished loading, then try again.",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });

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

        api.MapPost("/sample/connect", (IDesktopInstances instances, IModelSource source, ConnectionState state, SampleLaunches launches, ILogger<ConnectionState> log) =>
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

        api.MapPost("/disconnect", (ConnectionState state) =>
        {
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
}
