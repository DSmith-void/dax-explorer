using System.Globalization;

namespace DaxExplorer.Helper.Model;

/// <summary>One result row, keyed by column name without brackets ("Name", not "[Name]").</summary>
public sealed class Row(IReadOnlyDictionary<string, object?> values)
{
    public object? this[string column] => values.TryGetValue(column, out var value) ? value : null;

    public string? Text(string column) => this[column] switch
    {
        null or DBNull => null,
        string s => s.Length == 0 ? null : s,
        var other => Convert.ToString(other, CultureInfo.InvariantCulture),
    };

    public string RequiredText(string column) =>
        Text(column) ?? throw new InvalidOperationException($"Model information is missing the '{column}' value.");

    public bool Flag(string column) => this[column] switch
    {
        bool b => b,
        string s => bool.TryParse(s, out var b) && b,
        null or DBNull => false,
        var other => Convert.ToBoolean(other, CultureInfo.InvariantCulture),
    };

    /// <summary>Strips the brackets query results put around names: "[Name]" → "Name".</summary>
    public static string NormalizeColumnName(string name) =>
        name.Length >= 2 && name[0] == '[' && name[^1] == ']' ? name[1..^1] : name;
}

/// <summary>
/// Turns the rows of Power BI's INFO.VIEW.* functions into model records.
/// Pure: no connection needed, so it is unit-tested directly.
/// </summary>
public static class ModelBuilder
{
    public static ModelMetadata Build(
        string databaseName,
        IEnumerable<Row> tables,
        IEnumerable<Row> columns,
        IEnumerable<Row> measures,
        IEnumerable<Row> relationships) =>
        new(
            databaseName,
            tables.Select(r => new TableInfo(r.RequiredText("Name"), r.Flag("IsHidden"), r.Text("Expression"), r.Text("DataCategory"))).ToList(),
            columns
                // Every table has an internal "RowNumber-<guid>" column; it is not part of the user's model.
                .Where(r => !string.Equals(r.Text("Type"), "RowNumber", StringComparison.OrdinalIgnoreCase))
                .Select(r => new ColumnInfo(
                    r.RequiredText("Table"),
                    r.RequiredText("Name"),
                    r.Text("DataType") ?? "Unknown",
                    r.Flag("IsHidden"),
                    r.Text("Type") ?? "Data",
                    r.Text("Expression"),
                    r.Text("SortByColumn")))
                .ToList(),
            measures
                .Select(r => new MeasureInfo(
                    r.RequiredText("Table"),
                    r.RequiredText("Name"),
                    r.Text("Expression") ?? string.Empty,
                    r.Text("FormatString"),
                    r.Flag("IsHidden"),
                    r.Text("DisplayFolder")))
                .ToList(),
            relationships
                .Select(r => new RelationshipInfo(
                    r.RequiredText("FromTable"),
                    r.RequiredText("FromColumn"),
                    r.Text("FromCardinality") ?? "Many",
                    r.RequiredText("ToTable"),
                    r.RequiredText("ToColumn"),
                    r.Text("ToCardinality") ?? "One",
                    r.Flag("IsActive"),
                    r.Text("CrossFilteringBehavior") ?? "OneDirection"))
                .ToList());
}
