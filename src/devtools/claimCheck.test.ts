/**
 * Guards what Power BI Desktop confirmed (claims.confirmed.json, written by the live claim checker): every
 * confirmed claim must still be made, with the same answer. Runs without Power BI, in the normal tests.
 * After a deliberate change, run the live checker again to confirm the new claims (see claimCheck.live.test.ts).
 */
import { describe, expect, it } from 'vitest';
import confirmed from './claims.confirmed.json';
import { CLAIM_LIBRARY, CLAIM_SCENARIOS } from './claimLibrary';
import { runMeasure } from './claimRun';

describe('claims confirmed by Power BI Desktop', () => {
  it('are still made, with the same answer', () => {
    const now = new Map<string, boolean | 'error'>();
    for (const measure of CLAIM_LIBRARY) {
      for (const scenario of CLAIM_SCENARIOS) {
        for (const claim of runMeasure(measure.definition, scenario.filters).claims()) now.set(`${measure.id}|${scenario.id}|${claim.id}`, claim.expect);
      }
    }
    const changed = (confirmed as { id: string; expect: boolean | 'error' }[])
      .filter((c) => now.get(c.id) !== c.expect)
      .map((c) => `${c.id}: Power BI confirmed ${String(c.expect)}, the app now says ${now.has(c.id) ? String(now.get(c.id)) : 'nothing'}`);
    expect(changed).toEqual([]);
    expect(confirmed.length).toBeGreaterThan(700);
  });
});
