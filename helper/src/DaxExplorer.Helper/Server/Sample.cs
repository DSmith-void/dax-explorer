using System.Diagnostics;
using DaxExplorer.Helper.Model;

namespace DaxExplorer.Helper.Server;

/// <summary>Opens DAX Explorer's sample report (Initech) in Power BI Desktop.</summary>
public interface ISampleLauncher
{
    /// <summary>True when the sample project is included with this copy of DAX Explorer.</summary>
    bool IsAvailable { get; }

    /// <summary>Copies the sample to a private working folder and asks Windows to open it in Power BI Desktop.</summary>
    void Open();
}

/// <summary>Facts about the synthetic Initech sample.</summary>
public static class Sample
{
    /// <summary>The report name Desktop shows in its window title for the sample.</summary>
    public const string ReportName = "Initech";

    private static readonly string[] VisibleTables = ["Customer", "Date", "Plant", "Product", "Sales"];

    /// <summary>
    /// True when a model is the sample: exactly its five visible tables. (Desktop may add hidden helper
    /// tables, such as automatic date tables.) A report that only happens to be called "Initech" fails this
    /// check, so DAX Explorer never connects to someone's own report by mistake.
    /// </summary>
    public static bool IsSampleModel(ModelMetadata model) =>
        model.Tables.Where(t => !t.IsHidden).Select(t => t.Name).Order(StringComparer.Ordinal).SequenceEqual(VisibleTables);

    /// <summary>
    /// Finds the sample project: a "sample" folder next to the program (the packaged DaxExplorer.exe),
    /// otherwise the repository's samples folder found by walking up (when run from source).
    /// </summary>
    public static string? FindProject(string startDirectory)
    {
        var packaged = Path.Combine(startDirectory, "sample", "Initech", "Initech.pbip");
        if (File.Exists(packaged)) return packaged;

        for (var dir = new DirectoryInfo(startDirectory); dir is not null; dir = dir.Parent)
        {
            var source = Path.Combine(dir.FullName, "samples", "Initech", "Initech.pbip");
            if (File.Exists(source) && File.Exists(Path.Combine(dir.FullName, "package.json"))) return source;
        }
        return null;
    }

    /// <summary>
    /// Copies the sample project, skipping Desktop's per-user ".pbi" folders (local settings and data cache),
    /// so every start opens the sample exactly as it was shipped.
    /// </summary>
    public static void CopyProject(string sourceFolder, string targetFolder)
    {
        foreach (var file in Directory.EnumerateFiles(sourceFolder, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceFolder, file);
            if (relative.Split(Path.DirectorySeparatorChar).Contains(".pbi", StringComparer.OrdinalIgnoreCase)) continue;
            var target = Path.Combine(targetFolder, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }
    }
}

/// <summary>
/// Remembers when the sample was last opened, so pressing the button again while Power BI Desktop is
/// still starting (which can take a minute) doesn't open a second copy.
/// </summary>
public sealed class SampleLaunches(TimeProvider clock)
{
    public static readonly TimeSpan StartupAllowance = TimeSpan.FromMinutes(2);

    private readonly Lock _lock = new();
    private DateTimeOffset? _lastOpened;

    /// <summary>True (and remembered) if the sample may be opened now; false while a recent start is still under way.</summary>
    public bool TryStart()
    {
        lock (_lock)
        {
            var now = clock.GetUtcNow();
            if (_lastOpened is { } last && now - last < StartupAllowance) return false;
            _lastOpened = now;
            return true;
        }
    }

    /// <summary>Forgets the last start (when it failed, or once the sample is open).</summary>
    public void Reset()
    {
        lock (_lock) _lastOpened = null;
    }
}

/// <summary>
/// Opens the sample with whatever program Windows uses for .pbip files (Power BI Desktop).
/// It opens a fresh copy in the user's local app data, never the shipped files: if someone edits and
/// saves the sample in Desktop, the next start still begins from the original.
/// </summary>
internal sealed class ShellSampleLauncher(string? projectPath) : ISampleLauncher
{
    private static readonly string WorkingFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DaxExplorer", "Sample", "Initech");

    public bool IsAvailable => projectPath is not null;

    public void Open()
    {
        if (projectPath is null) throw new InvalidOperationException("The sample is not available.");

        try
        {
            if (Directory.Exists(WorkingFolder)) Directory.Delete(WorkingFolder, recursive: true);
        }
        catch (IOException)
        {
            // A file is still in use (for example an old Desktop window); copying over it still refreshes the sample.
        }
        catch (UnauthorizedAccessException)
        {
        }
        Sample.CopyProject(Path.GetDirectoryName(projectPath)!, WorkingFolder);

        Process.Start(new ProcessStartInfo(Path.Combine(WorkingFolder, Path.GetFileName(projectPath))) { UseShellExecute = true });
    }
}
