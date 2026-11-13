import type { BindResult } from '../binder/binder';
import type { ArgRole, FunctionSpec, ParamSpec } from '../catalog/functions';
import { childrenOf, type AstNode, type BracketRef, type ColumnRef, type Expr, type FunctionCall } from '../parser/ast';
import { createLineMap } from '../source';
import { columnText, entryText, filterSignature, relationshipChangeText, removalText } from './describe';
import type {
  ColumnName,
  ContextAnalysis,
  EvalContext,
  FilterContext,
  FilterEntry,
  FilterTarget,
  Insight,
  Operation,
  Removal,
  RelationshipChange,
  RowContext,
  Step,
  TableShape,
} from './model';
import { INITIAL_CONTEXT } from './model';
import { visualRemovalCovers } from './reportFilters';
import {
  calendarColumns,
  calendarDateColumn,
  crossfilterError,
  expandedCovers,
  findCalendar,
  findRelationship,
  wholeTableDateRule,
  type RelationshipModel,
} from './relationships';

/**
 * Symbolic context analysis.
 *
 * Walks the tree carrying an evaluation context (filters + row contexts) and records, for every
 * node, the context it is evaluated in and what it changes. Rules implemented:
 *
 *  - CALCULATE / CALCULATETABLE, in DAX's documented order:
 *      1. filter arguments are evaluated in the OUTER context
 *      2. context transition, if a row context is active
 *      3. modifiers: REMOVEFILTERS / ALL / ALLEXCEPT
 *      4. filters: overwrite existing filters on the same columns (KEEPFILTERS: intersect)
 *      5. the first argument is evaluated in the result
 *  - Iterators (SUMX, FILTER, TOPN, ...): "per row" arguments get a new row context.
 *  - Measure references behave like CALCULATE([Measure]): context transition inside a row context.
 *  - Variables are evaluated once, where they are defined.
 *
 * Everything else that would change context (relationships, ALLSELECTED, unknown functions...)
 * is recorded as "not modeled" or "unknown", never guessed.
 */
/** TOTALYTD and friends: CALCULATE with the matching DATES…TD function. */
const TOTALS = new Map([
  ['TOTALYTD', 'DATESYTD'],
  ['TOTALQTD', 'DATESQTD'],
  ['TOTALMTD', 'DATESMTD'],
  ['TOTALWTD', 'DATESWTD'],
]);

/**
 * @param initial the context the expression starts in: the report's filters F by default, or, for a measure
 *   called by another measure, the filters that caller passes in.
 */
