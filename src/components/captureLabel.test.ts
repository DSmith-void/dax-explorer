import { describe, expect, it } from 'vitest';
import { captureLabel } from './captureLabel';

describe('captureLabel', () => {
  it('describes a visual in a few words', () => {
    expect(
      captureLabel(`DEFINE VAR __F = TREATAS({2024}, 'Date'[Year])
VAR __DS0Core = SUMMARIZECOLUMNS('Plant'[Plant Name], __F, "Total_Sales", 'Sales'[Total Sales])
EVALUATE __DS0Core`),
    ).toEqual({ ok: true, label: 'Groups by Plant Name · 1 filter · Total Sales' });
  });

  it('a card has no group-by', () => {
    expect(captureLabel(`EVALUATE SUMMARIZECOLUMNS("Total_Sales", 'Sales'[Total Sales])`)).toEqual({
      ok: true,
      label: 'A single value (like a card) · Total Sales',
    });
  });

  it("passes on the reader's reason when the query can't be used", () => {
    expect(captureLabel('EVALUATE VALUES(Product[Category])')).toEqual({ ok: false, error: expect.stringContaining('No SUMMARIZECOLUMNS') });
  });
});
