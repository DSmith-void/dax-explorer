using Microsoft.AnalysisServices.AdomdClient;

namespace DaxExplorer.Helper.Model;

/// <summary>
/// Reads model metadata (tables, columns, measures, relationships) from an open connection
/// using Power BI's INFO.VIEW.* DAX functions. Read-only: it only runs EVALUATE queries.
/// </summary>
public static class ModelReader
{
    /// <summary>Connection string for a Power BI Desktop engine found by discovery.</summary>
    public static string DesktopConnectionString(int port) => $"Data Source=localhost:{port}";

    public static ModelMetadata Read(AdomdConnection connection)
    {
        var database = SelectSingleDatabase(connection);
        connection.ChangeDatabase(database);
        return ModelBuilder.Build(
            database,
            Query(connection, "EVALUATE INFO.VIEW.TABLES()"),
            Query(connection, "EVALUATE INFO.VIEW.COLUMNS()"),
            Query(connection, "EVALUATE INFO.VIEW.MEASURES()"),
            Query(connection, "EVALUATE INFO.VIEW.RELATIONSHIPS()"));
    }

    /// <summary>
    /// Desktop hosts exactly one database, named with a GUID that changes every session.
    /// (Servers with several databases will be handled when connection strings are added.)
    /// </summary>
    private static string SelectSingleDatabase(AdomdConnection connection)
    {
        var names = Query(connection, "SELECT [CATALOG_NAME] FROM $SYSTEM.DBSCHEMA_CATALOGS")
            .Select(r => r.Text("CATALOG_NAME"))
            .OfType<string>()
            .ToList();
        return names.Count == 1
            ? names[0]
            : throw new InvalidOperationException($"Expected one model on this engine but found {names.Count}.");
    }

    /// <summary>Runs a read-only query and returns its rows. (ADOMD.NET does not support ExecuteScalar.)</summary>
    public static List<Row> Query(AdomdConnection connection, string query)
    {
        using var command = new AdomdCommand(query, connection);
        using var reader = command.ExecuteReader();
        var names = Enumerable.Range(0, reader.FieldCount).Select(i => Row.NormalizeColumnName(reader.GetName(i))).ToArray();
        var rows = new List<Row>();
        while (reader.Read())
        {
            var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < names.Length; i++) values[names[i]] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            rows.Add(new Row(values));
        }
        return rows;
    }
}
