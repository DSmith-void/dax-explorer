using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;

namespace DaxExplorer.Helper.Discovery;

/// <summary>
/// Windows-specific lookups used by discovery:
///  1. which process is listening on a loopback TCP port (iphlpapi GetExtendedTcpTable),
///  2. that process's parent (Toolhelp snapshot): the Power BI Desktop window,
///  3. the report name from that window's title ("Report - Power BI Desktop").
/// Read-only; no elevated rights needed.
/// </summary>
internal static class WindowsProcesses
{
    public static ListenerOwner? FindListener(int port)
    {
        var pid = FindListeningProcessId(port);
        if (pid is null) return null;
        return new ListenerOwner(pid.Value, TryGetReportName(pid.Value));
    }

    private static string? TryGetReportName(int engineProcessId)
    {
        try
        {
            var parentId = FindParentProcessId(engineProcessId);
            if (parentId is null) return null;
            using var parent = Process.GetProcessById(parentId.Value);
            if (!parent.ProcessName.Equals("PBIDesktop", StringComparison.OrdinalIgnoreCase)) return null;
            return ReportNameFromTitle(parent.MainWindowTitle);
        }
        catch (ArgumentException)
        {
            return null; // parent exited
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    /// <summary>"Sales Report - Power BI Desktop" → "Sales Report".</summary>
    internal static string? ReportNameFromTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        const string suffix = " - Power BI Desktop";
        var name = title.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) ? title[..^suffix.Length] : title;
        name = name.Trim();
        return name.Length == 0 ? null : name;
    }

    // ------------------------------------------------------------------ listening ports

    private const int AfInet = 2;
    private const int TcpTableOwnerPidListener = 3;
    private const int ErrorInsufficientBuffer = 122;

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern int GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int addressFamily, int tableClass, int reserved);

    private static int? FindListeningProcessId(int port)
    {
        var size = 0;
        var result = GetExtendedTcpTable(IntPtr.Zero, ref size, false, AfInet, TcpTableOwnerPidListener, 0);
        if (result != ErrorInsufficientBuffer && result != 0) return null;

        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (GetExtendedTcpTable(buffer, ref size, false, AfInet, TcpTableOwnerPidListener, 0) != 0) return null;
            // MIB_TCPTABLE_OWNER_PID: DWORD count, then rows of 6 DWORDs:
            // state, localAddr, localPort, remoteAddr, remotePort, owningPid.
            var count = Marshal.ReadInt32(buffer);
            const int rowSize = 6 * sizeof(int);
            for (var i = 0; i < count; i++)
            {
                var row = buffer + sizeof(int) + i * rowSize;
                var localAddress = (uint)Marshal.ReadInt32(row, 4);
                var rawPort = Marshal.ReadInt32(row, 8);
                var localPort = ((rawPort & 0xFF) << 8) | ((rawPort >> 8) & 0xFF); // network byte order
                if (localPort != port) continue;
                // Only accept engines listening on loopback (127.0.0.1) or all interfaces.
                var address = new IPAddress(localAddress);
                if (!IPAddress.IsLoopback(address) && !address.Equals(IPAddress.Any)) continue;
                return Marshal.ReadInt32(row, 20);
            }
            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    // ------------------------------------------------------------------ parent process

    private const uint Th32CsSnapProcess = 0x00000002;
    private static readonly IntPtr InvalidHandleValue = new(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private static int? FindParentProcessId(int processId)
    {
        var snapshot = CreateToolhelp32Snapshot(Th32CsSnapProcess, 0);
        if (snapshot == InvalidHandleValue) return null;
        try
        {
            var entry = new ProcessEntry32 { dwSize = (uint)Marshal.SizeOf<ProcessEntry32>() };
            if (!Process32First(snapshot, ref entry)) return null;
            do
            {
                if (entry.th32ProcessID == (uint)processId) return (int)entry.th32ParentProcessID;
            } while (Process32Next(snapshot, ref entry));
            return null;
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }
}
