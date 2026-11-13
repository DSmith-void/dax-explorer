/**
 * Symbolic evaluation context.
 *
 * We have no data and no model, so context is described symbolically:
 *  - The filters coming from the report are one unknown set, "F".
 *  - The expression can remove parts of F, and add its own filters.
 *  - Iterators add row contexts; context transition turns row contexts into filters.
 *
 * Anything the rules do not cover is recorded as "not modeled" rather than guessed.
 */

/** A column, as written. `table` is '' for an unqualified [Column]. */
export interface ColumnName {
  table: string;
  column: string;
}

/** What a filter applies to. */
export type FilterTarget =
  | { kind: 'columns'; columns: ColumnName[] }
  | { kind: 'table'; table: string }
  | { kind: 'unknown'; description: string };

export type FilterOrigin =
  | { kind: 'calculate'; nodeId: number; functionName: string }
  | { kind: 'context-transition'; nodeId: number; iteratorNodeId: number; iteratorName: string };

/** A filter added by the expression itself (as opposed to the incoming filters F). */
export interface FilterEntry {
  target: FilterTarget;
  /** Plain-language condition, e.g. `= "Red"` or `= current row of AVERAGEX`. */
  condition: string;
  origin: FilterOrigin;
  /** replace: overwrites existing filters on the same columns. intersect: KEEPFILTERS. */
  mode: 'replace' | 'intersect';
  /** For TREATAS: the tables its values come from (it filters as if through a relationship from them). */
  treatAsFrom?: string[];
  /**
   * For time-intelligence functions: the function, and the date column whose dates it works out. With a
   * calendar: the calendar's name, and its date column (null when the calendar has no Date unit).
   */
  dates?: { functionName: string; column: ColumnName | null; calendar?: string };
}

/** USERELATIONSHIP or CROSSFILTER inside CALCULATE: which relationship is used, or which way it filters. */
export interface RelationshipChange {
  kind: 'use' | 'crossfilter';
  /** The two columns named, in the order written. */
  columns: [ColumnName, ColumnName];
  /** CROSSFILTER only. */
  direction?: 'none' | 'oneway' | 'both' | 'left-filters-right' | 'right-filters-left';
  nodeId: number;
  functionName: string;
}

/** A part of the incoming filters F that has been removed. */
export type Removal =
  | { kind: 'all' }
  /**
   * ALLSELECTED: the visual's own row and column filters go (on these columns, this table, or all when
   * both are null); the filters from outside the visual (slicers, the filter pane) stay, or come back.
   */
  | { kind: 'visual'; columns: ColumnName[] | null; table: string | null }
  | { kind: 'column'; column: ColumnName }
  | { kind: 'table'; table: string; except: ColumnName[] };

export interface FilterContext {
  /** Parts of the incoming report filters F that no longer apply. Empty = all of F applies. */
  removals: Removal[];
  /** Filters added by the expression, in the order they were applied. */
  entries: FilterEntry[];
  /** Effects that apply here but are not modeled. */
  caveats: string[];
  /** Relationship changes in effect here (USERELATIONSHIP, CROSSFILTER), in the order applied. */
  relationships: RelationshipChange[];
}

/** The shape of a table being iterated, as far as it can be known without a model. */
export type TableShape =
  | { kind: 'columns'; columns: ColumnName[]; description: string }
  | { kind: 'table'; table: string; description: string }
  | { kind: 'unknown'; description: string };

export interface RowContext {
  /** The iterator call (SUMX, FILTER, ...) that created this row context. */
  nodeId: number;
  functionName: string;
  table: TableShape;
}

export interface EvalContext {
  filter: FilterContext;
  /** Active row contexts, outermost first. */
  rows: RowContext[];
  /** When set, the rules cannot say how this point is evaluated (e.g. inside an unknown function). */
  unknownReason: string | null;
}

export type Operation =
  | { kind: 'context-transition'; rows: RowContext[]; added: FilterEntry[] }
  | {
      kind: 'remove-filters';
      removal: Removal;
      nodeId: number;
      functionName: string;
      removedEntries: FilterEntry[];
      /** Set when DAX removes these filters by itself (not written in the code), with the reason. */
      because?: string;
    }
  | { kind: 'add-filter'; entry: FilterEntry; nodeId: number; replaced: FilterEntry[]; replacesIncoming: boolean }
  | { kind: 'row-context'; row: RowContext }
  | { kind: 'relationship'; change: RelationshipChange; nodeId: number }
  | { kind: 'not-modeled'; nodeId: number; description: string };

/** What happens at one node of the tree. */
export interface Step {
  nodeId: number;
  /** The context this node is evaluated in. */
  context: EvalContext;
  /** What this node does to the context its inner expression sees. */
  operations: Operation[];
  /** The context seen by the inner expression (CALCULATE's first argument, a measure's body). */
  innerContext?: EvalContext;
  /** One short sentence saying what happens at this node (for "Brief" explanations). */
  summary?: string;
  /** Plain-language facts about this node (the full explanation). */
  notes: string[];
  /** For a reference not yet classified: what happens in each case. */
  alternatives?: {
    ifMeasure: { operations: Operation[]; innerContext: EvalContext; notes: string[] };
    ifColumn: { notes: string[] };
  };
}

export type InsightKind =
  | 'context-transition'
  | 'variable-fixed'
  | 'column-without-row-context'
  | 'not-modeled'
  | 'unknown-function';

/** A noteworthy fact for the Diagnostics & Explanation panel. */
export interface Insight {
  kind: InsightKind;
  nodeId: number;
  /** One short sentence: the headline. */
  summary: string;
  /** The full explanation. */
  message: string;
}

export interface ContextAnalysis {
  steps: Map<number, Step>;
  insights: Insight[];
}

export const EMPTY_FILTER_CONTEXT: FilterContext = { removals: [], entries: [], caveats: [], relationships: [] };
export const INITIAL_CONTEXT: EvalContext = { filter: EMPTY_FILTER_CONTEXT, rows: [], unknownReason: null };
