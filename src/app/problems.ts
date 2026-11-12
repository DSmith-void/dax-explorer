import type { BindResult } from '../engine/binder/binder';
import type { ContextAnalysis } from '../engine/context/model';
import { findNode } from '../engine/parser/ast';
import { createLineMap } from '../engine/source';
import type { AnalysisResult } from './analysis';

/**
 * error: the DAX can't be read as written. warning: it reads, but something is off. unchecked: something
 * the app can't work out (it says so instead of guessing). assumed: a name taken to be a measure or a
 * column by its form; set it in the Expression tree if that's wrong.
 */
export type ProblemKind = 'error' | 'warning' | 'unchecked' | 'assumed';

export const PROBLEM_LABEL: Record<ProblemKind, string> = {
  error: 'Error',
  warning: 'Warning',
  unchecked: 'Not checked',
  assumed: 'Assumed',
};

export interface Problem {
  kind: ProblemKind;
  /** One short sentence. */
  title: string;
  /** Where in the code (1-based line). */
  line: number;
  /** The node, when there is one (to show it in the code). */
  nodeId: number | null;
}

const ORDER: ProblemKind[] = ['error', 'warning', 'unchecked', 'assumed'];

/**
 * Everything that is wrong, or that the app couldn't be sure of, for one measure. Things that are fine
 * but worth knowing are hints, not problems (see the Hints tab).
 */
export function listProblems(result: AnalysisResult | null, binding: BindResult | null, analysis: ContextAnalysis | null): Problem[] {
  if (!result) return [];
  const root = result.parse?.root ?? null;
  const lineAt = createLineMap(result.text);
  const where = (nodeId: number) => {
    const node = findNode(root, nodeId);
    return { line: node ? lineAt(node.span.start).line : 1, text: node ? result.text.slice(node.span.start, node.span.end) : '' };
  };
  const problems: Problem[] = [];
  for (const d of [...result.diagnostics, ...(binding?.diagnostics ?? [])]) {
    problems.push({ kind: d.severity === 'error' ? 'error' : 'warning', title: d.message, line: lineAt(d.span.start).line, nodeId: null });
  }
  for (const insight of analysis?.insights ?? []) {
    const kind: ProblemKind | null =
      insight.kind === 'column-without-row-context' ? 'warning' : insight.kind === 'not-modeled' || insight.kind === 'unknown-function' ? 'unchecked' : null;
    if (kind) problems.push({ kind, title: insight.summary, line: where(insight.nodeId).line, nodeId: insight.nodeId });
  }
  // Names: one entry per name (a name used three times is listed once, where it first appears).
  const seen = new Set<string>();
  for (const r of binding?.references.values() ?? []) {
    if (seen.has(r.key)) continue;
    const { line, text } = where(r.nodeId);
    if (r.source === 'unresolved') {
      seen.add(r.key);
      problems.push({ kind: 'warning', title: `${text} could be a measure or a column; choose one in the Expression tree.`, line, nodeId: r.nodeId });
    } else if ((r.source === 'convention' || r.source === 'other-occurrence') && r.type) {
      seen.add(r.key);
      problems.push({ kind: 'assumed', title: `${text} is taken to be a ${r.type}, from how it is written.`, line, nodeId: r.nodeId });
    }
  }
  return problems.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.line - b.line);
}

/** The number on the tab: everything except names assumed from how they're written (those are usually right). */
export function problemCount(problems: readonly Problem[]): number {
  return problems.filter((p) => p.kind !== 'assumed').length;
}
