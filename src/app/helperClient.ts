/**
 * Talks to the optional local helper, which connects to Power BI Desktop.
 *
 * Security: the helper opens the app with a secret token in the URL fragment ("#token=...").
 * Fragments are never sent over the network. The app moves the token into sessionStorage
 * (this browser tab only), removes it from the address bar, and sends it with every request.
 */

import type { TimingResult } from './timings';

export const TOKEN_HEADER = 'X-DaxExplorer-Token';
const SESSION_KEY = 'dax-explorer-helper-token';

// ---------------------------------------------------------------- types (match the helper's JSON)

export interface DesktopInstanceInfo {
  port: number;
  reportName: string | null;
}

export interface ConnectionInfo {
  source: string;
  port: number;
  reportName: string | null;
  connectedAt: string;
  /** True when connected to DAX Explorer's own sample report (Initech). */
  isSample: boolean;
}

export interface ModelSummary {
  tables: number;
  columns: number;
  measures: number;
  relationships: number;
}

export interface HelperStatus {
  helperVersion: string;
  connection: ConnectionInfo | null;
  modelSummary: ModelSummary | null;
}

export interface TableInfo {
  name: string;
  isHidden: boolean;
  expression: string | null;
  /** "Time" when the table is marked as a date table (older helpers don't send it). */
  dataCategory?: string | null;
}

export interface ColumnInfo {
  table: string;
  name: string;
  dataType: string;
  isHidden: boolean;
  kind: string;
  expression: string | null;
  /** The column (of the same table) this one is sorted by in Power BI, e.g. Month by "Month Number". */
  sortByColumn?: string | null;
}

export interface MeasureInfo {
  table: string;
  name: string;
  expression: string;
  formatString: string | null;
  isHidden: boolean;
  displayFolder: string | null;
}

export interface RelationshipInfo {
  fromTable: string;
  fromColumn: string;
  fromCardinality: string;
  toTable: string;
  toColumn: string;
  toCardinality: string;
  isActive: boolean;
  crossFilteringBehavior: string;
}

export interface ModelMetadata {
  databaseName: string;
  tables: TableInfo[];
  columns: ColumnInfo[];
  measures: MeasureInfo[];
  relationships: RelationshipInfo[];
}

/** A value from a query. Dates arrive as { date: "yyyy-MM-ddTHH:mm:ss" }. */
export type QueryValue = string | number | boolean | null | { date: string };

export interface QueryResult {
  columns: string[];
  rows: QueryValue[][];
  /** True when there were more rows than requested. */
  truncated: boolean;
}

/** A visual's query captured from Power BI Desktop. */
export interface CapturedQuery {
  id: number;
  /** When it was captured (ISO time). */
  at: string;
  text: string;
}

export interface CaptureStatus {
  listening: boolean;
  /** When listening stops by itself (ISO time), or null. */
  stopsAt: string | null;
  /** Queries captured after the id that was asked for. */
  queries: CapturedQuery[];
}

// ---------------------------------------------------------------- token handling

/** Pure: the token from a URL fragment such as "#token=abc", or null. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('token');
  return token && token.length >= 16 ? token : null;
}

/**
 * Reads the token from the address bar (first visit) or this tab's session storage (reloads),
 * and removes it from the address bar so it isn't bookmarked or shared by accident.
 */
