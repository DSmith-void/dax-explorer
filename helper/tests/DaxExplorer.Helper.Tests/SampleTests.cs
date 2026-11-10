using DaxExplorer.Helper.Model;
using DaxExplorer.Helper.Server;

namespace DaxExplorer.Helper.Tests;

/// <summary>Finding, recognizing and copying the Initech sample.</summary>
public sealed class SampleTests : IDisposable
{
    private readonly string _temp = Directory.CreateTempSubdirectory("daxexplorer-sample-tests-").FullName;

    public void Dispose() => Directory.Delete(_temp, recursive: true);

    private static ModelMetadata ModelWith(params (string Name, bool Hidden)[] tables) =>
        new("db", tables.Select(t => new TableInfo(t.Name, t.Hidden, null)).ToList(), [], [], []);

    [Fact]
    public void Recognizes_the_sample_by_its_five_visible_tables()
    {
        Assert.True(Sample.IsSampleModel(ModelWith(("Sales", false), ("Product", false), ("Customer", false), ("Plant", false), ("Date", false))));
        // Desktop's hidden automatic date tables don't matter.
        Assert.True(Sample.IsSampleModel(ModelWith(("Sales", false), ("Product", false), ("Customer", false), ("Plant", false), ("Date", false), ("LocalDateTable_x", true))));
    }

    [Fact]
    public void Does_not_mistake_other_models_for_the_sample()
    {
        Assert.False(Sample.IsSampleModel(ModelWith(("Sales", false))));
        Assert.False(Sample.IsSampleModel(ModelWith(("Sales", false), ("Product", false), ("Customer", false), ("Plant", false), ("Date", false), ("Budget", false))));
        Assert.False(Sample.IsSampleModel(ModelWith(("sales", false), ("Product", false), ("Customer", false), ("Plant", false), ("Date", false))));
    }

    [Fact]
    public void Finds_the_packaged_sample_next_to_the_program_first()
    {
        var packaged = Path.Combine(_temp, "sample", "Initech", "Initech.pbip");
        Directory.CreateDirectory(Path.GetDirectoryName(packaged)!);
        File.WriteAllText(packaged, "{}");
        Assert.Equal(packaged, Sample.FindProject(_temp));
    }

    [Fact]
    public void Finds_the_repository_sample_when_run_from_source()
    {
        var project = Path.Combine(_temp, "samples", "Initech", "Initech.pbip");
        Directory.CreateDirectory(Path.GetDirectoryName(project)!);
        File.WriteAllText(project, "{}");
        File.WriteAllText(Path.Combine(_temp, "package.json"), "{}");
        var bin = Directory.CreateDirectory(Path.Combine(_temp, "helper", "bin", "Debug")).FullName;

        Assert.Equal(project, Sample.FindProject(bin));
        var elsewhere = Directory.CreateTempSubdirectory("daxexplorer-empty-").FullName;
        try
        {
            Assert.Null(Sample.FindProject(elsewhere));
        }
        finally
        {
            Directory.Delete(elsewhere);
        }
    }

    [Fact]
    public void Copies_the_project_without_Desktops_local_settings_and_cache()
    {
        var source = Path.Combine(_temp, "src");
        void Write(string relative)
        {
            var path = Path.Combine(source, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, relative);
        }
        Write("Initech.pbip");
        Write(Path.Combine("Initech.SemanticModel", "definition", "tables", "Sales.tmdl"));
        Write(Path.Combine("Initech.SemanticModel", ".pbi", "cache.abf"));
        Write(Path.Combine("Initech.Report", ".pbi", "localSettings.json"));

        var target = Path.Combine(_temp, "copy");
        Sample.CopyProject(source, target);

        Assert.True(File.Exists(Path.Combine(target, "Initech.pbip")));
        Assert.True(File.Exists(Path.Combine(target, "Initech.SemanticModel", "definition", "tables", "Sales.tmdl")));
        Assert.False(Directory.Exists(Path.Combine(target, "Initech.SemanticModel", ".pbi")));
        Assert.False(Directory.Exists(Path.Combine(target, "Initech.Report", ".pbi")));
    }
}
