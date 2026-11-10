using DaxExplorer.Helper.Discovery;
using DaxExplorer.Helper.Model;
using Microsoft.AnalysisServices.AdomdClient;

// C2 step 1: discovery and model reading, exercised through a "describe" command.
// Step 2 replaces this with the local HTTP service that serves the app.

if (args is ["describe", ..])
{
    return Describe(args.Length > 1 && int.TryParse(args[1], out var port) ? port : null);
}

Console.WriteLine("Usage: DaxExplorer.Helper describe [port]");
Console.WriteLine("  Lists running Power BI Desktop instances and, if exactly one is open (or a port is given),");
Console.WriteLine("  prints that model's tables, columns, measures and relationships.");
return 0;

static int Describe(int? requestedPort)
{
    var instances = DesktopDiscovery.CreateDefault().Find();
    Console.WriteLine($"Power BI Desktop instances: {instances.Count}");
    foreach (var instance in instances)
    {
        Console.WriteLine($"  port {instance.Port}  report: {instance.ReportName ?? "(unknown)"}  engine pid: {instance.EngineProcessId}");
    }

    var target = requestedPort is { } p
        ? instances.FirstOrDefault(i => i.Port == p)
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
