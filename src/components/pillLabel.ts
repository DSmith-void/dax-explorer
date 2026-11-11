import { reportFilterText, valueText, type ReportFilter } from '../engine/context/reportFilters';

/** The pill's text: "No filters", the one filter, the visual's row, or how many filters. */
export function pillLabel(filters: readonly ReportFilter[]): string {
  if (filters.length === 0) return 'No filters';
  if (filters.every((f) => f.source)) {
    const row = filters.filter((f): f is Extract<ReportFilter, { kind: 'values' }> => f.source === 'visual-row' && f.kind === 'values');
    return row.length > 0 ? `From a visual: ${row.map((f) => (f.values.length === 1 ? valueText(f.values[0]).replace(/^"(.*)"$/, '$1') : '…')).join(' · ')}` : 'From a visual: measure on its own';
  }
  return filters.length === 1 ? reportFilterText(filters[0]) : `${filters.length} filters`;
}
