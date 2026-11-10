import { useEffect, useState } from 'react';
import type { ConnectionInfo, DesktopInstanceInfo, HelperClient, HelperStatus, ModelMetadata } from '../app/helperClient';

interface DataSourceBarProps {
  client: HelperClient;
  /** Called whenever the connected model changes (null when disconnected). */
  onModelChange: (model: ModelMetadata | null, connection: ConnectionInfo | null) => void;
}

type View =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'needs-token' }
  | { kind: 'ready'; status: HelperStatus };

const reportLabel = (name: string | null) => name ?? 'an unnamed report';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Which data the app is working with, and the way to connect to your own.
 *
 * The default is the built-in examples (explanations only). Connecting is always the user's choice:
 * open Power BI Desktop reports are listed, but nothing is read until the user presses Connect.
 */
export function DataSourceBar({ client, onModelChange }: DataSourceBarProps) {
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [panelOpen, setPanelOpen] = useState(false);
  const [instances, setInstances] = useState<DesktopInstanceInfo[] | null>(null);
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  // Which action is running. Tracked separately so refreshing the report list never blocks or relabels Connect/Disconnect.
  const [action, setAction] = useState<'check' | 'load' | 'connect' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connecting = action === 'connect' || action === 'disconnect';

  async function loadInstances() {
    const list = await client.instances();
    setInstances(list);
    setSelectedPort((current) => (list.some((i) => i.port === current) ? current : (list[0]?.port ?? null)));
  }

  async function refreshStatus() {
    const availability = await client.check();
    if (availability.kind !== 'available') {
      setView(availability);
      onModelChange(null, null);
      return;
    }
    setView({ kind: 'ready', status: availability.status });
    if (availability.status.connection) {
      onModelChange(await client.model(), availability.status.connection);
    } else {
      onModelChange(null, null);
    }
  }

  async function run(kind: NonNullable<typeof action>, work: () => Promise<void>) {
    setAction(kind);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setAction((current) => (current === kind ? null : current));
    }
  }

  useEffect(() => {
    void run('check', refreshStatus);
    // Runs once on start; the client never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePanel() {
    const opening = !panelOpen;
    setPanelOpen(opening);
    // Listing open reports reads only their names, not their data.
    if (opening && view.kind === 'ready') void run('load', loadInstances);
  }

  const connection = view.kind === 'ready' ? view.status.connection : null;
  const summary = view.kind === 'ready' ? view.status.modelSummary : null;

  return (
    <section className={`data-bar${connection ? ' is-connected' : ''}`} aria-label="Data">
      <div className="data-bar-row" aria-live="polite">
        <span className="data-bar-label">Data</span>
        {view.kind === 'checking' ? (
          <span className="data-bar-muted">Checking…</span>
        ) : connection ? (
          <span>
            <strong>{reportLabel(connection.reportName)}</strong> <span className="data-bar-muted">in Power BI Desktop</span>
            {summary && (
              <span className="data-bar-muted">
                {' '}
                · {plural(summary.tables, 'table', 'tables')} · {plural(summary.measures, 'measure', 'measures')} ·{' '}
                {plural(summary.relationships, 'relationship', 'relationships')}
              </span>
            )}
          </span>
        ) : (
          <span>
            <strong>Built-in examples</strong> <span className="data-bar-muted">· explanations only, no numbers</span>
          </span>
        )}

        {view.kind !== 'checking' && (
          <span className="data-bar-actions">
            <button type="button" className="secondary-button" aria-expanded={panelOpen} onClick={togglePanel}>
              {connection ? 'Change' : 'Use my data'} {panelOpen ? '▴' : '▾'}
            </button>
            {connection && (
              <button
                type="button"
                className="secondary-button"
                disabled={connecting}
                onClick={() =>
                  void run('disconnect', async () => {
                    await client.disconnect();
                    setPanelOpen(false);
                    await refreshStatus();
                  })
                }
              >
                Disconnect
              </button>
            )}
          </span>
        )}
      </div>

      {panelOpen && (
        <div className="data-panel">
          {view.kind === 'unavailable' && (
            <div className="data-panel-help">
              <p>
                To work with your own Power BI data, start <strong>DAX Explorer</strong> (<code>DaxExplorer.exe</code>). It
                opens this app ready to connect to the reports open in Power BI Desktop on this computer.
              </p>
              <p className="data-bar-muted">
                Working from the source code? Run <code>npm run dev:connected</code> instead of <code>npm run dev</code>.
              </p>
            </div>
          )}

          {view.kind === 'needs-token' && (
            <p>
              DAX Explorer is running, but this page wasn't opened by it. Close this tab and use the window DAX Explorer opened
              (or the link it shows).
            </p>
          )}

          {view.kind === 'ready' && (
            <>
              <h3 className="data-panel-title">Reports open in Power BI Desktop</h3>
              {instances === null ? (
                <p className="data-bar-muted">Looking for open reports…</p>
              ) : instances.length === 0 ? (
                <p>No report is open in Power BI Desktop. Open one, then press Refresh.</p>
              ) : (
                <ul className="data-panel-list" role="radiogroup" aria-label="Report to connect to">
                  {instances.map((i) => (
                    <li key={i.port}>
                      <label>
                        <input
                          type="radio"
                          name="desktop-report"
                          checked={selectedPort === i.port}
                          onChange={() => setSelectedPort(i.port)}
                        />{' '}
                        {i.reportName ?? `Unnamed report (port ${i.port})`}
                        {connection?.port === i.port && <span className="data-bar-muted"> · connected</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="data-panel-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={connecting || selectedPort === null || connection?.port === selectedPort}
                  onClick={() =>
                    void run('connect', async () => {
                      await client.connect(selectedPort!);
                      setPanelOpen(false);
                      await refreshStatus();
                    })
                  }
                >
                  {action === 'connect' ? 'Connecting…' : 'Connect'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={action === 'load'}
                  onClick={() => void run('load', loadInstances)}
                >
                  {action === 'load' ? 'Refreshing…' : 'Refresh'}
                </button>
                <span className="data-bar-muted">
                  Nothing is read from a report until you press Connect. DAX Explorer reads its tables, columns and
                  measures; it stays on this computer.
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="data-bar-error">{error}</p>}
    </section>
  );
}
