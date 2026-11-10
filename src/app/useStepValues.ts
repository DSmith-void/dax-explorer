import { useEffect, useMemo, useRef, useState } from 'react';
import type { BindResult } from '../engine/binder/binder';
import { buildStepQuery, rowColumns, type RowChoice, type StepQuery } from '../engine/context/stepQuery';
import type { TimelineEntry } from '../engine/context/timeline';
import type { FilterValue, ReportFilter } from '../engine/context/reportFilters';
import type { Expr } from '../engine/parser/ast';
import type { HelperClient, QueryResult } from './helperClient';

/** At most this many rows are shown for a table or an iterator. */
export const PREVIEW_ROWS = 100;

export type ValueState =
  /** Not connected: values need a report. */
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; result: QueryResult; count: number | null }
  | { status: 'error'; message: string };

interface Options {
  client: HelperClient;
  /** Identifies the connected report; null when not connected (values come from it). */
  connectionKey: string | null;
  timeline: readonly TimelineEntry[];
  current: TimelineEntry | undefined;
  root: Expr | null;
  binding: BindResult | null;
  source: string;
  reportFilters: readonly ReportFilter[];
}

const keyOf = (q: StepQuery) => (q.kind === 'scalar' || q.kind === 'table' || q.kind === 'rows' ? `${q.kind}\u0000${q.dax}` : null);

/**
 * Real values for the timeline's steps, from the connected report. Only the current step is fetched;
 * results are kept, so stepping back is instant. A step inside an iterator needs one of its rows:
 * the iterator's rows are fetched and the first one is picked, until the user picks another.
 */
export function useStepValues({ client, connectionKey, timeline, current, root, binding, source, reportFilters }: Options) {
  const [rows, setRows] = useState<ReadonlyMap<number, RowChoice>>(new Map());
  const [cache, setCache] = useState<ReadonlyMap<string, ValueState>>(new Map());
  const inFlight = useRef(new Set<string>());
  const enabled = connectionKey !== null;

  // Picked rows belong to one expression and one set of report filters.
  const [rowsFor, setRowsFor] = useState({ root, reportFilters });
  if (rowsFor.root !== root || rowsFor.reportFilters !== reportFilters) {
    setRowsFor({ root, reportFilters });
    setRows(new Map());
  }

  // Building a query is cheap (no engine involved), so it isn't cached.
  const queryFor = useMemo(
    () =>
      (entry: TimelineEntry): StepQuery =>
        binding ? buildStepQuery(entry, { root, binding, source, reportFilters, rows }) : { kind: 'none', reason: '' },
    [root, binding, source, reportFilters, rows],
  );

  const stateOf = (q: StepQuery): ValueState => {
    const key = keyOf(q);
    if (!key) return { status: 'off' };
    if (!enabled) return { status: 'off' };
    return cache.get(key) ?? { status: 'loading' };
  };

  // What to fetch for the current step: its own query, or first the rows of the iterator it needs.
  const wanted = useMemo((): { query: StepQuery; pickFor: number | null } | null => {
    if (!enabled || !current) return null;
    let query = queryFor(current);
    let pickFor: number | null = null;
    for (let depth = 0; depth < 8 && query.kind === 'needs-row'; depth++) {
      const iteratorNodeId: number = query.iteratorNodeId;
      const iterator = timeline.find((e) => e.kind === 'iterate' && e.nodeId === iteratorNodeId);
      if (!iterator) return null;
      pickFor = iteratorNodeId;
      query = queryFor(iterator);
    }
    return keyOf(query) ? { query, pickFor } : null;
  }, [enabled, current, timeline, queryFor]);

  const cached = wanted ? cache.get(keyOf(wanted.query)!) : undefined;

  useEffect(() => {
    if (!wanted) return;
    const { query, pickFor } = wanted;
    const key = keyOf(query)!;
    const done = (state: ValueState) => setCache((previous) => new Map(previous).set(key, state));
    const pickFirst = (result: QueryResult) => {
      if (pickFor === null || result.rows.length === 0) return;
      const { indexes } = rowColumns(result.columns);
      const choice: RowChoice = { columns: indexes.map((i) => result.columns[i]), values: indexes.map((i) => result.rows[0][i] as FilterValue) };
      setRows((previous) => (previous.has(pickFor) ? previous : new Map(previous).set(pickFor, choice)));
    };
    if (cached?.status === 'ready') {
      pickFirst(cached.result);
      return;
    }
    if (cached || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    void (async () => {
      try {
        if (query.kind === 'scalar') {
          done({ status: 'ready', result: await client.evaluate('scalar', query.dax), count: null });
        } else if (query.kind === 'table' || query.kind === 'rows') {
          const [result, count] = await Promise.all([
            client.evaluate('table', query.dax, PREVIEW_ROWS),
            client.evaluate('scalar', query.countDax).then((r) => (typeof r.rows[0]?.[0] === 'number' ? (r.rows[0][0] as number) : null)),
          ]);
          done({ status: 'ready', result, count });
          pickFirst(result);
        }
      } catch (e) {
        done({ status: 'error', message: e instanceof Error ? e.message : 'The value could not be calculated.' });
      } finally {
        inFlight.current.delete(key);
      }
    })();
  }, [wanted, cached, client]);

  // Values belong to one connection: start over when it changes.
  const [cacheFor, setCacheFor] = useState(connectionKey);
  if (cacheFor !== connectionKey) {
    setCacheFor(connectionKey);
    setCache(new Map());
  }

  return {
    rows,
    queryFor,
    stateOf,
    pickRow: (iteratorNodeId: number, choice: RowChoice) => setRows((previous) => new Map(previous).set(iteratorNodeId, choice)),
  };
}
