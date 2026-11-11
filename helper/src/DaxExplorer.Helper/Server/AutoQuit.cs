namespace DaxExplorer.Helper.Server;

/// <summary>
/// DAX Explorer started from Power BI's External Tools ribbon quits by itself a little while after the last
/// Power BI Desktop closes (with a notice first). Started on its own (double-click), it keeps running until
/// Quit; a later double-click also turns the automatic quit off.
/// </summary>
public sealed class AutoQuit(TimeProvider clock, TimeSpan grace)
{
    public enum Step { Nothing, Warn, Quit }

    private readonly Lock _lock = new();
    private bool _armed;
    private DateTimeOffset? _noDesktopSince;

    public static readonly TimeSpan DefaultGrace = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan CheckEvery = TimeSpan.FromSeconds(10);

    public bool Armed
    {
        get
        {
            lock (_lock) return _armed;
        }
    }

    /// <summary>Started (or asked again) from the ribbon: quit once Power BI Desktop is gone.</summary>
    public void Arm()
    {
        lock (_lock) _armed = true;
    }

    /// <summary>Started on its own: stay until the person chooses Quit.</summary>
    public void Disarm()
    {
        lock (_lock)
        {
            _armed = false;
            _noDesktopSince = null;
        }
    }

    /// <summary>
    /// Called regularly with the number of open Power BI Desktop reports. Warn once when the last one has
    /// closed, Quit when none has come back within the grace period.
    /// </summary>
    public Step Check(int openReports)
    {
        lock (_lock)
        {
            if (!_armed || openReports > 0)
            {
                _noDesktopSince = null;
                return Step.Nothing;
            }
            var now = clock.GetUtcNow();
            if (_noDesktopSince is null)
            {
                _noDesktopSince = now;
                return Step.Warn;
            }
            return now - _noDesktopSince >= grace ? Step.Quit : Step.Nothing;
        }
    }
}
