using System.Reflection;

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
}
