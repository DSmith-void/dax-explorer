/**
 * Asks Power BI the claims for one measure under one report-filter setup, through a running helper. Shared by
 * the Initech run (claimCheck.live.test.ts) and the run on a connected model (modelCheck.live.test.ts).
 * Read-only: every query is an EVALUATE.
 */
import type { QueryResult } from '../app/helperClient';
import type { FilterValue, ReportFilter } from '../engine/context/reportFilters';
import { buildStepQuery, rowColumns, rowKey, type RowChoice } from '../engine/context/stepQuery';
import { runMeasure, type MeasureRun, type RunModel } from './claimRun';

export interface ClaimClient {
  evaluate: (kind: 'scalar' | 'table', dax: string, maxRows?: number) => Promise<QueryResult>;
}

export interface Scenario {
  id: string;
  filters: ReportFilter[];
}

export interface Asked {
  run: MeasureRun;
  asked: number;
  confirmed: { id: string; expect: boolean | 'error' }[];
  /** One line each, in Markdown. */
  disagreements: string[];
  unaskable: string[];
  /** Claims left unasked because a query was too slow (see `slowMs`). */
  tooSlow: number;
  /** Time spent asking, in milliseconds. */
  ms: number;
}

/**
 * `slowMs`: once one query takes at least this long, the measure's remaining claims under this setup are left
 * unasked (counted in `tooSlow`), so a measure that is heavy on the model's data doesn't hold up the run.
 */
export async function askMeasure(client: ClaimClient, measureId: string, definition: string, scenario: Scenario, model?: RunModel, slowMs = Infinity): Promise<Asked> {
  const started = Date.now();
  let slow = false;
  const timed = async <T>(query: Promise<T>): Promise<T> => {
    const start = Date.now();
    try {
      return await query;
    } finally {
      if (Date.now() - start >= slowMs) slow = true;
    }
  };
  const rows = new Map<string, RowChoice>();
  const run = runMeasure(definition, scenario.filters, rows, model);
  // Pick the first row of each loop, in order, as the app does.
  for (const entry of run.timeline) {
    if (entry.kind !== 'iterate' || entry.nodeId === null) continue;
    const q = buildStepQuery(entry, run.options);
    if (q.kind !== 'rows' || slow) continue;
    try {
      const result = await timed(client.evaluate('table', q.dax, 1));
      if (result.rows.length === 0) continue;
      const { indexes } = rowColumns(result.columns);
      rows.set(rowKey('root', entry.nodeId), { columns: indexes.map((i) => result.columns[i]), values: indexes.map((i) => result.rows[0][i] as FilterValue) });
    } catch {
      // No row to pick: the steps inside stay unasked.
    }
  }
  const result: Asked = { run, asked: 0, confirmed: [], disagreements: [], unaskable: [], tooSlow: 0, ms: 0 };
  for (const claim of run.claims()) {
    const id = `${measureId}|${scenario.id}|${claim.id}`;
    if (!claim.query) {
      result.unaskable.push(`${id}: needs a picked row`);
      continue;
    }
    if (slow) {
      result.tooSlow++;
      continue;
    }
    result.asked++;
    let answer: boolean | string;
    try {
      const value = (await timed(client.evaluate('scalar', claim.query))).rows[0]?.[0];
      // ISFILTERED is asked as 1/0 (see claims.ts); other answers are reported as they are.
      answer = typeof value === 'boolean' ? value : value === 1 ? true : value === 0 ? false : `the value ${JSON.stringify(value)}`;
    } catch (e) {
      answer = claim.expect === 'error' ? 'error' : `an error: ${(e as Error).message.slice(0, 200)}`;
    }
    if (answer === claim.expect) result.confirmed.push({ id, expect: claim.expect });
    else {
      result.disagreements.push(
        `- **${measureId}** under *${scenario.id}*, step "${claim.step}": the app says ${claim.says}; Power BI says ${typeof answer === 'boolean' ? String(answer).toUpperCase() : answer}`,
      );
    }
  }
  result.ms = Date.now() - started;
  return result;
}
