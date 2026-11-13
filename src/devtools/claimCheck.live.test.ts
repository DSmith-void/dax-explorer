/**
 * The claim checker, live: asks Power BI Desktop every claim the explanations make, for every measure in the
 * library under every report-filter setup, and reports each disagreement. Read-only.
 *
 * Runs only when asked, against a running helper connected to the synthetic Initech report (check the Power BI
 * Desktop window titles first, as for every live query):
 *   CLAIMS_LIVE=1 CLAIMS_HELPER=http://127.0.0.1:5093 DAXEXPLORER_HELPER_TOKEN=… npx vitest run src/devtools -u
 * It refuses unless the helper sees exactly one Power BI Desktop report, Initech. With -u it writes the report
 * (claims.report.md, not committed) and the claims Power BI confirmed (claims.confirmed.json), which the
 * normal tests then guard.
 */
import { describe, expect, it } from 'vitest';
import { createHelperClient } from '../app/helperClient';
import type { FilterValue } from '../engine/context/reportFilters';
import { buildStepQuery, rowColumns, rowKey, type RowChoice } from '../engine/context/stepQuery';
import { CLAIM_LIBRARY, CLAIM_SCENARIOS } from './claimLibrary';
import { runMeasure } from './claimRun';

declare const process: { env: Record<string, string | undefined> };
const live = process.env.CLAIMS_LIVE === '1';

describe.skipIf(!live)('claim checker (live, Initech only)', () => {
  it('asks Power BI every claim', async () => {
    const base = process.env.CLAIMS_HELPER ?? 'http://127.0.0.1:5093';
    const client = createHelperClient(process.env.DAXEXPLORER_HELPER_TOKEN ?? null, (path, init) => fetch(base + String(path), init));
    // Guard: only the synthetic Initech report.
    const instances = await client.instances();
    expect(instances.map((i) => i.reportName), 'the only open Power BI Desktop report must be Initech').toEqual(['Initech']);
    const health = await client.check();
    expect(health.kind === 'available' ? health.status.connection?.reportName : null, 'the helper must be connected to Initech').toBe('Initech');

    const confirmed: { id: string; expect: boolean | 'error' }[] = [];
    const disagreements: string[] = [];
    const unaskable: string[] = [];
    let asked = 0;
    for (const measure of CLAIM_LIBRARY) {
      for (const scenario of CLAIM_SCENARIOS) {
        const rows = new Map<string, RowChoice>();
        const run = runMeasure(measure.definition, scenario.filters, rows);
        // Pick the first row of each loop, in order, as the app does.
        for (const entry of run.timeline) {
          if (entry.kind !== 'iterate' || entry.nodeId === null) continue;
          const q = buildStepQuery(entry, run.options);
          if (q.kind !== 'rows') continue;
          try {
            const result = await client.evaluate('table', q.dax, 1);
            if (result.rows.length === 0) continue;
            const { indexes } = rowColumns(result.columns);
            rows.set(rowKey('root', entry.nodeId), { columns: indexes.map((i) => result.columns[i]), values: indexes.map((i) => result.rows[0][i] as FilterValue) });
          } catch {
            // No row to pick: the steps inside stay unasked.
          }
        }
        for (const claim of run.claims()) {
          const id = `${measure.id}|${scenario.id}|${claim.id}`;
          if (!claim.query) {
            unaskable.push(`${id}: needs a picked row`);
            continue;
          }
          asked++;
          let answer: boolean | string;
          try {
            const value = (await client.evaluate('scalar', claim.query)).rows[0]?.[0];
            // ISFILTERED is asked as 1/0 (see claims.ts); other answers are reported as they are.
            answer = typeof value === 'boolean' ? value : value === 1 ? true : value === 0 ? false : `the value ${JSON.stringify(value)}`;
          } catch (e) {
            answer = claim.expect === 'error' ? 'error' : `an error: ${(e as Error).message.slice(0, 200)}`;
          }
          if (answer === claim.expect) confirmed.push({ id, expect: claim.expect });
          else {
            disagreements.push(
              `- **${measure.id}** under *${scenario.id}*, step "${claim.step}": the app says ${claim.says}; Power BI says ${typeof answer === 'boolean' ? String(answer).toUpperCase() : answer}`,
            );
          }
        }
      }
    }
    const report = [
      '# Claim check',
      '',
      `${asked} claims asked: ${confirmed.length} confirmed, ${disagreements.length} disagreements, ${unaskable.length} not asked.`,
      '',
      '## Disagreements',
      ...(disagreements.length > 0 ? disagreements : ['None.']),
      '',
      '## Not asked',
      ...(unaskable.length > 0 ? unaskable.map((u) => `- ${u}`) : ['None.']),
      '',
    ].join('\n');
    console.log(report.split('\n').slice(0, 3).join('\n'));
    await expect(report).toMatchFileSnapshot('./claims.report.md');
    await expect(JSON.stringify(confirmed.sort((a, b) => a.id.localeCompare(b.id)), null, 1) + '\n').toMatchFileSnapshot('./claims.confirmed.json');
  }, 900_000);
});
