using System.Runtime.InteropServices;

namespace DaxExplorer.Helper;

/// <summary>
/// DAX Explorer is a Windows program without a console window (it lives in the tray). Started from a
/// terminal (describe, development), it writes to that terminal instead.
/// </summary>
internal static class ConsoleWindow
{
    private const int AttachParentProcess = -1;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int processId);

    /// <summary>
    /// True when output reaches someone: redirected (a script reading it) or the terminal that started
    /// this program. False when double-clicked or started by Power BI: messages then need a window.
    /// </summary>
    public static bool UseParentTerminal()
    {
        if (Console.IsOutputRedirected || Console.IsErrorRedirected) return true;
        try
        {
            return AttachConsole(AttachParentProcess);
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            return false;
        }
    }
}
