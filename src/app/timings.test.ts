import { describe, expect, it } from 'vitest';
import { summarizeTimings, timingRequest, type TimingResult, type TimingScan } from './timings';

const scan = (startMs: number, endMs: number, text = 'SELECT SUM(Amount) FROM Sales'): TimingScan => ({
  text,
  durationMs: endMs - startMs,
  cpuMs: endMs - startMs,
  startMs,
  endMs,
  fromCache: false,
});
const cached: TimingScan = { text: 'SELECT …', durationMs: null, cpuMs: null, startMs: null, endMs: null, fromCache: true };
const result = (totalMs: number, scans: TimingScan[]): TimingResult => ({ totalMs, totalCpuMs: null, scans, rows: 1, clearedCache: false });

describe('summarizeTimings', () => {
  it('counts scans running side by side once; calculating is the rest of the total', () => {
    const s = summarizeTimings(result(100, [scan(0, 30), scan(10, 40), scan(60, 70)]));
    expect(s.storageMs).toBe(50); // 0–40 and 60–70
    expect(s.formulaMs).toBe(50);
    expect(s.scans).toBe(3);
    expect(s.verdict).toContain('split between reading data (50 ms) and calculating (50 ms)');
  });

  it('says which part takes most of the time', () => {
    expect(summarizeTimings(result(100, [scan(0, 10)])).verdict).toMatch(/^Most of the time \(90 of 100 ms\) is spent calculating/);
    expect(summarizeTimings(result(100, [scan(0, 80), scan(80, 90)])).verdict).toMatch(/^Most of the time \(90 of 100 ms\) is spent reading data .* in 2 scans/);
  });

  it("doesn't read much into a very quick query", () => {
    expect(summarizeTimings(result(5, [scan(0, 1)])).verdict).toBe('Fast: 5 ms. Too quick for the split between reading and calculating to mean much.');
  });

  it('points out callbacks to the formula engine and scans from memory', () => {
    const s = summarizeTimings(result(50, [scan(0, 5, 'WITH $Expr0 := [CallbackDataID(SUM(Sales[Amount]]))] …'), cached]));
    expect(s.callbacks).toBe(1);
    expect(s.cacheHits).toBe(1);
    expect(s.scans).toBe(1);
    expect(s.notes[0]).toContain('calls back to the formula engine for each row');
    expect(s.notes[1]).toContain('came from memory');
  });

  it('without start and end times, adds up the durations; never more than the total', () => {
    const noTimes = (d: number): TimingScan => ({ ...scan(0, d), startMs: null, endMs: null });
    expect(summarizeTimings(result(100, [noTimes(20), noTimes(30)])).storageMs).toBe(50);
    expect(summarizeTimings(result(10, [noTimes(20), noTimes(30)])).storageMs).toBe(10);
  });
});

describe('timingRequest', () => {
  it("runs a step's query the way its value is fetched", () => {
    expect(timingRequest({ kind: 'scalar', dax: '[Total Sales]' })).toEqual({ kind: 'scalar', dax: '[Total Sales]' });
    expect(timingRequest({ kind: 'scalar', dax: 'FILTER(…)', visual: true })).toEqual({ kind: 'table', dax: 'FILTER(…)' });
    expect(timingRequest({ kind: 'table', dax: 'VALUES(Plant)', countDax: '' })).toEqual({ kind: 'table', dax: 'VALUES(Plant)' });
    expect(timingRequest({ kind: 'none', reason: '' })).toBeNull();
  });
});
