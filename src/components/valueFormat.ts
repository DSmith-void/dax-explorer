import type { QueryValue } from '../app/helperClient';
import { valueText } from '../engine/context/reportFilters';
import type { RowChoice } from '../engine/context/stepQuery';
import { findNode, type AstNode } from '../engine/parser/ast';

/** Functions whose result is a part of a date (2026, 3, 15): shown as written, without a thousands separator. */
const DATE_PARTS = new Set(['YEAR', 'QUARTER', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'WEEKDAY', 'WEEKNUM']);

/**
 * True when the value at this node is a part of a date: YEAR(…) and the like, or a variable that holds one.
 * Its number then reads as a year or a month (2026), not as a quantity (2,026).
 */
export function isDatePart(root: AstNode | null, nodeId: number | null): boolean {
  if (!root || nodeId === null) return false;
  let node = findNode(root, nodeId);
  for (let depth = 0; depth < 4 && node; depth++) {
    if (node.kind === 'VarDeclaration') node = node.value;
    else if (node.kind === 'VariableRef') node = findNode(root, node.declarationId);
    else break;
  }
  return node?.kind === 'FunctionCall' && DATE_PARTS.has(node.name.toUpperCase());
}

/**
 * A value for people: numbers with separators (small numbers keep a few decimals), text as written.
 * `asWritten`: a whole number that is a part of a date (a year) is shown without a separator.
 */
export function formatQueryValue(value: QueryValue, asWritten = false): string {
  if (typeof value === 'number' && asWritten && Number.isInteger(value)) return String(value);
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
