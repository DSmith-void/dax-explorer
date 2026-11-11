import type { StepQuery } from '../engine/context/stepQuery';

/** One storage-engine scan, as Power BI Desktop's engine reported it (see the helper's /api/timings). */
export interface TimingScan {
  /** The scan in the engine's own query language (xmSQL). */
  text: string;
  durationMs: number | null;
  cpuMs: number | null;
  /** Milliseconds after the query started, when the engine said. */
  startMs: number | null;
  endMs: number | null;
  /** Answered from memory (the cache) instead of scanning. */
  fromCache: boolean;
}

export interface TimingResult {
  totalMs: number;
  totalCpuMs: number | null;
  scans: TimingScan[];
  rows: number;
  clearedCache: boolean;
}

export interface TimingSummary {
  totalMs: number;
  /** Time the storage engine was busy (overlapping scans counted once). */
  storageMs: number;
  /** The rest of the total: worked out, not reported by the engine. */
  formulaMs: number;
  scans: number;
  cacheHits: number;
  /** Scans that call back to the formula engine for each row (CallbackDataID). */
  callbacks: number;
  verdict: string;
  notes: string[];
}

/** Below this, the split between reading and calculating doesn't say much. */
export const TOO_QUICK_MS = 20;

/** The request for /api/timings that runs a step's query, or null when there is none. */
export function timingRequest(query: StepQuery): { kind: 'scalar' | 'table'; dax: string } | null {
  if (query.kind === 'scalar') return { kind: query.visual ? 'table' : 'scalar', dax: query.dax };
  if (query.kind === 'table' || query.kind === 'rows') return { kind: 'table', dax: query.dax };
  return null;
}

/** Busy time of the scans: their time intervals merged, so scans running side by side count once. */
function busyMs(scans: readonly TimingScan[]): number {
  const timed = scans.filter((s) => s.startMs !== null && s.endMs !== null && s.endMs >= s.startMs);
  if (timed.length !== scans.length) return scans.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const sorted = [...timed].sort((a, b) => a.startMs! - b.startMs!);
  let total = 0;
  let start = -Infinity;
  let end = -Infinity;
  for (const s of sorted) {
    if (s.startMs! > end) {
      if (end > start) total += end - start;
      start = s.startMs!;
      end = s.endMs!;
    } else {
      end = Math.max(end, s.endMs!);
    }
  }
  if (end > start) total += end - start;
  return total;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where the time went, in plain words. Only what the engine reported, plus the worked-out remainder. */
export function summarizeTimings(result: TimingResult): TimingSummary {
  const scanned = result.scans.filter((s) => !s.fromCache);
  const cacheHits = result.scans.length - scanned.length;
  const storageMs = Math.min(result.totalMs, Math.round(busyMs(scanned)));
  const formulaMs = Math.max(0, result.totalMs - storageMs);
  const callbacks = scanned.filter((s) => s.text.includes('CallbackDataID')).length;

  let verdict: string;
  if (result.totalMs < TOO_QUICK_MS) {
    verdict = `Fast: ${result.totalMs} ms. Too quick for the split between reading and calculating to mean much.`;
  } else if (formulaMs >= result.totalMs * 0.6) {
    verdict = `Most of the time (${formulaMs} of ${result.totalMs} ms) is spent calculating (formula engine). That part works one step at a time; the Slow hints may show why.`;
  } else if (storageMs >= result.totalMs * 0.6) {
    verdict = `Most of the time (${storageMs} of ${result.totalMs} ms) is spent reading data (storage engine), in ${plural(scanned.length, 'scan')}. Large tables, many columns or many scans make this slower.`;
  } else {
    verdict = `The time is split between reading data (${storageMs} ms) and calculating (${formulaMs} ms).`;
  }

  const notes: string[] = [];
  if (callbacks > 0) {
    notes.push(
      `${plural(callbacks, 'scan')} ${callbacks === 1 ? 'calls' : 'call'} back to the formula engine for each row (CallbackDataID in the scan): the storage engine can't do that part on its own, so it is slower and its results aren't kept in memory.`,
    );
  }
  if (cacheHits > 0) {
    notes.push(`${plural(cacheHits, 'scan')} came from memory (cache), from an earlier run. Clear the cache first to time a cold start.`);
  }
  return { totalMs: result.totalMs, storageMs, formulaMs, scans: scanned.length, cacheHits, callbacks, verdict, notes };
}
