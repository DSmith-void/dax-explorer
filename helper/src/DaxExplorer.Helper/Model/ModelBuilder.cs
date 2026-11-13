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
    /// <summary>
    /// TOM's TimeUnit values (Microsoft.AnalysisServices.Tabular.TimeUnit), as INFO.CALENDARCOLUMNGROUPS reports
    /// them. 0 (Unknown) is a group tagged without a unit: Power BI calls those columns "time-related".
    /// </summary>
    private static readonly string[] TimeUnits =
    [
        "TimeRelated", "Year", "Semester", "SemesterOfYear", "Quarter", "QuarterOfYear", "QuarterOfSemester",
        "Month", "MonthOfYear", "MonthOfSemester", "MonthOfQuarter", "Week", "WeekOfYear", "WeekOfSemester",
        "WeekOfQuarter", "WeekOfMonth", "Date", "DayOfYear", "DayOfSemester", "DayOfQuarter", "DayOfMonth", "DayOfWeek",
    ];

    public static string TimeUnitName(object? value)
    {
        var number = value switch
        {
            null or DBNull => -1,
            string s => int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : -1,
            var other => Convert.ToInt32(other, CultureInfo.InvariantCulture),
        };
        return number >= 0 && number < TimeUnits.Length ? TimeUnits[number] : "Unknown";
    }

    /// <summary>
    /// Calendars from INFO.CALENDARS, INFO.CALENDARCOLUMNGROUPS and INFO.CALENDARCOLUMNREFERENCES, which refer to
    /// tables and columns by ID; the IDs are those of INFO.VIEW.TABLES and INFO.VIEW.COLUMNS.
    /// </summary>
    public static List<CalendarInfo> BuildCalendars(
        IEnumerable<Row> tables,
        IEnumerable<Row> columns,
        IEnumerable<Row> calendars,
        IEnumerable<Row> groups,
        IEnumerable<Row> references)
    {
        var tableNames = tables.Where(r => r.Text("ID") is not null).ToDictionary(r => r.RequiredText("ID"), r => r.RequiredText("Name"));
        var columnNames = columns.Where(r => r.Text("ID") is not null).ToDictionary(r => r.RequiredText("ID"), r => r.RequiredText("Name"));
        var referenceList = references.ToList();
        var groupList = groups.ToList();
        var result = new List<CalendarInfo>();
        foreach (var calendar in calendars)
        {
            var id = calendar.RequiredText("ID");
            if (!tableNames.TryGetValue(calendar.RequiredText("TableID"), out var table)) continue;
            var calendarGroups = new List<CalendarColumnGroupInfo>();
            foreach (var group in groupList.Where(g => g.Text("CalendarID") == id))
            {
                var groupId = group.RequiredText("ID");
                string? primary = null;
                var associated = new List<string>();
                foreach (var reference in referenceList.Where(r => r.Text("CalendarColumnGroupID") == groupId))
                {
                    if (!columnNames.TryGetValue(reference.RequiredText("ColumnID"), out var column)) continue;
                    if (reference.Flag("IsPrimaryColumn") && primary is null) primary = column;
                    else associated.Add(column);
                }
                calendarGroups.Add(new CalendarColumnGroupInfo(TimeUnitName(group["TimeUnit"]), primary, associated));
            }
            result.Add(new CalendarInfo(calendar.RequiredText("Name"), table, calendarGroups));
        }
        return result;
    }

    public static ModelMetadata Build(
        string databaseName,
        IEnumerable<Row> tables,
        IEnumerable<Row> columns,
        IEnumerable<Row> measures,
        IEnumerable<Row> relationships,
        IReadOnlyList<CalendarInfo>? calendars = null) =>
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
                .ToList(),
            calendars ?? []);
}
