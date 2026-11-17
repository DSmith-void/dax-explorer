using DaxExplorer.Helper.Model;

namespace DaxExplorer.Helper.Tests;

/// <summary>
/// Converting INFO.VIEW.* rows into model records. Row shapes mirror what Power BI Desktop
/// actually returned in the feasibility check (synthetic model), including the internal RowNumber column.
/// </summary>
public class ModelBuilderTests
{
    private static Row R(params (string Key, object? Value)[] values) =>
        new(values.ToDictionary(v => v.Key, v => v.Value, StringComparer.OrdinalIgnoreCase));

    private static ModelMetadata BuildSample() => ModelBuilder.Build(
        "db-guid",
        tables: [R(("Name", "Sales"), ("IsHidden", false), ("Expression", "DATATABLE(...)"))],
        columns:
        [
            R(("Table", "Sales"), ("Name", "RowNumber-2662979B"), ("DataType", "Integer"), ("IsHidden", true), ("Type", "RowNumber")),
            R(("Table", "Sales"), ("Name", "Category"), ("DataType", "Text"), ("IsHidden", false), ("Type", "CalculatedTableColumn")),
            R(("Table", "Sales"), ("Name", "Amount"), ("DataType", "Number"), ("IsHidden", "False"), ("Type", "Data"), ("Expression", null)),
        ],
        measures: [R(("Table", "Sales"), ("Name", "Total Sales"), ("Expression", "SUM(Sales[Amount])"), ("FormatString", ""), ("IsHidden", false), ("DisplayFolder", DBNull.Value))],
        relationships:
        [
            R(("FromTable", "Sales"), ("FromColumn", "ProductKey"), ("FromCardinality", "Many"),
              ("ToTable", "Product"), ("ToColumn", "ProductKey"), ("ToCardinality", "One"),
              ("IsActive", true), ("CrossFilteringBehavior", "OneDirection")),
        ]);

    [Fact]
    public void Reads_whether_a_table_is_marked_as_a_date_table()
    {
        var model = ModelBuilder.Build(
            "db",
            [R(("Name", "Date"), ("IsHidden", false), ("DataCategory", "Time")), R(("Name", "Sales"), ("IsHidden", false), ("DataCategory", DBNull.Value))],
            [], [], []);
        Assert.Equal(["Time", null], model.Tables.Select(t => t.DataCategory));
    }

    [Fact]
    public void Reads_the_column_a_column_is_sorted_by()
    {
        var model = ModelBuilder.Build(
            "db",
            [],
            [
                R(("Table", "Date"), ("Name", "Month"), ("DataType", "Text"), ("IsHidden", false), ("Type", "Data"), ("SortByColumn", "Month Number")),
                R(("Table", "Date"), ("Name", "Year"), ("DataType", "Integer"), ("IsHidden", false), ("Type", "Data"), ("SortByColumn", DBNull.Value)),
            ],
            [], []);
        Assert.Equal(["Month Number", null], model.Columns.Select(c => c.SortByColumn));
    }

    [Fact]
    public void Reads_calendars_with_their_units_and_columns()
    {
        // The shape INFO.CALENDARS / CALENDARCOLUMNGROUPS / CALENDARCOLUMNREFERENCES return (IDs, not names).
        var calendars = ModelBuilder.BuildCalendars(
            tables: [R(("ID", 19L), ("Name", "Date")), R(("ID", 22L), ("Name", "Sales"))],
            columns:
            [
                R(("ID", 40L), ("Table", "Date"), ("Name", "Date")),
                R(("ID", 41L), ("Table", "Date"), ("Name", "Year")),
                R(("ID", 42L), ("Table", "Date"), ("Name", "Month Number")),
                R(("ID", 43L), ("Table", "Date"), ("Name", "Month")),
                R(("ID", 45L), ("Table", "Date"), ("Name", "Is Holiday")),
            ],
            calendars: [R(("ID", 926L), ("TableID", 19L), ("Name", "Fiscal Calendar"))],
            groups:
            [
                R(("ID", 927L), ("CalendarID", 926L), ("TimeUnit", 1L)),
                R(("ID", 929L), ("CalendarID", 926L), ("TimeUnit", 8L)),
                R(("ID", 930L), ("CalendarID", 926L), ("TimeUnit", 16L)),
                R(("ID", 931L), ("CalendarID", 926L), ("TimeUnit", 0L)),
            ],
            references:
            [
                R(("CalendarColumnGroupID", 927L), ("ColumnID", 41L), ("IsPrimaryColumn", true)),
                R(("CalendarColumnGroupID", 929L), ("ColumnID", 42L), ("IsPrimaryColumn", true)),
                R(("CalendarColumnGroupID", 929L), ("ColumnID", 43L), ("IsPrimaryColumn", false)),
                R(("CalendarColumnGroupID", 930L), ("ColumnID", 40L), ("IsPrimaryColumn", true)),
                R(("CalendarColumnGroupID", 931L), ("ColumnID", 45L), ("IsPrimaryColumn", false)),
            ]);

        var calendar = Assert.Single(calendars);
        Assert.Equal(("Fiscal Calendar", "Date"), (calendar.Name, calendar.Table));
        Assert.Equal(["Year", "MonthOfYear", "Date", "TimeRelated"], calendar.Groups.Select(g => g.Unit));
        Assert.Equal(["Year", "Month Number", "Date", null], calendar.Groups.Select(g => g.PrimaryColumn));
        Assert.Equal(["Month"], calendar.Groups[1].AssociatedColumns);
        Assert.Equal(["Is Holiday"], calendar.Groups[3].AssociatedColumns);
    }

