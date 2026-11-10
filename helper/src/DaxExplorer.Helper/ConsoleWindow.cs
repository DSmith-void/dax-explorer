using System.Runtime.InteropServices;

namespace DaxExplorer.Helper;

/// <summary>Facts about the console window DAX Explorer is running in.</summary>
internal static class ConsoleWindow
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetConsoleProcessList(uint[] processList, uint processCount);

    /// <summary>
    /// True when this process is the only one attached to its console, which is the case when it was
    /// started by double-clicking (Windows creates a window just for it). From a terminal, the shell
    /// shares the console, so this is false and nothing waits for a key press.
    /// </summary>
    public static bool IsOwnedOnlyByThisProcess()
    {
        try
        {
            if (Console.IsInputRedirected) return false;
            var processes = new uint[4];
            return GetConsoleProcessList(processes, (uint)processes.Length) == 1;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            return false;
        }
    }
}
