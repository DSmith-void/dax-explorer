import type { QueryValue } from '../app/helperClient';
import { valueText } from '../engine/context/reportFilters';
import type { RowChoice } from '../engine/context/stepQuery';

/** A value for people: numbers with separators (small numbers keep a few decimals), text as written. */
export function formatQueryValue(value: QueryValue): string {
  if (typeof value === 'number') {
    const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
    return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  }
  if (typeof value === 'string') return value === '' ? '(empty text)' : value;
  return valueText(value);
}

/** Engine column names for people: "Customer[Customer Key]" → "Customer Key". */
export const columnLabel = (name: string) => /\[((?:[^\]]|\]\])+)\]$/.exec(name)?.[1].replace(/\]\]/g, ']') ?? name;

/** "Customer Key = 1, Region = North": a picked row in a few words. */
export function rowText(choice: RowChoice): string {
  return choice.columns.map((c, i) => `${columnLabel(c)} = ${formatQueryValue(choice.values[i])}`).join(', ');
}