    [Theory]
    [InlineData(4L, "Quarter")]
    [InlineData(11L, "Week")]
    [InlineData(21L, "DayOfWeek")]
    [InlineData(99L, "Unknown")]
    public void Names_time_units_like_TOM(long value, string expected) => Assert.Equal(expected, ModelBuilder.TimeUnitName(value));

    [Fact]
    public void Builds_tables_measures_and_relationships()
    {
        var model = BuildSample();
        Assert.Equal("db-guid", model.DatabaseName);
        Assert.Equal(new TableInfo("Sales", false, "DATATABLE(...)"), Assert.Single(model.Tables));
        Assert.Equal(new MeasureInfo("Sales", "Total Sales", "SUM(Sales[Amount])", null, false, null), Assert.Single(model.Measures));
        Assert.Equal(
            new RelationshipInfo("Sales", "ProductKey", "Many", "Product", "ProductKey", "One", true, "OneDirection"),
            Assert.Single(model.Relationships));
    }

    [Fact]
    public void Excludes_the_internal_RowNumber_column()
    {
        Assert.Equal(["Category", "Amount"], BuildSample().Columns.Select(c => c.Name));
    }

    [Fact]
    public void Reads_flags_given_as_booleans_or_text()
    {
        var amount = BuildSample().Columns.Single(c => c.Name == "Amount");
        Assert.False(amount.IsHidden);
        Assert.Equal("Data", amount.Kind);
        Assert.Null(amount.Expression);
    }

    [Fact]
    public void Treats_empty_text_and_DBNull_as_missing()
    {
        var measure = BuildSample().Measures.Single();
        Assert.Null(measure.FormatString); // was ""
        Assert.Null(measure.DisplayFolder); // was DBNull
    }

    [Fact]
    public void Reports_a_clear_error_when_a_required_value_is_missing()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            ModelBuilder.Build("db", [R(("IsHidden", false))], [], [], []));
        Assert.Contains("'Name'", error.Message);
    }

    [Theory]
    [InlineData("[Name]", "Name")]
    [InlineData("Name", "Name")]
    [InlineData("[]", "")]
    [InlineData("[", "[")]
    public void Strips_brackets_from_result_column_names(string raw, string expected) =>
        Assert.Equal(expected, Row.NormalizeColumnName(raw));

    [Fact]
    public void Reads_calculation_groups_with_their_items_in_order()
    {
        // The shape INFO.CALCULATIONGROUPS / INFO.CALCULATIONITEMS return (checked in Power BI Desktop: IDs, not names).
        var groups = ModelBuilder.BuildCalculationGroups(
            tables: [R(("ID", 30L), ("Name", "Time Calc")), R(("ID", 22L), ("Name", "Sales"))],
            groups: [R(("ID", 7L), ("TableID", 30L), ("Precedence", 10L))],
            items:
            [
                R(("ID", 2L), ("CalculationGroupID", 7L), ("Name", "PY"), ("Expression", "CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))"), ("Ordinal", 1L)),
                R(("ID", 1L), ("CalculationGroupID", 7L), ("Name", "Current"), ("Expression", "SELECTEDMEASURE()"), ("Ordinal", 0L)),
                R(("ID", 9L), ("CalculationGroupID", 99L), ("Name", "Other group"), ("Expression", "1"), ("Ordinal", 0L)),
            ]);

        var group = Assert.Single(groups);
        Assert.Equal(("Time Calc", 10), (group.Table, group.Precedence));
        Assert.Equal(["Current", "PY"], group.Items.Select(i => i.Name));
        Assert.Equal("SELECTEDMEASURE()", group.Items[0].Expression);
    }

    [Fact]
    public void Reads_user_defined_functions()
    {
        // The shape INFO.USERDEFINEDFUNCTIONS returns (checked in Power BI Desktop).
        var functions = ModelBuilder.BuildFunctions(
        [
            R(("ID", 5L), ("Name", "Math.Twice"), ("Description", "Doubles a number"), ("Expression", "(x : SCALAR NUMERIC VAL) => x * 2"), ("IsHidden", false)),
            R(("ID", 6L), ("Name", "Helper"), ("Description", null), ("Expression", "() => 1"), ("IsHidden", true)),
        ]);

        Assert.Equal(["Math.Twice", "Helper"], functions.Select(f => f.Name));
        Assert.Equal("(x : SCALAR NUMERIC VAL) => x * 2", functions[0].Expression);
        Assert.Null(functions[1].Description);
        Assert.True(functions[1].IsHidden);
    }
}
