using System.Drawing;
using System.Windows.Forms;

namespace DaxExplorer.Helper;

/// <summary>What the tray menu does; supplied by Program so the tray knows nothing about the server.</summary>
internal sealed record TrayActions(Action Open, Action Quit, Func<string?> ConnectedTo);

/// <summary>
/// DAX Explorer's icon in the taskbar's notification area (instead of a console window): Open, what it is
/// connected to, Quit. Runs its own Windows message loop on a separate thread.
/// </summary>
internal sealed class Tray : IDisposable
{
    private readonly Thread _thread;
    private readonly ManualResetEventSlim _ready = new();
    private NotifyIcon? _icon;
    private ApplicationContext? _context;
    private SynchronizationContext? _ui;

    private Tray(TrayActions actions)
    {
        _thread = new Thread(() => Run(actions)) { IsBackground = true, Name = "Tray" };
        _thread.SetApartmentState(ApartmentState.STA);
    }

    public static Tray Start(TrayActions actions)
    {
        var tray = new Tray(actions);
        tray._thread.Start();
        tray._ready.Wait(TimeSpan.FromSeconds(10));
        return tray;
    }

    private void Run(TrayActions actions)
    {
        Application.EnableVisualStyles();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        _ui = SynchronizationContext.Current;

        var connected = new ToolStripMenuItem { Enabled = false };
        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("Open DAX Explorer", null, (_, _) => actions.Open()));
        menu.Items[0].Font = new Font(menu.Items[0].Font, FontStyle.Bold);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(connected);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Quit", null, (_, _) => actions.Quit()));
        menu.Opening += (_, _) =>
        {
            var report = actions.ConnectedTo();
            connected.Text = report is null ? "Not connected" : $"Connected to: {report}";
        };

        _icon = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "DAX Explorer",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) actions.Open();
        };

        _context = new ApplicationContext();
        _ready.Set();
        Application.Run(_context);

        _icon.Visible = false;
        _icon.Dispose();
        menu.Dispose();
    }

    /// <summary>A short notice next to the tray icon.</summary>
    public void Notify(string title, string text) =>
        _ui?.Post(_ => _icon?.ShowBalloonTip(5000, title, text, ToolTipIcon.Info), null);

    public void Dispose()
    {
        _ui?.Post(_ => _context?.ExitThread(), null);
        _thread.Join(TimeSpan.FromSeconds(5));
        _ready.Dispose();
    }

    private static Icon LoadIcon()
    {
        using var stream = typeof(Tray).Assembly.GetManifestResourceStream("DaxExplorer.Helper.Assets.dax-explorer.ico");
        return stream is null ? SystemIcons.Application : new Icon(stream, SystemInformation.SmallIconSize);
    }
}
