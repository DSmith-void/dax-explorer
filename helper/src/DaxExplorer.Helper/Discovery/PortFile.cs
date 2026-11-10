using System.Globalization;
using System.Text;

namespace DaxExplorer.Helper.Discovery;

/// <summary>
/// Reads the msmdsrv.port.txt file that Power BI Desktop writes for its local engine.
/// Desktop writes the port as UTF-16 text, usually without a byte-order mark;
/// other encodings are accepted defensively.
/// </summary>
internal static class PortFile
{
    public const string RelativePath = "Data\\msmdsrv.port.txt";

    /// <summary>Returns the port, or null if the content is not a valid TCP port.</summary>
    public static int? Parse(ReadOnlySpan<byte> bytes)
    {
        string text;
        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
        {
            text = Encoding.Unicode.GetString(bytes[2..]); // UTF-16 LE with BOM
        }
        else if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        {
            text = Encoding.UTF8.GetString(bytes[3..]); // UTF-8 with BOM
        }
        else if (bytes.Length >= 2 && bytes[1] == 0)
        {
            text = Encoding.Unicode.GetString(bytes); // UTF-16 LE without BOM (what Desktop writes)
        }
        else
        {
            text = Encoding.ASCII.GetString(bytes);
        }

        var trimmed = text.Trim().Trim('\0').Trim();
        return int.TryParse(trimmed, NumberStyles.None, CultureInfo.InvariantCulture, out var port) && port is > 0 and <= 65535
            ? port
            : null;
    }
}
