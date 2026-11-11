import { readVisualQuery } from '../engine/context/visualQuery';

/**
 * A captured visual query in a few words, e.g. "Groups by Plant Name · 2 filters · Total Sales",
 * or the reader's reason when the query can't be used.
 */
export function captureLabel(text: string): { ok: true; label: string } | { ok: false; error: string } {
  const result = readVisualQuery(text);
  if (!result.ok) return result;
  const { groupBy, filters, measures } = result.visual;
  const parts = [groupBy.length > 0 ? `Groups by ${groupBy.map((c) => c.column).join(', ')}` : 'A single value (like a card)'];
  if (filters.length > 0) parts.push(`${filters.length} ${filters.length === 1 ? 'filter' : 'filters'}`);
  if (measures.length > 0) parts.push(measures.map((m) => m.measureName ?? m.label).join(', '));
  return { ok: true, label: parts.join(' · ') };
}
