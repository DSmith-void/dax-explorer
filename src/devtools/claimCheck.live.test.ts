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
import { CLAIM_LIBRARY, CLAIM_SCENARIOS } from './claimLibrary';
import { askMeasure } from './claimAsk';

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
        const result = await askMeasure(client, measure.id, measure.definition, scenario);
        asked += result.asked;
        confirmed.push(...result.confirmed);
        disagreements.push(...result.disagreements);
        unaskable.push(...result.unaskable);
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
