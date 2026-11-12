import type { EvalContext } from '../engine/context/model';
import { reportFilterColumns, reportFilterStatus, reportFilterText, type ReportFilter } from '../engine/context/reportFilters';
import { DIFF_MEANING, DIFF_SYMBOL, type DiffLine } from '../engine/context/stepParts';
import { findNode, type AstNode } from '../engine/parser/ast';
import { useReportFilters } from './reportFiltersContext';

/**
 * "What changes": one line per change (+ added, ⇄ replaces, − removed, ↻ row, ⇆ relationship, ? not
 * checked), each with a short note and a link to its code, then a key to the symbols used. Shared by the
 * Step tab and the Selected part tab.
 */
export function DiffList({ lines, context, root, onSelectNode }: { lines: readonly DiffLine[]; context: EvalContext; root: AstNode | null; onSelectNode: (node: AstNode) => void }) {
  const filters = useReportFilters();
  const kinds = [...new Set(lines.map((d) => d.kind))];
  return (
    <div className="step-diff">
      <p className="step-subheading">What changes</p>
      {lines.length === 0 ? (
        <p className="diff-none">· Nothing: the filters stay as they are.</p>
      ) : (
        <ul className="diff">
          {lines.map((line, i) => (
            <li key={i} className={`diff-${line.kind}`}>
              <span className="diff-symbol" title={DIFF_MEANING[line.kind]} aria-label={DIFF_MEANING[line.kind]}>
                {DIFF_SYMBOL[line.kind]}
              </span>
              <code>{line.text}</code>
              <span className="diff-note">
                {line.note}
                {replacedReportFilters(line, context, filters)}
                {line.nodeId !== null && findNode(root, line.nodeId) && (
                  <>
                    {' '}
                    <button type="button" className="link-button diff-link" onClick={() => onSelectNode(findNode(root, line.nodeId!)!)}>
                      show in code
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {kinds.length > 0 && (
        <p className="diff-key">
          {kinds.map((k) => (
            <span key={k}>
              <b>{DIFF_SYMBOL[k]}</b> {DIFF_MEANING[k].replace(/ \(.*\)$/, '').toLowerCase()}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** For a filter that replaces: the report filters on the same columns that it overrides here. */
function replacedReportFilters(line: DiffLine, context: EvalContext, filters: readonly ReportFilter[]): string {
  if (line.kind !== 'replace' || !line.target || line.target.kind === 'unknown') return '';
  const target = line.target;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const hit = filters.filter(
    (f) =>
      reportFilterStatus(f, context.filter.removals) === 'applies' &&
      reportFilterColumns(f).some((c) => (target.kind === 'table' ? same(c.table, target.table) : target.columns.some((t) => same(t.table, c.table) && same(t.column, c.column)))),
  );
  return hit.length === 0 ? '' : `; the report's filter ${hit.map(reportFilterText).join(', ')} no longer applies inside`;
}
