using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DaxExplorer.Helper.Server;

/// <summary>
/// DAX Explorer as a Power BI Desktop "External Tool": a small *.pbitool.json file in Desktop's External
/// Tools folder adds a button to the External Tools ribbon. Desktop then starts DaxExplorer.exe with the
/// open report's engine address and database name ("%server%" "%database%").
/// </summary>
public static partial class ExternalTool
{
    public const string FileName = "DaxExplorer.pbitool.json";
    public const string InstallArgument = "--install-external-tool";
    public const string RemoveArgument = "--remove-external-tool";

    /// <summary>Where Power BI Desktop (both the Store and the installer versions) looks for External Tools.</summary>
    public static string DefaultFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFilesX86), "Microsoft Shared", "Power BI Desktop", "External Tools");

    /// <summary>The pbitool.json content for this program.</summary>
    public static string Definition(string exePath, string? iconPngBase64) =>
        JsonSerializer.Serialize(
            new
            {
                version = "1.0",
                name = "DAX Explorer",
                description = "Step through how a DAX measure is calculated, with real values from this report.",
                path = exePath,
                arguments = "\"%server%\" \"%database%\"",
                iconData = iconPngBase64 is null ? null : $"data:image/png;base64,{iconPngBase64}",
            },
            new JsonSerializerOptions { WriteIndented = true, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });

    /// <summary>Whether the tool is installed in <paramref name="folder"/>, and whether it starts this program.</summary>
    public static (bool Installed, bool StartsThisProgram) Status(string folder, string exePath)
    {
        var file = Path.Combine(folder, FileName);
        if (!File.Exists(file)) return (false, false);
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(file));
            var path = json.RootElement.TryGetProperty("path", out var p) ? p.GetString() : null;
            return (true, path is not null && string.Equals(Path.GetFullPath(path), Path.GetFullPath(exePath), StringComparison.OrdinalIgnoreCase));
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException or ArgumentException)
        {
            return (true, false);
        }
    }

    public static void Install(string folder, string exePath, string? iconPngBase64)
    {
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, FileName), Definition(exePath, iconPngBase64));
    }

    public static void Remove(string folder)
    {
        var file = Path.Combine(folder, FileName);
        if (File.Exists(file)) File.Delete(file);
    }

    /// <summary>The icon shown on the ribbon (embedded in the program), as base64, or null if missing.</summary>
    public static string? IconBase64()
    {
        using var stream = typeof(ExternalTool).Assembly.GetManifestResourceStream("DaxExplorer.Helper.Assets.external-tool-icon.png");
        if (stream is null) return null;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return Convert.ToBase64String(memory.ToArray());
    }

    /// <summary>
    /// Started from the External Tools ribbon: the first argument is the report's engine address
    /// ("localhost:51234"), the second the database name. Null when the arguments aren't that.
    /// </summary>
    public static (int Port, string? Database)? ParseLaunch(IReadOnlyList<string> args)
    {
        if (args.Count == 0) return null;
        var match = ServerPattern().Match(args[0]);
        if (!match.Success || !int.TryParse(match.Groups["port"].Value, out var port) || port is <= 0 or > 65535) return null;
        return (port, args.Count > 1 && !args[1].StartsWith("--", StringComparison.Ordinal) ? args[1] : null);
    }

    [GeneratedRegex(@"^(localhost|127\.0\.0\.1|\[::1\]):(?<port>\d{1,5})$", RegexOptions.IgnoreCase)]
    private static partial Regex ServerPattern();
}

/// <summary>Where the External Tools file goes, and the program it should start.</summary>
public sealed record ExternalToolPlace(string Folder, string ExePath);

/// <summary>Runs this program again with administrator rights (Windows asks the user). Abstracted for tests.</summary>
public interface IElevation
{
    /// <returns>"ok", "cancelled" (the user said no), or "failed".</returns>
    string RunElevated(string argument);
}

internal sealed class ShellElevation : IElevation
{
    public string RunElevated(string argument)
    {
        var exe = Environment.ProcessPath;
        if (exe is null) return "failed";
        try
        {
            using var process = Process.Start(new ProcessStartInfo(exe, argument) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
            if (process is null) return "failed";
            process.WaitForExit(TimeSpan.FromSeconds(60));
            return process.HasExited && process.ExitCode == 0 ? "ok" : "failed";
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) // ERROR_CANCELLED: "No" on the Windows prompt
        {
            return "cancelled";
        }
        catch (Win32Exception)
        {
            return "failed";
        }
    }
}
