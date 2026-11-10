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

/**
 * Shows whether the app is connected to Power BI Desktop and lets the user connect.
 * Without the local helper the app works as before (explanations only), and this bar says so briefly.
 */
export function DataSourceBar({ client, onModelChange }: DataSourceBarProps) {
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [instances, setInstances] = useState<DesktopInstanceInfo[] | null>(null);
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await loadInstances();
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run(refreshStatus);
    // Runs once on start; the client never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view.kind === 'checking') return null;

  if (view.kind === 'unavailable') {
    return (
      <div className="data-source-bar is-quiet" role="status">
        Working without data: explanations only. To use your own Power BI data, start the DAX Explorer helper (see the
        README).
      </div>
    );
  }

  if (view.kind === 'needs-token') {
    return (
      <div className="data-source-bar is-warning" role="status">
        The helper is running, but this page wasn't opened from it. Use the link shown in the helper's window to connect to
        Power BI Desktop.
      </div>
    );
  }

  const connection = view.status.connection;
  const summary = view.status.modelSummary;

  return (
    <div className={`data-source-bar${connection ? ' is-connected' : ''}`} aria-live="polite">
      <span className="data-source-label">Power BI Desktop</span>
      {connection ? (
        <>
          <span>
            Connected to <strong>{reportLabel(connection.reportName)}</strong>
            {summary && (
              <span className="data-source-summary">
                {' '}
                · {summary.tables} {summary.tables === 1 ? 'table' : 'tables'} · {summary.measures}{' '}
                {summary.measures === 1 ? 'measure' : 'measures'} · {summary.relationships}{' '}
                {summary.relationships === 1 ? 'relationship' : 'relationships'}
              </span>
            )}
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void run(async () => {
              await client.disconnect();
              await refreshStatus();
            })}
          >
            Disconnect
          </button>
        </>
      ) : instances && instances.length === 0 ? (
        <>
          <span>No Power BI Desktop report is open. Open one, then refresh.</span>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(loadInstances)}>
            Refresh
          </button>
        </>
      ) : (
        <>
          <label className="data-source-pick">
            <span className="visually-hidden">Report to connect to</span>
            <select
              value={selectedPort ?? ''}
              disabled={busy || !instances}
              onChange={(e) => setSelectedPort(Number(e.target.value))}
            >
              {(instances ?? []).map((i) => (
                <option key={i.port} value={i.port}>
                  {i.reportName ?? `Unnamed report (port ${i.port})`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || selectedPort === null}
            onClick={() => void run(async () => {
              await client.connect(selectedPort!);
              await refreshStatus();
            })}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(loadInstances)}>
            Refresh
          </button>
        </>
      )}
      {error && <span className="data-source-error">{error}</span>}
    </div>
  );
}
