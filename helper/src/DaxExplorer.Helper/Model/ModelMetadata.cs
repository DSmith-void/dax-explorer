namespace DaxExplorer.Helper.Model;

/// <summary>What the app needs to know about a semantic model. Metadata only: no data rows.</summary>
public sealed record ModelMetadata(
    string DatabaseName,
    IReadOnlyList<TableInfo> Tables,
    IReadOnlyList<ColumnInfo> Columns,
    IReadOnlyList<MeasureInfo> Measures,
    IReadOnlyList<RelationshipInfo> Relationships);

/// <param name="DataCategory">"Time" when the table is marked as a date table; null when not set (or not reported).</param>
public sealed record TableInfo(string Name, bool IsHidden, string? Expression, string? DataCategory = null);

/// <param name="Kind">How the column is defined: Data, Calculated, or CalculatedTableColumn.</param>
/// <param name="SortByColumn">The column (of the same table) this one is sorted by, e.g. Month by "Month Number"; null when none.</param>
public sealed record ColumnInfo(string Table, string Name, string DataType, bool IsHidden, string Kind, string? Expression, string? SortByColumn = null);

public sealed record MeasureInfo(string Table, string Name, string Expression, string? FormatString, bool IsHidden, string? DisplayFolder);

/// <param name="FromCardinality">"Many" or "One" on the From side.</param>
/// <param name="CrossFilteringBehavior">"OneDirection", "BothDirections" or "Automatic".</param>
public sealed record RelationshipInfo(
    string FromTable,
    string FromColumn,
    string FromCardinality,
    string ToTable,
    string ToColumn,
    string ToCardinality,
    bool IsActive,
    string CrossFilteringBehavior);
