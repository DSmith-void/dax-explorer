/**
 * A step told as structure instead of prose: where it runs (the CALCULATEs and loops around it), what
 * changes (one diff line per change, in the order DAX makes them), and the notes that say why. Built from
 * the context analysis, so it says exactly what the analysis knows: every operation becomes one diff line.
 */
import type { BindResult } from '../binder/binder';
import { childrenOf, type AstNode, type Expr, type FunctionCall } from '../parser/ast';
import { entryText, relationshipChangeText, removalText } from './describe';
import type { ColumnName, ContextAnalysis, FilterTarget, Operation } from './model';
import type { TimelineEntry } from './timeline';

/**
 * add: added on top of the filters there (KEEPFILTERS). replace: replaces any filter on its columns.
 * remove: filters taken away. row: a current row becomes a filter (context transition). loop: going row by
 * row (a current row, no filter). relationship: which relationship is used, or which way it filters.
 * unknown: something the app can't check.
 */
export type DiffKind = 'add' | 'replace' | 'remove' | 'row' | 'loop' | 'relationship' | 'unknown';

export const DIFF_SYMBOL: Record<DiffKind, string> = {
  add: '+',
  replace: '⇄',
  remove: '−',
  row: '↻',
  loop: '↻',
  relationship: '⇆',
  unknown: '?',
};

/** Hover text for each symbol. */
export const DIFF_MEANING: Record<DiffKind, string> = {
  add: 'Added on top of the filters already there (KEEPFILTERS)',
  replace: 'Replaces any filter already on these columns',
  remove: 'Filters taken away',
  row: 'The current row becomes a filter (context transition)',
  loop: 'Going row by row: there is a current row, but nothing is filtered yet (row context)',
  relationship: 'Changes which relationship is used, or which way it filters',
  unknown: 'Not checked by the app',
};

export interface DiffLine {
  kind: DiffKind;
  /** The filter, columns or table, as code-like text. */
  text: string;
  /** A few words on what it does. */
  note: string;
  /** The code responsible (a filter argument), when there is one. */
  nodeId: number | null;
  /** For a filter that replaces: what it replaces (to name a report filter it overrides). */
  target?: FilterTarget;
}

/** A CALCULATE or a loop the step runs inside. */
export interface Crumb {
  kind: 'calculate' | 'loop';
  text: string;
  nodeId: number;
}

export interface StepParts {
  where: Crumb[];
  diff: DiffLine[];
  /** True when this step only prepares a filter that its CALCULATE applies later. */
  prepared: boolean;
}

const lineFor = (op: Operation, prepared: boolean): DiffLine[] => {
  const inside = prepared ? ' (when CALCULATE runs)' : '';
  switch (op.kind) {
    case 'add-filter':
      return [
        op.entry.mode === 'intersect'
          ? { kind: 'add', text: entryText(op.entry), note: `added on top of the filters there (KEEPFILTERS)${inside}`, nodeId: op.nodeId }
          : { kind: 'replace', text: entryText(op.entry), note: `replaces any filter on ${replacedText(op.entry.target)}${inside}`, nodeId: op.nodeId, target: op.entry.target },
      ];
    case 'remove-filters': {
      const including = op.removedEntries.length > 0 ? `, including ${op.removedEntries.map(entryText).join(', ')}` : '';
      return [
        {
          kind: 'remove',
          text: removalText(op.removal),
          note: op.because ? `removed by DAX itself, because ${op.because}${including}` : `${op.functionName} removes these filters${including}${inside}`,
          nodeId: op.because ? null : op.nodeId,
        },
      ];
    }
    case 'context-transition':
      return op.added.map((entry) => ({ kind: 'row' as const, text: entryText(entry), note: 'the current row becomes a filter (context transition)', nodeId: null }));
    case 'row-context':
      return [{ kind: 'loop', text: `each row of ${op.row.table.description}`, note: `${op.row.functionName} goes row by row: a current row, no filter yet (row context)`, nodeId: null }];
    case 'relationship':
      return [{ kind: 'relationship', text: relationshipChangeText(op.change), note: `${op.change.functionName}${inside}`, nodeId: op.nodeId }];
    case 'not-modeled':
      return [{ kind: 'unknown', text: op.description, note: 'not checked', nodeId: op.nodeId }];
  }
};

