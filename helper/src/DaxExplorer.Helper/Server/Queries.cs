using System.Data;
using DaxExplorer.Helper.Model;
using Microsoft.AnalysisServices.AdomdClient;

namespace DaxExplorer.Helper.Server;

/// <param name="Kind">"scalar": one value (wrapped in ROW); "table": rows of a table expression.</param>
/// <param name="Dax">A DAX expression (not a whole query): the helper writes the EVALUATE statement itself.</param>
/// <param name="MaxRows">At most this many rows are returned (1–1000, default 100).</param>
public sealed record EvaluateRequest(string? Kind, string? Dax, int? MaxRows);

/// <param name="ClearCache">Clear the report's cache first, so the run starts "cold".</param>
public sealed record TimingsRequest(string? Kind, string? Dax, bool? ClearCache);

public sealed record QueryResult(IReadOnlyList<string> Columns, IReadOnlyList<object?[]> Rows, bool Truncated);

/// <summary>Runs a read-only DAX query against a Power BI Desktop engine. Abstracted for tests.</summary>
public interface IQueryRunner
{
    QueryResult Run(int port, string database, string query, int maxRows, TimeSpan timeout);
}

/// <summary>Builds the DAX statements the helper runs. Every statement starts with EVALUATE, so it is always a read-only query.</summary>
public static class QueryBuilder
{
    public const int MaxDaxLength = 200_000;
    public const int DefaultRows = 100;
    public const int MaxRows = 1000;

    /// <summary>The statement for a request, or an error message for an invalid one.</summary>
    public static (string? Query, int MaxRows, string? Error) Build(EvaluateRequest request)
    {
        var dax = request.Dax?.Trim();
        if (string.IsNullOrEmpty(dax)) return (null, 0, "No DAX expression was given.");
        if (dax.Length > MaxDaxLength) return (null, 0, "The DAX expression is too long.");
        var rows = Math.Clamp(request.MaxRows ?? DefaultRows, 1, MaxRows);
        return request.Kind switch
        {
            // Line breaks keep a trailing "// comment" in the expression from swallowing the closing parenthesis.
            "scalar" => ($"EVALUATE ROW(\"value\",\n{dax}\n)", 1, null),
            "table" => ($"EVALUATE\n{dax}\n", rows, null),
            _ => (null, 0, "Unknown kind of query (expected \"scalar\" or \"table\")."),
        };
    }

    /// <summary>A value as JSON-friendly data: dates become { date: "yyyy-MM-ddTHH:mm:ss" } so the app can tell them from text.</summary>
    public static object? ToJsonValue(object? value) => value switch
    {
        null or DBNull => null,
        DateTime d => new Dictionary<string, string> { ["date"] = d.ToString("yyyy-MM-dd'T'HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) },
        double x when double.IsNaN(x) || double.IsInfinity(x) => null,
        float x when float.IsNaN(x) || float.IsInfinity(x) => null,
        bool or string or long or int or short or byte or double or float or decimal => value,
        _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
    };
}

internal sealed class AdomdQueryRunner : IQueryRunner
{
    public QueryResult Run(int port, string database, string query, int maxRows, TimeSpan timeout)
    {
        using var connection = new AdomdConnection(ModelReader.DesktopConnectionString(port));
        connection.Open();
        connection.ChangeDatabase(database);
        using var command = new AdomdCommand(query, connection) { CommandTimeout = (int)timeout.TotalSeconds };
        using var reader = command.ExecuteReader(CommandBehavior.SequentialAccess);
        var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToList();
        var rows = new List<object?[]>();
        var truncated = false;
        while (reader.Read())
        {
            if (rows.Count == maxRows)
            {
                truncated = true;
                break;
            }
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = QueryBuilder.ToJsonValue(reader.GetValue(i));
            rows.Add(row);
        }
        return new QueryResult(columns, rows, truncated);
    }
}
