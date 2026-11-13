import { useEffect, useMemo, useRef, useState } from 'react';
import { buildStepQuery, dateRangeQueries, rowColumns, rowKey, type RowChoice, type StepQuery, type StepQueryOptions } from '../engine/context/stepQuery';
import type { FilterValue, ReportFilter } from '../engine/context/reportFilters';
import { callersOf, type FlatEntry, type Frame } from './frames';
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
  /** The flat timeline (with any measures stepped into). */
  timeline: readonly FlatEntry[];
  current: FlatEntry | undefined;
  /** The measure being explained. */
  rootFrame: Frame | null;
  reportFilters: readonly ReportFilter[];
}

const keyOf = (q: StepQuery) => (q.kind === 'scalar' || q.kind === 'table' || q.kind === 'rows' ? `${q.kind}\u0000${q.dax}` : null);

/**
 * Real values for the timeline's steps, from the connected report. Only the current step is fetched;
 * results are kept, so stepping back is instant. A step inside an iterator needs one of its rows:
 * the iterator's rows are fetched and the first one is picked, until the user picks another.
 */
export function useStepValues({ client, connectionKey, timeline, current, rootFrame, reportFilters }: Options) {
  const [rows, setRows] = useState<ReadonlyMap<string, RowChoice>>(new Map());
  const [cache, setCache] = useState<ReadonlyMap<string, ValueState>>(new Map());
  const inFlight = useRef(new Set<string>());
  const enabled = connectionKey !== null;

  // Picked rows belong to one expression and one set of report filters.
  const root = rootFrame?.result ?? null;
  const [rowsFor, setRowsFor] = useState({ root, reportFilters });
  if (rowsFor.root !== root || rowsFor.reportFilters !== reportFilters) {
    setRowsFor({ root, reportFilters });
    setRows(new Map());
  }

  // Building a query is cheap (no engine involved), so it isn't cached.
  const optionsFor = useMemo(
    () =>
      (entry: FlatEntry): StepQueryOptions | null => {
        const { frame } = entry;
        if (!frame.binding) return null;
        return {
          root: frame.result.parse?.root ?? null,
          binding: frame.binding,
          source: frame.result.text,
          reportFilters,
          rows,
          frameKey: frame.key,
          callers: callersOf(frame),
        };
      },
    [reportFilters, rows],
  );
  const queryFor = useMemo(
    () =>
      (entry: FlatEntry): StepQuery => {
        const options = optionsFor(entry);
        return options ? buildStepQuery(entry, options) : { kind: 'none', reason: '' };
      },
    [optionsFor],
  );
  /** For a step that changes a date filter: the queries for its dates before and inside it, and all dates. */
  const dateRangeFor = useMemo(
    () => (entry: FlatEntry) => {
      const options = optionsFor(entry);
      const queries = options ? dateRangeQueries(entry, options) : null;
      return queries ? { ...queries, all: { kind: 'scalar', dax: queries.all } as StepQuery } : null;
    },
    [optionsFor],
  );

  const stateOf = (q: StepQuery): ValueState => {
    const key = keyOf(q);
    if (!key) return { status: 'off' };
    if (!enabled) return { status: 'off' };
    return cache.get(key) ?? { status: 'loading' };
  };

  // What to fetch for the current step: its own query, or first the rows of the iterator it needs.
  const wanted = useMemo((): { query: StepQuery; pickFor: string | null } | null => {
    if (!enabled || !current) return null;
    let query = queryFor(current);
    let pickFor: string | null = null;
    for (let depth = 0; depth < 8 && query.kind === 'needs-row'; depth++) {
      const { frameKey, iteratorNodeId } = query;
      const iterator = timeline.find((e) => e.kind === 'iterate' && e.nodeId === iteratorNodeId && e.frame.key === frameKey);
      if (!iterator) return null;
      pickFor = rowKey(frameKey, iteratorNodeId);
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
        if (query.kind === 'scalar' && query.visual) {
          // The visual's own query, filtered to one row: the value is its last column (no row: BLANK).
          const table = await client.evaluate('table', query.dax, 2);
          const value = table.rows[0]?.[table.columns.length - 1] ?? null;
          done({ status: 'ready', result: { columns: ['value'], rows: [[value]], truncated: false }, count: null });
        } else if (query.kind === 'scalar') {
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

  // The earlier steps' single values (shown in the story so far and next to the code). Picking another row
  // changes the query of every step inside that iterator, so their values are fetched again, one at a time,
  // once the current step has its value (the step being looked at always comes first).
  const backlog = useMemo(() => {
    if (!enabled || !current) return [];
    const at = timeline.indexOf(current);
    // On a "goes row by row" step, where a row is picked: also the steps inside that loop, which show the
    // picked row's values (they come right after it, one level deeper, until the loop's last step).
    let end = at;
    if (current.kind === 'iterate') {
      while (end + 1 < timeline.length && timeline[end + 1].frame === current.frame && timeline[end + 1].depth > current.depth) end++;
    }
    // Fetched from the end of this list: the loop's steps first (the row was just picked), then the earlier ones.
    return [...timeline.slice(Math.max(0, at - 60), Math.max(0, at)), ...timeline.slice(at + 1, end + 1).reverse()]
      .map(queryFor)
      .filter((q): q is Extract<StepQuery, { kind: 'scalar' }> => q.kind === 'scalar' && !cache.has(keyOf(q)!));
  }, [enabled, current, timeline, queryFor, cache]);
  const currentSettled = !wanted || (cached !== undefined && cached.status !== 'loading');
  useEffect(() => {
    if (!currentSettled || inFlight.current.size > 0) return;
    const query = backlog.at(-1);
    if (!query) return;
    const key = keyOf(query)!;
    inFlight.current.add(key);
    const done = (state: ValueState) => setCache((previous) => new Map(previous).set(key, state));
    void (async () => {
      try {
        if (query.visual) {
          const table = await client.evaluate('table', query.dax, 2);
          const value = table.rows[0]?.[table.columns.length - 1] ?? null;
          done({ status: 'ready', result: { columns: ['value'], rows: [[value]], truncated: false }, count: null });
        } else {
          done({ status: 'ready', result: await client.evaluate('scalar', query.dax), count: null });
        }
      } catch (e) {
        done({ status: 'error', message: e instanceof Error ? e.message : 'The value could not be calculated.' });
      } finally {
        inFlight.current.delete(key);
      }
    })();
  }, [backlog, currentSettled, client]);

  // The current step's date ranges (single values), when it changes a date filter.
  const rangeQueries = useMemo(() => {
    if (!enabled || !current) return [];
    const range = dateRangeFor(current);
    return range ? [range.before, range.after, range.all].filter((q) => q.kind === 'scalar') : [];
  }, [enabled, current, dateRangeFor]);
  useEffect(() => {
    for (const query of rangeQueries) {
      if (query.kind !== 'scalar') continue;
      const key = keyOf(query)!;
      if (cache.has(key) || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      void client
        .evaluate('scalar', query.dax)
        .then((result) => setCache((previous) => new Map(previous).set(key, { status: 'ready', result, count: null })))
        .catch((e: unknown) =>
          setCache((previous) => new Map(previous).set(key, { status: 'error', message: e instanceof Error ? e.message : 'The dates could not be worked out.' })),
        )
        .finally(() => inFlight.current.delete(key));
    }
  }, [rangeQueries, cache, client]);

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
    dateRangeFor,
    /** Picks a row of an iterator in one measure (by the measure's frame key). */
    pickRow: (frameKey: string, iteratorNodeId: number, choice: RowChoice) =>
      setRows((previous) => new Map(previous).set(rowKey(frameKey, iteratorNodeId), choice)),
  };
}