function replacedText(target: FilterTarget): string {
  if (target.kind === 'columns') return target.columns.map((c: ColumnName) => (c.table ? `${c.table}[${c.column}]` : `[${c.column}]`)).join(', ');
  if (target.kind === 'table') return `table ${target.table}`;
  return target.description;
}

export function stepParts(entry: TimelineEntry, root: Expr | null, binding: BindResult | null, analysis: ContextAnalysis | null, source: string): StepParts {
  const text = (node: AstNode) => source.slice(node.span.start, node.span.end).replace(/\s+/g, ' ');
  const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

  // What changes: this step's own operations; a filter argument shows the change it prepares.
  let operations = entry.operations;
  let prepared = false;
  if (entry.kind === 'filter-input' && entry.nodeId !== null && analysis) {
    for (const step of analysis.steps.values()) {
      const mine = step.operations.filter((op) => 'nodeId' in op && op.nodeId === entry.nodeId);
      if (mine.length > 0) {
        operations = mine;
        prepared = true;
        break;
      }
    }
  }
  const diff = operations.flatMap((op) => lineFor(op, prepared));
  // Effects the app can't check, new at this step.
  if (entry.innerContext) {
    for (const caveat of entry.innerContext.filter.caveats) {
      if (!entry.context.filter.caveats.includes(caveat)) diff.push({ kind: 'unknown', text: caveat, note: 'not checked', nodeId: null });
    }
  }

  // Where: the CALCULATEs (around the calculation inside them) and the loops (around their per-row part).
  const where: Crumb[] = [];
  if (root && entry.nodeId !== null) {
    for (const ancestor of ancestorsOf(root, entry.nodeId)) {
      if (ancestor.node.kind !== 'FunctionCall') continue;
      const call: FunctionCall = ancestor.node;
      const spec = binding?.calls.get(call.id);
      const childIndex = call.args.indexOf(ancestor.child as Expr);
      if (spec?.spec?.iteratesArgument !== undefined && spec.params) {
        if (spec.params[childIndex]?.role === 'rowExpression') where.push({ kind: 'loop', text: `${call.name.toUpperCase()} ↻ ${short(text(call.args[spec.spec.iteratesArgument] ?? call))}`, nodeId: call.id });
      } else if (analysis?.steps.get(call.id)?.innerContext && childIndex === 0) {
        where.push({ kind: 'calculate', text: call.name.toUpperCase(), nodeId: call.id });
      } else if (prepared && call.id === ownerOf(analysis, entry.nodeId)) {
        // A filter argument: it belongs to this CALCULATE, which applies it.
        where.push({ kind: 'calculate', text: call.name.toUpperCase(), nodeId: call.id });
      }
    }
  }
  return { where, diff, prepared };
}

/** The CALCULATE whose operations include this filter argument. */
function ownerOf(analysis: ContextAnalysis | null, nodeId: number): number | null {
  if (!analysis) return null;
  for (const step of analysis.steps.values()) {
    if (step.operations.some((op) => 'nodeId' in op && op.nodeId === nodeId)) return step.nodeId;
  }
  return null;
}

/** The nodes around `nodeId`, outermost first, each with the child that leads towards it. */
function ancestorsOf(root: Expr, nodeId: number): { node: AstNode; child: AstNode }[] {
  const path: AstNode[] = [];
  const walk = (node: AstNode): boolean => {
    path.push(node);
    if (node.id === nodeId) return true;
    for (const child of childrenOf(node)) if (walk(child.node)) return true;
    path.pop();
    return false;
  };
  if (!walk(root)) return [];
  return path.slice(0, -1).map((node, i) => ({ node, child: path[i + 1] }));
}