export function takeHelperToken(): string | null {
  const fromHash = tokenFromHash(window.location.hash);
  if (fromHash) {
    try {
      sessionStorage.setItem(SESSION_KEY, fromHash);
    } catch {
      // Without storage the token still works until the page is reloaded.
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return fromHash;
  }
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- client

/** Whether the helper can be used from this page. */
export type HelperAvailability =
  | { kind: 'available'; status: HelperStatus }
  /** The helper is running, but this page was not opened with its link. */
  | { kind: 'needs-token' }
  /** No helper (normal for the plain web app): symbolic mode only. */
  | { kind: 'unavailable' };

export class HelperError extends Error {}

export interface ExternalToolStatus {
  installed: boolean;
  /** False when the installed button starts another copy of DaxExplorer.exe (for example, one moved elsewhere). */
  startsThisProgram: boolean;
}

export interface HelperClient {
  check(): Promise<HelperAvailability>;
  instances(): Promise<DesktopInstanceInfo[]>;
  connect(port: number): Promise<void>;
  disconnect(): Promise<void>;
  model(): Promise<ModelMetadata>;
  /** Opens the sample in Power BI Desktop unless it is already open. */
  openSample(): Promise<'open' | 'starting'>;
  /** Connects to the sample if Desktop has finished loading it. */
  connectSample(): Promise<'connected' | 'waiting'>;
  /**
   * Calculates a DAX expression on the connected report (read-only): one value ("scalar") or the
   * rows of a table expression ("table", at most maxRows). The helper writes the EVALUATE statement.
   */
  evaluate(kind: 'scalar' | 'table', dax: string, maxRows?: number): Promise<QueryResult>;
  /** Runs the same query while tracing it: where its time goes (optionally clearing the report's cache first). */
  timings(kind: 'scalar' | 'table', dax: string, clearCache: boolean): Promise<TimingResult>;
  /**
   * Starts listening to the queries the connected report's visuals send: for a few minutes, or until the
   * report is disconnected (`untilDisconnect`, the "listen while connected" setting).
   */
  startCapture(untilDisconnect?: boolean): Promise<void>;
  stopCapture(): Promise<void>;
  /** Whether it is listening, and the queries captured after `after` (an id; 0 for all). */
  captured(after: number): Promise<CaptureStatus>;
  /** The visual queries Power BI Desktop ran most recently (from the engine's session list; usually the last visual). */
  recentVisuals(): Promise<{ at: string | null; text: string }[]>;
  /** Whether DAX Explorer is on Power BI Desktop's External Tools ribbon (and starts this copy of it). */
  externalTool(): Promise<ExternalToolStatus>;
  /** Adds or removes it; Windows asks for administrator rights first. */
  changeExternalTool(change: 'install' | 'remove'): Promise<ExternalToolStatus & { result: 'ok' | 'cancelled' | 'failed' }>;
}

export function createHelperClient(token: string | null, fetchImpl: typeof fetch = (...args) => fetch(...args)): HelperClient {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (token) headers.set(TOKEN_HEADER, token);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetchImpl(path, { ...init, headers, cache: 'no-store' });
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await call(path, init);
    } catch {
      throw new HelperError('The helper is not responding. Is it still running?');
    }
    if (!response.ok) throw new HelperError(await errorMessage(response));
    return (await response.json()) as T;
  }

  return {
    async check() {
      let response: Response;
      try {
        response = await call('/api/status');
      } catch {
        return { kind: 'unavailable' };
      }
      if (response.status === 401) return { kind: 'needs-token' };
      const type = response.headers.get('Content-Type') ?? '';
      if (!response.ok || !type.includes('application/json')) return { kind: 'unavailable' };
      return { kind: 'available', status: (await response.json()) as HelperStatus };
    },
    instances: () => json<DesktopInstanceInfo[]>('/api/desktop/instances'),
    async connect(port) {
      await json('/api/connect', { method: 'POST', body: JSON.stringify({ port }) });
    },
    async disconnect() {
      await json('/api/disconnect', { method: 'POST' });
    },
    model: () => json<ModelMetadata>('/api/model'),
    async openSample() {
      return (await json<{ state: 'open' | 'starting' }>('/api/sample/open', { method: 'POST' })).state;
    },
    async connectSample() {
      return (await json<{ state: 'connected' | 'waiting' }>('/api/sample/connect', { method: 'POST' })).state;
    },
    async startCapture(untilDisconnect = false) {
      await json(`/api/capture/start${untilDisconnect ? '?untilDisconnect=true' : ''}`, { method: 'POST' });
    },
    async externalTool() {
      return json<ExternalToolStatus>('/api/external-tool');
    },
    async changeExternalTool(change) {
      return json<ExternalToolStatus & { result: 'ok' | 'cancelled' | 'failed' }>(`/api/external-tool/${change}`, { method: 'POST' });
    },
    async recentVisuals() {
      return (await json<{ queries: { at: string | null; text: string }[] }>('/api/visuals/recent')).queries;
    },
    async stopCapture() {
      await json('/api/capture/stop', { method: 'POST' });
    },
    captured: (after) => json<CaptureStatus>(`/api/capture?after=${after}`),
    evaluate: (kind, dax, maxRows) => json<QueryResult>('/api/evaluate', { method: 'POST', body: JSON.stringify({ kind, dax, maxRows }) }),
    timings: (kind, dax, clearCache) => json<TimingResult>('/api/timings', { method: 'POST', body: JSON.stringify({ kind, dax, clearCache }) }),
  };
}

// ---------------------------------------------------------------- the sample

export type SampleProgress = 'opening' | 'loading';

export interface StartSampleOptions {
  /** How often to check whether Desktop has loaded the sample. */
  intervalMs?: number;
  /** How long to wait for Desktop before giving up. Starting Desktop can take a minute or more. */
  timeoutMs?: number;
  onProgress?: (progress: SampleProgress) => void;
  /** Waits; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Opens the sample in Power BI Desktop (if needed) and connects once Desktop has loaded it.
 * Throws a HelperError with a plain explanation if Desktop doesn't load it in time.
 */
export async function startSample(client: HelperClient, options: StartSampleOptions = {}): Promise<void> {
  const { intervalMs = 2000, timeoutMs = 180_000, onProgress, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = options;
  onProgress?.('opening');
  const opened = await client.openSample();
  onProgress?.(opened === 'open' ? 'loading' : 'opening');
  for (let waited = 0; ; waited += intervalMs) {
    if ((await client.connectSample()) === 'connected') return;
    if (waited >= timeoutMs) {
      throw new HelperError(
        'Power BI Desktop has not finished opening the sample yet. If it is still starting, wait until the report is open and press Use sample data again.',
      );
    }
    await sleep(intervalMs);
    onProgress?.('loading');
  }
}

/** The helper's own message ({ error } or a problem title/detail), or a generic one. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; title?: string; detail?: string };
    if (body.error) return body.error;
    if (body.title) return body.detail ? `${body.title} ${body.detail}` : body.title;
  } catch {
    // fall through
  }
  return `The helper returned an error (${response.status}).`;
}
