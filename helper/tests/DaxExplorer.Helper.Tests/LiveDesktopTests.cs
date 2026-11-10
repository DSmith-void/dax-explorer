using DaxExplorer.Helper.Discovery;
using DaxExplorer.Helper.Model;
using Microsoft.AnalysisServices.AdomdClient;

namespace DaxExplorer.Helper.Tests;

/// <summary>
/// Runs only when DAXEXPLORER_LIVE_TESTS=1 and exactly ONE Power BI Desktop report is open.
/// Intended for the synthetic test report only; it never runs by default.
/// </summary>
public sealed class LiveDesktopFactAttribute : FactAttribute
{
    public LiveDesktopFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("DAXEXPLORER_LIVE_TESTS") != "1")
        {
            Skip = "Live Power BI Desktop test: set DAXEXPLORER_LIVE_TESTS=1 with only the synthetic report open.";
        }
    }
}

public class LiveDesktopTests
{
    [LiveDesktopFact]
    public void Reads_the_synthetic_model_from_the_open_Desktop_report()
    {
        var instance = Assert.Single(DesktopDiscovery.CreateDefault().Find());
        using var connection = new AdomdConnection(ModelReader.DesktopConnectionString(instance.Port));
        connection.Open();

        var model = ModelReader.Read(connection);

        Assert.Contains(model.Tables, t => t.Name == "Sales");
        Assert.Equal(["Product", "Category", "Amount"], model.Columns.Where(c => c.Table == "Sales").Select(c => c.Name));
        var measure = Assert.Single(model.Measures, m => m.Name == "Total Sales");
        Assert.Equal("SUM(Sales[Amount])", measure.Expression);
    }
}