export function analyzeContext(
  root: Expr | null,
  binding: BindResult,
  source: string,
  initial: EvalContext = INITIAL_CONTEXT,
  /** The relationships between tables, when known: a whole-table removal then covers its expanded table for certain. */
  model: RelationshipModel | null = null,
): ContextAnalysis {
  const steps = new Map<number, Step>();
  const insights: Insight[] = [];
  const variables = new Map<number, { name: string; line: number; context: EvalContext; shape: TableShape | null }>();
  const lineOf = createLineMap(source);
  /**
   * Boolean CALCULATE filters such as Product[Color] = "Red" are shorthand for
   * FILTER(ALL(Product[Color]), Product[Color] = "Red"): the predicate runs in an
   * implicit row context over the column. Keyed by the predicate's node id.
   */
  const implicitRows = new Map<number, RowContext>();

  if (!root) return { steps, insights };

  // ---------------------------------------------------------------- helpers

  const snippet = (node: AstNode, max = 60): string => {
    // Collapse whitespace, including the spaces left after "(" and before ")" by multi-line formatting.
    const text = source
      .slice(node.span.start, node.span.end)
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  const record = (step: Step) => steps.set(step.nodeId, step);

  const specOf = (node: FunctionCall): FunctionSpec | undefined => binding.calls.get(node.id)?.spec;

  /** The column a reference names, if it is (or is resolved as) a column. */
  function columnOf(node: AstNode): ColumnName | null {
    if (node.kind === 'ColumnRef') return { table: node.table, column: node.column };
    if (node.kind === 'BracketRef' && binding.references.get(node.id)?.type === 'column') return { table: '', column: node.name };
    return null;
  }

  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const sameColumn = (a: ColumnName, b: ColumnName) => same(a.table, b.table) && same(a.column, b.column);
  const inTable = (column: ColumnName, table: string) => column.table !== '' && same(column.table, table);

  // ------------------------------------------------- filter context algebra

  /** Is this added filter covered by a removal? */
  function removalCovers(removal: Removal, target: FilterTarget): boolean {
    if (removal.kind === 'all') return true;
    if (target.kind === 'unknown') return false;
    if (removal.kind === 'visual') {
      // Filters the measure itself added on these columns go too: ALLSELECTED puts back the outer selection.
      if (target.kind === 'table') return removal.columns === null && (removal.table === null || same(removal.table, target.table));
      return target.columns.some((c) => visualRemovalCovers(removal, c));
    }
    if (removal.kind === 'column') {
      return target.kind === 'columns' && target.columns.some((c) => sameColumn(c, removal.column));
    }
    // table removal: with the relationships known, it covers the whole expanded table
    const covers = (table: string) => same(table, removal.table) || (model !== null && table !== '' && expandedCovers(model, removal.table, table));
    if (target.kind === 'table') return covers(target.table);
    return target.columns.some((c) => covers(c.table) && !removal.except.some((e) => sameColumn(e, c)));
  }

  function removalAlreadyImplied(existing: readonly Removal[], removal: Removal): boolean {
    if (removal.kind === 'visual') return false; // never already implied: it can bring filters back
    return existing.some((r) => {
      if (r.kind === 'visual') return false;
      if (r.kind === 'all') return true;
      if (removal.kind === 'all') return false;
      if (r.kind === 'table' && r.except.length === 0) {
        return removal.kind === 'table' ? same(r.table, removal.table) : inTable(removal.column, r.table);
      }
      if (r.kind === 'column' && removal.kind === 'column') return sameColumn(r.column, removal.column);
      return false;
    });
  }

  function removeFilters(fc: FilterContext, removal: Removal): { fc: FilterContext; removedEntries: FilterEntry[] } {
    const removedEntries = fc.entries.filter((e) => removalCovers(removal, e.target));
    const removals =
      removal.kind === 'all'
        ? [removal]
        : removal.kind === 'visual'
          ? // ALLSELECTED resets its columns to the outer selection: earlier removals on them no longer matter.
            [...fc.removals.filter((r) => !(r.kind === 'column' && visualRemovalCovers(removal, r.column))), removal]
          : removalAlreadyImplied(fc.removals, removal)
            ? fc.removals
            : [...fc.removals, removal];
    const caveats = [...fc.caveats];
    if (removal.kind === 'table' && !model) {
      caveats.push(
        `removing filters from the whole ${removal.table} table can also remove filters on tables related to it; that depends on the data model, which this app can't see`,
      );
    }
    return { fc: { ...fc, removals, entries: fc.entries.filter((e) => !removedEntries.includes(e)), caveats }, removedEntries };
  }

  function addFilter(fc: FilterContext, entry: FilterEntry): { fc: FilterContext; replaced: FilterEntry[]; replacesIncoming: boolean } {
    if (entry.mode === 'intersect') {
      return { fc: { ...fc, entries: [...fc.entries, entry] }, replaced: [], replacesIncoming: false };
    }
    const target = entry.target;
    if (target.kind === 'unknown') {
      return {
        fc: {
          ...fc,
          entries: [...fc.entries, entry],
          caveats: [...fc.caveats, `the app can't tell which existing filters "${target.description}" replaces`],
        },
        replaced: [],
        replacesIncoming: false,
      };
    }
    // Overwrite: the incoming filters F on these columns no longer apply, and earlier added filters on them are replaced.
    let removals = fc.removals;
    const newRemovals: Removal[] =
      target.kind === 'table' ? [{ kind: 'table', table: target.table, except: [] }] : target.columns.map((column) => ({ kind: 'column', column }));
    let replacesIncoming = false;
    for (const removal of newRemovals) {
      if (!removalAlreadyImplied(removals, removal)) {
        removals = [...removals, removal];
        replacesIncoming = true;
      }
    }
    const replaced = fc.entries.filter((e) => newRemovals.some((r) => removalCovers(r, e.target)));
    const caveats = [...fc.caveats];
    if (target.kind === 'table' && !model) {
      caveats.push(
        `filtering the whole ${target.table} table can also filter tables related to it; that depends on the data model, which this app can't see`,
      );
    }
    return { fc: { ...fc, removals, entries: [...fc.entries.filter((e) => !replaced.includes(e)), entry], caveats }, replaced, replacesIncoming };
  }

  function targetOfShape(shape: TableShape): FilterTarget {
    if (shape.kind === 'columns') return { kind: 'columns', columns: shape.columns };
    if (shape.kind === 'table') return { kind: 'table', table: shape.table };
    return { kind: 'unknown', description: `the columns of ${shape.description}` };
  }

  /** Context transition: every active row context becomes a filter. */
  function contextTransition(ctx: EvalContext, atNodeId: number): { fc: FilterContext; added: FilterEntry[] } {
    let fc = ctx.filter;
    const added: FilterEntry[] = [];
    for (const row of ctx.rows) {
      const target = targetOfShape(row.table);
      const entry: FilterEntry = {
        target,
        condition: target.kind === 'columns' ? `= the current row of ${row.functionName}` : `limited to the current row of ${row.functionName}`,
        origin: { kind: 'context-transition', nodeId: atNodeId, iteratorNodeId: row.nodeId, iteratorName: row.functionName },
        mode: 'replace',
      };
      fc = addFilter(fc, entry).fc;
      added.push(entry);
    }
    return { fc, added };
  }

  // ------------------------------------------------------------ table shapes

  function shapeOf(expr: Expr): TableShape {
    const description = snippet(expr);
    switch (expr.kind) {
      case 'TableRef':
        return { kind: 'table', table: expr.name, description };
      case 'VariableRef': {
        const info = variables.get(expr.declarationId);
        if (info?.shape) return { ...info.shape, description: info.name } as TableShape;
        return { kind: 'unknown', description: `VAR ${expr.name}` };
      }
      case 'FunctionCall': {
        const name = specOf(expr)?.name;
        const args = expr.args;
        switch (name) {
          case 'VALUES':
          case 'DISTINCT':
          case 'ALL':
          case 'ALLSELECTED': {
            const columns = args.map(columnOf);
            if (args.length > 0 && columns.every((c): c is ColumnName => c !== null)) {
              return { kind: 'columns', columns, description };
            }
            if (args.length === 1 && args[0].kind === 'TableRef') return { kind: 'table', table: args[0].name, description };
            return { kind: 'unknown', description };
          }
          case 'DATESYTD':
          case 'DATESQTD':
          case 'DATESMTD':
          case 'DATESWTD':
          case 'PREVIOUSWEEK':
          case 'NEXTWEEK':
          case 'SAMEPERIODLASTYEAR':
          case 'DATEADD':
          case 'PARALLELPERIOD':
          case 'DATESBETWEEN':
          case 'DATESINPERIOD':
          case 'PREVIOUSDAY':
          case 'PREVIOUSMONTH':
          case 'PREVIOUSQUARTER':
          case 'PREVIOUSYEAR':
          case 'NEXTDAY':
          case 'NEXTMONTH':
          case 'NEXTQUARTER':
          case 'NEXTYEAR':
          case 'FIRSTDATE':
          case 'LASTDATE': {
            // A table of dates from its date column; with a calendar, of the calendar's primary columns.
            const calendar = args[0]?.kind === 'TableRef' ? findCalendar(model, args[0].name) : undefined;
            if (calendar) {
              const { result } = calendarColumns(calendar, name);
              return result.length > 0 ? { kind: 'columns', columns: result, description } : { kind: 'unknown', description };
            }
            const column = args[0] ? columnOf(args[0]) : null;
            return column ? { kind: 'columns', columns: [column], description } : { kind: 'unknown', description };
          }
          case 'TREATAS': {
            // Its result has the lineage of the columns it names.
            const columns = args.slice(1).map(columnOf);
            if (columns.length > 0 && columns.every((c): c is ColumnName => c !== null)) return { kind: 'columns', columns, description };
            return { kind: 'unknown', description };
          }
          // Wrappers keep the shape of the table they wrap; described structurally ("TOPN over FILTER over ...").
          case 'ALLEXCEPT':
          case 'FILTER':
          case 'CALCULATETABLE':
          case 'ADDCOLUMNS':
          case 'RELATEDTABLE':
          case 'TOPN': {
            const inner = name === 'TOPN' ? args[1] : args[0];
            if (!inner) return { kind: 'unknown', description };
            const innerShape = shapeOf(inner);
            return { ...innerShape, description: `${name} over ${innerShape.description}` } as TableShape;
          }
          default:
            return { kind: 'unknown', description };
        }
      }
      default:
        return { kind: 'unknown', description };
    }
  }

  function isTableExpression(expr: Expr): boolean {
    if (expr.kind === 'TableRef' || expr.kind === 'TableConstructor') return true;
    if (expr.kind === 'FunctionCall') return specOf(expr)?.returns === 'table';
    if (expr.kind === 'VariableRef') return variables.get(expr.declarationId)?.shape != null;
    return false;
  }

  // -------------------------------------------------------------- the walk

  function visitChildren(node: AstNode, ctx: EvalContext) {
    for (const child of childrenOf(node)) visit(child.node, ctx, null);
  }

  function visit(node: AstNode, outerCtx: EvalContext, role: ArgRole | null): void {
    const implicit = implicitRows.get(node.id);
    const ctx: EvalContext = implicit ? { ...outerCtx, rows: [...outerCtx.rows, implicit] } : outerCtx;
    if (ctx.unknownReason) {
      record({ nodeId: node.id, context: ctx, operations: [], notes: [] });
      visitChildren(node, ctx);
      return;
    }
    switch (node.kind) {
      case 'FunctionCall':
        visitCall(node, ctx, role);
        return;
      case 'BracketRef':
      case 'ColumnRef':
        visitReference(node, ctx, role);
        return;
      case 'VarBlock': {
        for (const declaration of node.declarations) {
          visit(declaration.value, ctx, null);
          variables.set(declaration.id, {
            name: declaration.name,
            line: lineOf(declaration.span.start).line,
            context: ctx,
            shape: isTableExpression(declaration.value) ? shapeOf(declaration.value) : null,
          });
          record({
            nodeId: declaration.id,
            context: ctx,
            operations: [],
            summary: `${declaration.name} is calculated once, here.`,
            notes: [`With the filters shown above. Every later use of ${declaration.name} reuses this value.`],
          });
        }
        visit(node.body, ctx, null);
        record({ nodeId: node.id, context: ctx, operations: [], notes: [] });
        return;
      }
      case 'VariableRef':
        visitVariableRef(node.id, node.name, node.declarationId, ctx);
        return;
      default:
        record({ nodeId: node.id, context: ctx, operations: [], notes: [] });
        visitChildren(node, ctx);
    }
  }

  function visitVariableRef(nodeId: number, name: string, declarationId: number, ctx: EvalContext) {
    const info = variables.get(declarationId);
    const where = info ? ` (line ${info.line})` : '';
    const notes = [`${name} was calculated once${where}; that value is used here.`];
    let summary = info ? `${name} from line ${info.line}; not recalculated.` : `${name}: not recalculated here.`;
    if (info) {
      const filtersDiffer = filterSignature(info.context) !== filterSignature(ctx);
      const newRows = ctx.rows.filter((row) => !info.context.rows.includes(row));
      if (filtersDiffer) {
        summary = `${name} keeps its earlier value here, even though the filters are different.`;
        const message = `The filters here are different from where ${name} was calculated${where}, but ${name} is not recalculated: it keeps the value it got there. This is a common surprise when a variable is used inside CALCULATE.`;
        notes.push(message);
        insights.push({ kind: 'variable-fixed', nodeId, summary, message });
      } else if (newRows.length > 0) {
        const functions = newRows.map((r) => r.functionName).join(' and ');
        summary = `${name} has the same value for every row of ${functions}.`;
        const message = `${name} was calculated once${where}, before ${functions} started going row by row, so it has the same value for every row.`;
        notes.push(message);
        insights.push({ kind: 'variable-fixed', nodeId, summary, message });
      }
    }
    record({ nodeId, context: ctx, operations: [], summary, notes });
  }

  // ---------------------------------------------------------- function calls

  function visitCall(node: FunctionCall, ctx: EvalContext, role: ArgRole | null) {
    const call = binding.calls.get(node.id);
    const spec = call?.spec;
    if (!spec || !call?.params) {
      const reason = !spec
        ? `this is inside ${node.name}, which the app doesn't know yet`
        : `this is inside ${spec.name}, which has an unexpected number of inputs`;
      const message = !spec
        ? `${node.name} isn't in this app's list of known functions yet, so the app can't tell how the parts inside it are calculated.`
        : `${spec.name} has an unexpected number of inputs, so the app can't tell how the parts inside it are calculated.`;
      const summary = `The app doesn't know ${node.name} yet, so the parts inside it aren't checked.`;
      insights.push({ kind: 'unknown-function', nodeId: node.id, summary, message });
      record({ nodeId: node.id, context: ctx, operations: [], summary, notes: [message] });
      const unknown: EvalContext = { ...ctx, unknownReason: reason };
      for (const arg of node.args) visit(arg, unknown, null);
      return;
    }
    if (spec.name === 'CALCULATE' || spec.name === 'CALCULATETABLE' || spec.name === 'RELATEDTABLE' || TOTALS.has(spec.name)) {
      visitCalculate(node, ctx, spec);
      return;
    }
    if (spec.iteratesArgument !== undefined) {
      visitIterator(node, ctx, spec, call.params);
      return;
    }
    const notes = genericNotes(node, spec, role);
    record({ nodeId: node.id, context: ctx, operations: [], summary: notes[0], notes });
    node.args.forEach((arg, i) => visit(arg, ctx, call.params![i].role));
  }

  function genericNotes(node: FunctionCall, spec: FunctionSpec, role: ArgRole | null): string[] {
    const first = node.args[0];
    switch (spec.name) {
      case 'VALUES':
      case 'DISTINCT':
        return [`Lists the values of ${first ? snippet(first) : '…'} that are still visible after the filters shown above.`];
      case 'ALL':
        return role === 'filter'
          ? []
          : ['Used as a table here: gives all values, ignoring filters. (It does not change the filters for anything else.)'];
      case 'REMOVEFILTERS':
      case 'KEEPFILTERS':
      case 'USERELATIONSHIP':
      case 'CROSSFILTER':
        return role === 'filter' ? [] : [`${spec.name} only does something when it is used inside CALCULATE or CALCULATETABLE.`];
      default:
        break;
    }
    if (spec.category === 'aggregation' && first) {
      return [`Uses the values of ${snippet(first)} from all rows that pass the filters shown above.`];
    }
    if (spec.category === 'scope and filter inspection') {
      return [`Checks the filters shown above. ${spec.summary}`];
    }
    return [];
  }

  function visitIterator(node: FunctionCall, ctx: EvalContext, spec: FunctionSpec, params: ParamSpec[]) {
    const tableArg = node.args[spec.iteratesArgument!];
    // Everything except the per-row expressions is evaluated once, in the outer context.
    node.args.forEach((arg, i) => {
      if (params[i].role !== 'rowExpression') visit(arg, ctx, params[i].role);
    });
    const row: RowContext = {
      nodeId: node.id,
      functionName: spec.name,
      table: tableArg ? shapeOf(tableArg) : { kind: 'unknown', description: '(missing table)' },
    };
    const rowCtx: EvalContext = { ...ctx, rows: [...ctx.rows, row] };
    node.args.forEach((arg, i) => {
      if (params[i].role === 'rowExpression') visit(arg, rowCtx, 'rowExpression');
    });
    record({
      nodeId: node.id,
      context: ctx,
      operations: [{ kind: 'row-context', row }],
      innerContext: rowCtx,
      summary: `${spec.name} goes through ${row.table.description} one row at a time.`,
      notes: [
        `Row by row (row context): the inputs marked "per row" are calculated for each row. This doesn't filter anything by itself.`,
      ],
    });
  }

  // --------------------------------------------------------------- CALCULATE

  type FilterArgument =
    | { kind: 'remove'; removals: Removal[]; functionName: string }
    | { kind: 'relationship'; change: RelationshipChange }
    | { kind: 'filter'; entry: FilterEntry }
    | { kind: 'not-modeled'; description: string }
    | { kind: 'none' };

  function visitCalculate(node: FunctionCall, ctx: EvalContext, spec: FunctionSpec) {
    const isRelatedTable = spec.name === 'RELATEDTABLE';
    // TOTALYTD(expression, dates, [filter], [year end]) is CALCULATE(expression, DATESYTD(dates[, year end]), filter).
    const total = TOTALS.get(spec.name);
    const [first, ...written] = node.args;
    const filterArgs = total ? totalFilterArgs(node) : written;
    const yearEnd = total ? written.slice(1).find((a) => a.kind === 'StringLiteral') : undefined;
    const operations: Operation[] = [];

    // Classify first (this registers implicit row contexts for boolean filters), then:
    // 1. Filter arguments are evaluated in the outer context.
    const classified = isRelatedTable
      ? []
      : filterArgs.map((arg, i) => ({
          arg,
          c:
            total && i === 0
              ? timeFilter(total, yearEnd ? [arg, yearEnd] : [arg], node, spec.name, 'replace')
              : classifyFilter(arg, node, spec.name, 'replace'),
        }));
    // (TOTALYTD's dates argument is just the date column.)
    if (!isRelatedTable) filterArgs.forEach((arg, i) => visit(arg, ctx, total && i === 0 ? 'column' : 'filter'));

    // 2. Context transition.
    let fc = ctx.filter;
    if (ctx.rows.length > 0) {
      const transition = contextTransition(ctx, node.id);
      fc = transition.fc;
      operations.push({ kind: 'context-transition', rows: ctx.rows, added: transition.added });
      insights.push({
        kind: 'context-transition',
        nodeId: node.id,
        summary: `This ${spec.name} works on one row of ${ctx.rows[ctx.rows.length - 1].functionName} at a time.`,
        message: `This ${spec.name} is inside ${ctx.rows.map((r) => r.functionName).join(' and ')}, which is going row by row. So each time it runs, the current row becomes a filter (context transition) and only data for that row is included.`,
      });
    }

    // 3. Modifiers. Putting a filter on the date column of a date table also removes every other filter on
    //    that table: DAX adds this by itself, as a modifier. Not for calendar functions: they keep filters on
    //    the table's columns the calendars don't tag (checked in Power BI Desktop).
    for (const { arg, c } of classified) {
      if (c.kind !== 'filter' || c.entry.target.kind !== 'columns' || c.entry.dates?.calendar) continue;
      for (const column of c.entry.target.columns) {
        const because = model ? wholeTableDateRule(model, column) : null;
        if (!because) continue;
        const removal: Removal = { kind: 'table', table: column.table, except: [] };
        const result = removeFilters(fc, removal);
        fc = result.fc;
        operations.push({ kind: 'remove-filters', removal, nodeId: arg.id, functionName: spec.name, removedEntries: result.removedEntries, because });
      }
    }
    for (const { arg, c } of classified) {
      if (c.kind !== 'remove') continue;
      for (const removal of c.removals) {
        const result = removeFilters(fc, removal);
        fc = result.fc;
        if (removal.kind === 'visual' && ctx.rows.length > 0) {
          fc = {
            ...fc,
            caveats: [...fc.caveats, `ALLSELECTED inside a row-by-row calculation (${ctx.rows.map((r) => r.functionName).join(', ')}) also brings back the rows being gone through; that part isn't checked`],
          };
        }
        operations.push({ kind: 'remove-filters', removal, nodeId: arg.id, functionName: c.functionName, removedEntries: result.removedEntries });
      }
      const step = steps.get(arg.id);
      if (step) {
        step.summary = `Removes any filter on ${c.removals.map(removalText).join('; ')} (only inside this ${spec.name}).`;
        // The step's "what changes" says it; no note repeats it.
        step.notes = [];
      }
    }
    for (const { arg, c } of classified) {
      if (c.kind !== 'relationship') continue;
      fc = { ...fc, relationships: [...fc.relationships, c.change] };
      operations.push({ kind: 'relationship', change: c.change, nodeId: arg.id });
      const text = relationshipChangeText(c.change);
      const step = steps.get(arg.id);
      if (step) {
        const detail = relationshipChangeDetail(c.change);
        // When the model says DAX rejects it, the one-line summary says so too.
        step.summary = detail.includes('shows an error') ? `${text}: ${detail.replace(/^But /, '').replace(/^[A-Z](?=[a-z])/, (x) => x.toLowerCase())}` : `${text} (only inside this ${spec.name}).`;
        step.notes = detail ? [detail] : [];
      }
    }
    for (const { arg, c } of classified) {
      if (c.kind !== 'not-modeled') continue;
      fc = { ...fc, caveats: [...fc.caveats, c.description] };
      operations.push({ kind: 'not-modeled', nodeId: arg.id, description: c.description });
      const summary = `The app can't check ${snippet(arg, 40)} yet.`;
      const message = c.description.charAt(0).toUpperCase() + c.description.slice(1) + '.';
      insights.push({ kind: 'not-modeled', nodeId: arg.id, summary, message });
      const step = steps.get(arg.id);
      if (step) {
        step.summary = summary;
        step.notes = [message];
      }
    }

    // 4. Filters.
    for (const { arg, c } of classified) {
      if (c.kind !== 'filter') continue;
      const result = addFilter(fc, c.entry);
      fc = result.fc;
      operations.push({ kind: 'add-filter', entry: c.entry, nodeId: arg.id, replaced: result.replaced, replacesIncoming: result.replacesIncoming });
      const step = steps.get(arg.id);
      if (step) {
        step.summary =
          c.entry.mode === 'intersect'
            ? `Adds ${entryText(c.entry)} on top of the existing filters (only inside this ${spec.name}).`
            : `Sets ${entryText(c.entry)} (only inside this ${spec.name}).`;
        step.notes = [
          ...(c.entry.mode === 'intersect' ? ['Only rows that pass both this filter and the ones already there are included.'] : []),
          `Its condition is checked using the filters from before the ${spec.name} (shown above).`,
        ];
      }
    }

    // 5. The first argument sees the new context.
    const inner: EvalContext = { filter: fc, rows: ctx.rows, unknownReason: null };
    if (first) visit(first, inner, spec.returns === 'table' ? 'table' : 'scalar');

    record({
      nodeId: node.id,
      context: ctx,
      operations,
      innerContext: inner,
      summary: calculateSummary(spec.name, first, operations),
      // The step-by-step explanation of CALCULATE is generated by the UI from `operations`.
      notes: isRelatedTable
        ? ['RELATEDTABLE is CALCULATETABLE with no filters: in a row context, context transition selects the related rows.']
        : total
          ? [
              `${spec.name} is a short way of writing CALCULATE(${first ? snippet(first, 40) : 'expression'}, ${total}(${filterArgs[0] ? snippet(filterArgs[0], 30) : 'dates'})${filterArgs[1] ? `, ${snippet(filterArgs[1], 30)}` : ''}).`,
            ]
          : [],
    });
  }

  /** One sentence: what this CALCULATE calculates, and with which changes. */
  function calculateSummary(name: string, first: Expr | undefined, operations: Operation[]): string {
    const what = first ? snippet(first, 40) : 'its first input';
    const parts: string[] = [];
    const transition = operations.find((op) => op.kind === 'context-transition');
    if (transition?.kind === 'context-transition') {
      parts.push(`for the current row of ${transition.rows[transition.rows.length - 1].functionName}`);
    }
    const removed = operations.flatMap((op) => (op.kind === 'remove-filters' && !op.because ? [removalText(op.removal)] : []));
    if (removed.length > 0) parts.push(`without filters on ${removed.join(' and ')}`);
    const cleared = operations.flatMap((op) => (op.kind === 'remove-filters' && op.because ? [removalText(op.removal).replace(/^table /, '')] : []));
    if (cleared.length > 0) parts.push(`with the other filters on ${cleared.join(' and ')} cleared (DAX does this by itself)`);
    const added = operations.flatMap((op) => (op.kind === 'add-filter' ? [entryText(op.entry)] : []));
    if (added.length > 0) parts.push(`with ${added.join(' and ')}`);
    const changes = operations.flatMap((op) => (op.kind === 'relationship' ? [relationshipChangeText(op.change, true)] : []));
    if (changes.length > 0) parts.push(changes.join(' and '));
    if (operations.some((op) => op.kind === 'not-modeled')) parts.push('with some changes the app can\'t check');
    if (parts.length === 0) return `${name} calculates ${what} with the same filters (nothing changes).`;
    return `${name} calculates ${what} ${parts.join(', ')}.`;
  }

  /** What the model says about a relationship change (only with the relationships known). */
  function relationshipChangeDetail(change: RelationshipChange): string {
    if (!model) return 'Which relationship that is depends on the data model; connect to a report to check it.';
    const [a, b] = change.columns;
    const r = findRelationship(model, a, b);
    if (!r) return `But this model has no relationship between ${columnText(a)} and ${columnText(b)}, so DAX shows an error here.`;
    if (change.kind === 'use') {
      const other = model.relationships.find(
        (x) => x !== r && x.active && ((same(x.fromTable, r.fromTable) && same(x.toTable, r.toTable)) || (same(x.fromTable, r.toTable) && same(x.toTable, r.fromTable))),
      );
      const was = r.active ? 'It is already the active relationship, so nothing changes.' : 'It is normally inactive.';
      return other ? `${was} The usual one, ${other.fromTable}[${other.fromColumn}] – ${other.toTable}[${other.toColumn}], is switched off meanwhile.` : was;
    }
    const error = crossfilterError(r, change);
    if (error) return `But ${error}.`;
    return r.bothDirections ? 'Normally it filters both ways.' : 'Normally it filters one way, from the one side to the many side.';
  }

  /** TOTALYTD(expression, dates, [filter], [year end]): its filter arguments are the dates and the optional filter. */
  function totalFilterArgs(node: FunctionCall): Expr[] {
    return node.args.slice(1, 3).filter((a, i) => !(i === 1 && a.kind === 'StringLiteral'));
  }

  /**
   * A time-intelligence function as a CALCULATE filter: a filter on its date column, replaced by the dates
   * it works out (described as a rule; the actual dates depend on the filters in effect).
   */
  function timeFilter(name: string, args: readonly Expr[], calculate: FunctionCall, calculateName: string, mode: FilterEntry['mode']): FilterArgument {
    const origin = { kind: 'calculate' as const, nodeId: calculate.id, functionName: calculateName };
    const first = args[0];
    if (first?.kind === 'TableRef') {
      // Calendar-based time intelligence: SAMEPERIODLASTYEAR('Fiscal Calendar').
      const calendar = findCalendar(model, first.name);
      if (!calendar) {
        const written = first.quoted ? `'${first.name}'` : first.name;
        return {
          kind: 'not-modeled',
          description: model?.source === 'report'
            ? `the connected model has no calendar named ${written}, so the app can't tell which dates ${name} uses`
            : `the app can't tell which dates ${name} uses: ${written} may be a calendar (calendar-based time intelligence); connect to the report to read it`,
        };
      }
      const { cleared } = calendarColumns(calendar, name);
      if (cleared.length === 0) {
        return { kind: 'not-modeled', description: `the calendar '${calendar.name}' has no columns the app could read` };
      }
      return {
        kind: 'filter',
        entry: {
          target: { kind: 'columns', columns: cleared },
          condition: `= ${dateRuleText(name, args)}, by the calendar '${calendar.name}'`,
          origin,
          mode,
          dates: { functionName: name, column: calendarDateColumn(calendar), calendar: calendar.name },
        },
      };
    }
    const column = first ? columnOf(first) : null;
    if (!column || column.table === '') {
      return { kind: 'not-modeled', description: `the app can't tell which date column ${name} uses (it needs a Table[Column] reference, or a calendar)` };
    }
    return {
      kind: 'filter',
      entry: {
        target: { kind: 'columns', columns: [column] },
        condition: `= ${dateRuleText(name, args)}`,
        origin,
        mode,
        dates: { functionName: name, column },
      },
    };
  }

  /** The dates a time-intelligence function works out, in plain words. */
  function dateRuleText(name: string, args: readonly Expr[]): string {
    const arg = (i: number) => (args[i] ? snippet(args[i], 30) : '?');
    const count = (i: number): { n: number | null; text: string } => {
      const a = args[i];
      if (a?.kind === 'NumberLiteral') return { n: Number(a.value), text: arg(i) };
      if (a?.kind === 'UnaryOp' && a.operator === '-' && a.operand.kind === 'NumberLiteral') return { n: -Number(a.operand.value), text: arg(i) };
      return { n: null, text: arg(i) };
    };
    const unit = (i: number, n: number | null) => {
      const word = (args[i] ? snippet(args[i]) : 'interval').toLowerCase();
      return n !== null && Math.abs(n) === 1 ? word : `${word}s`;
    };
    const shift = (n: { n: number | null; text: string }, u: string) =>
      n.n === null ? `moved by ${n.text} ${u}` : n.n === 0 ? 'not moved' : `${Math.abs(n.n)} ${u} ${n.n < 0 ? 'earlier' : 'later'}`;
    switch (name) {
      case 'DATESYTD':
        return `every date from the start of the year up to the last date in the current filter${args[1] ? ` (for a year ending ${arg(1)})` : ''}`;
      case 'DATESQTD':
        return 'every date from the start of the quarter up to the last date in the current filter';
      case 'DATESMTD':
        return 'every date from the start of the month up to the last date in the current filter';
      case 'DATESWTD':
        return 'every date from the start of the week up to the last date in the current filter';
      case 'SAMEPERIODLASTYEAR':
        return 'the same dates as the current filter, one year earlier';
      case 'DATEADD': {
        const n = count(1);
        return `the dates in the current filter, ${shift(n, unit(2, n.n))}`;
      }
      case 'PARALLELPERIOD': {
        const n = count(1);
        const u = unit(2, n.n);
        return `the whole ${unit(2, 1)}s of the current filter, ${shift(n, u)}`;
      }
      case 'DATESBETWEEN':
        return `every date from ${arg(1)} to ${arg(2)}`;
      case 'DATESINPERIOD': {
        const n = count(2);
        const u = unit(3, n.n);
        if (n.n === null) return `the dates in a period of ${n.text} ${u} from ${arg(1)}`;
        return n.n < 0 ? `the ${Math.abs(n.n)} ${u} up to ${arg(1)}` : `the ${n.n} ${u} from ${arg(1)}`;
      }
      case 'FIRSTDATE':
        return 'the first date in the current filter';
      case 'LASTDATE':
        return 'the last date in the current filter';
      default: {
        const match = /^(PREVIOUS|NEXT)(DAY|WEEK|MONTH|QUARTER|YEAR)$/.exec(name);
        if (!match) return `the dates ${name} works out`;
        const period = match[2].toLowerCase();
        return match[1] === 'PREVIOUS'
          ? `the whole ${period} before the first date in the current filter`
          : `the whole ${period} after the last date in the current filter`;
      }
    }
  }

  function classifyFilter(arg: Expr, calculate: FunctionCall, calculateName: string, mode: 'replace' | 'intersect'): FilterArgument {
    const origin = { kind: 'calculate' as const, nodeId: calculate.id, functionName: calculateName };
    switch (arg.kind) {
      case 'Omitted':
        return { kind: 'none' };
      case 'TableRef':
      case 'VariableRef':
        return tableFilter(arg, origin, mode);
      case 'BinaryOp':
      case 'UnaryOp':
        return predicateFilter(arg, origin, mode);
      case 'FunctionCall': {
        const spec = specOf(arg);
        switch (spec?.name) {
          case 'REMOVEFILTERS':
          case 'ALL': {
            if (arg.args.length === 0) return { kind: 'remove', removals: [{ kind: 'all' }], functionName: spec.name };
            const removals: Removal[] = [];
            for (const a of arg.args) {
              const column = columnOf(a);
              if (a.kind === 'TableRef') removals.push({ kind: 'table', table: a.name, except: [] });
              else if (column) removals.push({ kind: 'column', column });
              else return { kind: 'not-modeled', description: `the app can't work out ${spec.name}(${snippet(a)}) yet` };
            }
            return { kind: 'remove', removals, functionName: spec.name };
          }
          case 'ALLEXCEPT': {
            const [table, ...kept] = arg.args;
            const except = kept.map(columnOf);
            if (table?.kind === 'TableRef' && except.every((c): c is ColumnName => c !== null)) {
              return { kind: 'remove', removals: [{ kind: 'table', table: table.name, except }], functionName: 'ALLEXCEPT' };
            }
            return { kind: 'not-modeled', description: `the app can't work out ${snippet(arg)} yet` };
          }
          case 'ALLSELECTED': {
            if (arg.args.length === 0) return { kind: 'remove', removals: [{ kind: 'visual', columns: null, table: null }], functionName: 'ALLSELECTED' };
            const columns = arg.args.map(columnOf);
            if (columns.every((c): c is ColumnName => c !== null && c.table !== '')) {
              return { kind: 'remove', removals: [{ kind: 'visual', columns, table: null }], functionName: 'ALLSELECTED' };
            }
            if (arg.args.length === 1 && arg.args[0].kind === 'TableRef') {
              return { kind: 'remove', removals: [{ kind: 'visual', columns: null, table: arg.args[0].name }], functionName: 'ALLSELECTED' };
            }
            return { kind: 'not-modeled', description: `the app can't work out ${snippet(arg)} (it needs Table[Column] references or a table)` };
          }
          case 'USERELATIONSHIP':
          case 'CROSSFILTER': {
            const [a, b] = [arg.args[0], arg.args[1]].map((x) => (x ? columnOf(x) : null));
            if (!a || !b || a.table === '' || b.table === '') {
              return { kind: 'not-modeled', description: `the app can't tell which relationship ${snippet(arg)} means (it needs two Table[Column] references)` };
            }
            if (spec.name === 'USERELATIONSHIP') return { kind: 'relationship', change: { kind: 'use', columns: [a, b], nodeId: arg.id, functionName: spec.name } };
            const keyword = arg.args[2] ? snippet(arg.args[2]).toUpperCase() : '';
            const directions: Record<string, RelationshipChange['direction']> = { NONE: 'none', ONEWAY: 'oneway', BOTH: 'both', ONEWAY_LEFTFILTERSRIGHT: 'left-filters-right', ONEWAY_RIGHTFILTERSLEFT: 'right-filters-left' };
            const direction = directions[keyword];
            if (!direction) return { kind: 'not-modeled', description: `the app doesn't know the direction ${keyword || '(missing)'} in ${snippet(arg)}` };
            return { kind: 'relationship', change: { kind: 'crossfilter', columns: [a, b], direction, nodeId: arg.id, functionName: spec.name } };
          }
          case 'DATESYTD':
          case 'DATESQTD':
          case 'DATESMTD':
          case 'DATESWTD':
          case 'PREVIOUSWEEK':
          case 'NEXTWEEK':
          case 'SAMEPERIODLASTYEAR':
          case 'DATEADD':
          case 'PARALLELPERIOD':
          case 'DATESBETWEEN':
          case 'DATESINPERIOD':
          case 'PREVIOUSDAY':
          case 'PREVIOUSMONTH':
          case 'PREVIOUSQUARTER':
          case 'PREVIOUSYEAR':
          case 'NEXTDAY':
          case 'NEXTMONTH':
          case 'NEXTQUARTER':
          case 'NEXTYEAR':
          case 'FIRSTDATE':
          case 'LASTDATE':
            return timeFilter(spec.name, arg.args, calculate, calculateName, mode);
          case 'TREATAS': {
            const [values, ...targets] = arg.args;
            const columns = targets.map(columnOf);
            if (!values || columns.length === 0 || !columns.every((c): c is ColumnName => c !== null && c.table !== '')) {
              return { kind: 'not-modeled', description: `the app can't work out ${snippet(arg)} (it needs a table and Table[Column] references)` };
            }
            const shape = shapeOf(values);
            const from = shape.kind === 'columns' ? [...new Set(shape.columns.map((c) => c.table).filter((t) => t !== ''))] : shape.kind === 'table' ? [shape.table] : [];
            return {
              kind: 'filter',
              entry: {
                target: { kind: 'columns', columns },
                condition: values.kind === 'TableConstructor' ? `in ${snippet(values, 60)}` : `= the values of ${snippet(values, 60)}`,
                origin,
                mode,
                treatAsFrom: from,
              },
            };
          }
          case 'KEEPFILTERS': {
            const inner = arg.args[0];
            return inner ? classifyFilter(inner, calculate, calculateName, 'intersect') : { kind: 'none' };
          }
          default:
            if (spec?.returns === 'table') return tableFilter(arg, origin, mode);
            if (spec) return predicateFilter(arg, origin, mode);
            return { kind: 'not-modeled', description: `this filter uses ${arg.name}, which the app doesn't know yet` };
        }
      }
      default:
        return { kind: 'not-modeled', description: `the app can't work out the filter ${snippet(arg)}` };
    }
  }

  function tableFilter(arg: Expr, origin: FilterEntry['origin'], mode: FilterEntry['mode']): FilterArgument {
    const shape = shapeOf(arg);
    return {
      kind: 'filter',
      entry: { target: targetOfShape(shape), condition: `limited to the rows of ${snippet(arg, 80)}`, origin, mode },
    };
  }

  function predicateFilter(arg: Expr, origin: FilterEntry['origin'], mode: FilterEntry['mode']): FilterArgument {
    const references: (BracketRef | ColumnRef)[] = [];
    const collect = (n: AstNode) => {
      if (n.kind === 'BracketRef' || n.kind === 'ColumnRef') references.push(n);
      else for (const child of childrenOf(n)) collect(child.node);
    };
    collect(arg);

    const nonColumn = references.filter((r) => binding.references.get(r.id)?.type !== 'column');
    if (nonColumn.length > 0) {
      const names = nonColumn.map((r) => snippet(r)).join(', ');
      const unresolved = nonColumn.some((r) => binding.references.get(r.id)?.type == null);
      return {
        kind: 'not-modeled',
        description: unresolved
          ? `the filter ${snippet(arg)} depends on whether ${names} is a measure or a column (choose in the tree)`
          : `the filter ${snippet(arg)} compares a measure (${names}); CALCULATE filters normally compare columns, so the app can't work this one out`,
      };
    }
    const columns: ColumnName[] = [];
    for (const r of references) {
      const column = columnOf(r)!;
      if (!columns.some((c) => sameColumn(c, column))) columns.push(column);
    }
    if (columns.length === 0) {
      return { kind: 'not-modeled', description: `the filter ${snippet(arg)} doesn't use any column, so the app can't tell what it filters` };
    }
    const tables = new Set(columns.map((c) => c.table.toLowerCase()));
    if (tables.has('') || tables.size > 1) {
      return {
        kind: 'not-modeled',
        description: `the filter ${snippet(arg)} uses columns from more than one table (or without a table name), so the app can't work it out`,
      };
    }

    // Simple shapes get a short condition; anything else shows the predicate itself.
    let condition = `where ${snippet(arg, 70)}`;
    if (arg.kind === 'BinaryOp' && columns.length === 1) {
      const leftIsColumn = columnOf(arg.left) !== null;
      const other = leftIsColumn ? arg.right : arg.left;
      if ((arg.operator === '=' || arg.operator === '==') && (columnOf(arg.left) || columnOf(arg.right))) {
        condition = `= ${snippet(other, 40)}`;
      } else if (arg.operator === 'IN' && leftIsColumn) {
        condition = `IN ${snippet(other, 50)}`;
      }
    }
    implicitRows.set(arg.id, {
      nodeId: arg.id,
      functionName: 'the filter condition',
      table: { kind: 'columns', columns, description: `ALL(${columns.map(columnText).join(', ')})` },
    });
    return { kind: 'filter', entry: { target: { kind: 'columns', columns }, condition, origin, mode } };
  }

  // -------------------------------------------------------------- references

  function visitReference(node: BracketRef | ColumnRef, ctx: EvalContext, role: ArgRole | null) {
    const label = snippet(node);
    if (role === 'column' || role === 'tableOrColumn') {
      record({
        nodeId: node.id,
        context: ctx,
        operations: [],
        summary: 'The column itself is handed to the function around it.',
        notes: [`Here the column itself is handed to the function around it (for example SUM or VALUES), and that function decides what to do with it.`],
      });
      return;
    }
    const type = binding.references.get(node.id)?.type ?? null;
    if (type === 'measure') {
      const measure = measureStep(node.id, label, ctx, true);
      record({ nodeId: node.id, context: ctx, ...measure });
    } else if (type === 'column') {
      const column = columnNotes(node, label, ctx, true);
      record({ nodeId: node.id, context: ctx, operations: [], summary: column.summary, notes: column.notes });
    } else {
      const measure = measureStep(node.id, label, ctx, false);
      record({
        nodeId: node.id,
        context: ctx,
        operations: [],
        summary: `${label} could be a measure or a column; both outcomes are shown.`,
        notes: [`${label} could be a measure or a column, and that changes what happens here, so both are shown below. Choose "measure" or "column" in the tree to see just one.`],
        alternatives: {
          ifMeasure: { operations: measure.operations, innerContext: measure.innerContext, notes: measure.notes },
          ifColumn: { notes: columnNotes(node, label, ctx, false).notes },
        },
      });
    }
  }

  function measureStep(nodeId: number, label: string, ctx: EvalContext, reportInsight: boolean) {
    if (ctx.rows.length === 0) {
      return {
        operations: [] as Operation[],
        innerContext: ctx,
        summary: `${label}, with the filters shown.`,
        notes: [],
      };
    }
    const transition = contextTransition(ctx, nodeId);
    const innermost = ctx.rows[ctx.rows.length - 1];
    const summary = `${label} for the current row of ${innermost.functionName}.`;
    if (reportInsight) {
      insights.push({
        kind: 'context-transition',
        nodeId,
        summary,
        message: `${label} is calculated for each row of ${innermost.functionName} (${innermost.table.description}). Each time, the current row becomes a filter (context transition), so only that row's data counts.`,
      });
    }
    return {
      operations: [{ kind: 'context-transition', rows: ctx.rows, added: transition.added }] as Operation[],
      innerContext: { filter: transition.fc, rows: ctx.rows, unknownReason: null },
      summary,
      notes: [
        `Calculated for each row, with that row turned into a filter (context transition): only its data counts. (A measure always acts as if wrapped in CALCULATE.)`,
      ],
    };
  }

  function columnNotes(
    node: BracketRef | ColumnRef,
    label: string,
    ctx: EvalContext,
    reportInsight: boolean,
  ): { summary: string; notes: string[] } {
    if (ctx.rows.length === 0) {
      const summary = `${label} has no current row to read from (an error in a measure).`;
      const message = `${label} is used on its own here, but nothing is going row by row, so there is no "current row" to read it from. In a measure, DAX can't pick one value out of a whole column and shows an error. Wrap it in something like SUM(${label}) or SELECTEDVALUE(${label}).`;
      if (reportInsight) insights.push({ kind: 'column-without-row-context', nodeId: node.id, summary, message });
      return { summary, notes: [message] };
    }
    const column: ColumnName = node.kind === 'ColumnRef' ? { table: node.table, column: node.column } : { table: '', column: node.name };
    const covering = [...ctx.rows].reverse().find((row) => {
      if (row.table.kind === 'table') return inTable(column, row.table.table);
      if (row.table.kind === 'columns') {
        return row.table.columns.some((c) => (column.table === '' ? same(c.column, column.column) : sameColumn(c, column)));
      }
      return false;
    });
    if (covering && implicitRows.get(covering.nodeId) === covering) {
      return {
        summary: `The value of ${label} being checked by the filter condition.`,
        notes: [`CALCULATE checks this condition once for each value of ${label}; here ${label} is the value being checked.`],
      };
    }
    if (covering) {
      const note = `Reads ${label} from the row that ${covering.functionName} is currently on.`;
      return { summary: note, notes: [note] };
    }
    const innermost = ctx.rows[ctx.rows.length - 1];
    if (column.table === '' || innermost.table.kind === 'unknown') {
      return {
        summary: `Reads ${label} from the row that ${innermost.functionName} is currently on.`,
        notes: [`Reads ${label} from the row that ${innermost.functionName} is currently on (assuming ${innermost.table.description} has this column).`],
      };
    }
    return {
      summary: `${columnText(column)} is in a different table from the one ${innermost.functionName} goes through (usually needs RELATED).`,
      notes: [
        `${innermost.functionName} is going row by row through ${innermost.table.description}, but ${columnText(column)} is in a different table. You would usually need RELATED(${columnText(column)}) to look it up, and whether that works depends on the data model, which this app can't see.`,
      ],
    };
  }

  visit(root, initial, null);
  return { steps, insights };
}
