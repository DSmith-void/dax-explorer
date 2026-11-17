import { describe, expect, it } from 'vitest';
import { busyText } from './desktopBusy';

describe('the busy notice', () => {
  it('says how many visuals, for how long, and what to do', () => {
    expect(busyText({ running: 2, longestMs: 253_636 })).toBe(
      'Power BI Desktop is still calculating 2 of the report’s own visuals (for 4 minutes), so values here wait for it. If Power BI Desktop responds, switching the report to an empty page stops them; if it doesn’t, they may take several minutes.',
    );
  });

  it('one visual, in seconds or one minute', () => {
    expect(busyText({ running: 1, longestMs: 7_400 })).toContain('one of the report’s own visuals (for 7 seconds)');
    expect(busyText({ running: 1, longestMs: 61_000 })).toContain('(for 1 minute)');
  });
});
