import type { BindResult } from '../binder/binder';
import type { ArgRole, FunctionSpec, ParamSpec } from '../catalog/functions';
import { childrenOf, type AstNode, type BracketRef, type ColumnRef, type Expr, type FunctionCall } from '../parser/ast';
import { createLineMap } from '../source';
import { columnText, filterSignature, removalText } from './describe';
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
  RowContext,
  Step,
  TableShape,
} from './model';
import { INITIAL_CONTEXT } from './model';

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
export function analyzeContext(root: Expr | null, binding: BindResult, source: string): ContextAnalysis {
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
    if (removal.kind === 'column') {
      return target.kind === 'columns' && target.columns.some((c) => sameColumn(c, removal.column));
    }
    // table removal
    if (target.kind === 'table') return same(target.table, removal.table);
    return target.columns.some((c) => inTable(c, removal.table) && !removal.except.some((e) => sameColumn(e, c)));
  }

  function removalAlreadyImplied(existing: readonly Removal[], removal: Removal): boolean {
    return existing.some((r) => {
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
        : removalAlreadyImplied(fc.removals, removal)
          ? fc.removals
          : [...fc.removals, removal];
    const caveats = [...fc.caveats];
    if (removal.kind === 'table') {
      caveats.push(
        `removing filters from the whole ${removal.table} table can also remove filters on tables related to it; that depends on the data model, which this app can't see`,
      );
    }
    return { fc: { removals, entries: fc.entries.filter((e) => !removedEntries.includes(e)), caveats }, removedEntries };
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
    if (target.kind === 'table') {
      caveats.push(
        `filtering the whole ${target.table} table can also filter tables related to it; that depends on the data model, which this app can't see`,
      );
    }
    return { fc: { removals, entries: [...fc.entries.filter((e) => !replaced.includes(e)), entry], caveats }, replaced, replacesIncoming };
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
        condition: target.kind === 'columns' ? `= the current row's value` : 'limited to the current row',
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
        if (info?.shape) return { ...info.shape, description: `VAR ${info.name} (${info.shape.description})` } as TableShape;
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
            notes: [`Calculated once, right here, using the filters shown above. Every later use of ${declaration.name} reuses this result.`],
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
    const notes = [`Uses the result of VAR ${name}${where}. It was calculated there, once, and is not recalculated here.`];
    if (info) {
      const filtersDiffer = filterSignature(info.context) !== filterSignature(ctx);
      const newRows = ctx.rows.filter((row) => !info.context.rows.includes(row));
      if (filtersDiffer) {
        const message = `The filters here are different from where ${name} was calculated${where}, but ${name} is not recalculated: it keeps the value it got there. This is a common surprise when a variable is used inside CALCULATE.`;
        notes.push(message);
        insights.push({ kind: 'variable-fixed', nodeId, message });
      } else if (newRows.length > 0) {
        const message = `${name} was calculated once${where}, before ${newRows.map((r) => r.functionName).join(' and ')} started going row by row, so it has the same value for every row.`;
        notes.push(message);
        insights.push({ kind: 'variable-fixed', nodeId, message });
      }
    }
    record({ nodeId, context: ctx, operations: [], notes });
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
      insights.push({ kind: 'unknown-function', nodeId: node.id, message });
      record({ nodeId: node.id, context: ctx, operations: [], notes: [message] });
      const unknown: EvalContext = { ...ctx, unknownReason: reason };
      for (const arg of node.args) visit(arg, unknown, null);
      return;
    }
    if (spec.name === 'CALCULATE' || spec.name === 'CALCULATETABLE' || spec.name === 'RELATEDTABLE') {
      visitCalculate(node, ctx, spec);
      return;
    }
    if (spec.iteratesArgument !== undefined) {
      visitIterator(node, ctx, spec, call.params);
      return;
    }
    record({ nodeId: node.id, context: ctx, operations: [], notes: genericNotes(node, spec, role) });
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
      notes: [
        `${spec.name} goes through ${row.table.description} one row at a time (row context). The inputs marked "per row" are calculated separately for each row. Going row by row does not filter anything on its own.`,
      ],
    });
  }

  // --------------------------------------------------------------- CALCULATE

  type FilterArgument =
    | { kind: 'remove'; removals: Removal[]; functionName: string }
    | { kind: 'filter'; entry: FilterEntry }
    | { kind: 'not-modeled'; description: string }
    | { kind: 'none' };

  function visitCalculate(node: FunctionCall, ctx: EvalContext, spec: FunctionSpec) {
    const isRelatedTable = spec.name === 'RELATEDTABLE';
    const [first, ...filterArgs] = node.args;
    const operations: Operation[] = [];

    // Classify first (this registers implicit row contexts for boolean filters), then:
    // 1. Filter arguments are evaluated in the outer context.
    const classified = isRelatedTable ? [] : filterArgs.map((arg) => ({ arg, c: classifyFilter(arg, node, spec.name, 'replace') }));
    if (!isRelatedTable) for (const arg of filterArgs) visit(arg, ctx, 'filter');

    // 2. Context transition.
    let fc = ctx.filter;
    if (ctx.rows.length > 0) {
      const transition = contextTransition(ctx, node.id);
      fc = transition.fc;
      operations.push({ kind: 'context-transition', rows: ctx.rows, added: transition.added });
      insights.push({
        kind: 'context-transition',
        nodeId: node.id,
        message: `This ${spec.name} is inside ${ctx.rows.map((r) => r.functionName).join(' and ')}, which is going row by row. So each time it runs, the current row becomes a filter (context transition) and only data for that row is included.`,
      });
    }

    // 3. Modifiers.
    for (const { arg, c } of classified) {
      if (c.kind !== 'remove') continue;
      for (const removal of c.removals) {
        const result = removeFilters(fc, removal);
        fc = result.fc;
        operations.push({ kind: 'remove-filters', removal, nodeId: arg.id, functionName: c.functionName, removedEntries: result.removedEntries });
      }
      const step = steps.get(arg.id);
      if (step) {
        step.notes = [
          `Removes any filter on ${c.removals.map(removalText).join('; ')}, but only for the calculation inside this ${spec.name}.`,
        ];
      }
    }
    for (const { arg, c } of classified) {
      if (c.kind !== 'not-modeled') continue;
      fc = { ...fc, caveats: [...fc.caveats, c.description] };
      operations.push({ kind: 'not-modeled', nodeId: arg.id, description: c.description });
      insights.push({ kind: 'not-modeled', nodeId: arg.id, message: c.description });
      const step = steps.get(arg.id);
      if (step) step.notes = [`Not modeled: ${c.description}`];
    }

    // 4. Filters.
    for (const { arg, c } of classified) {
      if (c.kind !== 'filter') continue;
      const result = addFilter(fc, c.entry);
      fc = result.fc;
      operations.push({ kind: 'add-filter', entry: c.entry, nodeId: arg.id, replaced: result.replaced, replacesIncoming: result.replacesIncoming });
      const step = steps.get(arg.id);
      if (step) {
        step.notes = [
          c.entry.mode === 'intersect'
            ? `Because of KEEPFILTERS, this filter is added on top of the filters already in effect. Only rows that pass both are included.`
            : `This filter replaces any filter already on the same column, but only for the calculation inside this ${spec.name}.`,
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
      // The step-by-step explanation of CALCULATE is generated by the UI from `operations`.
      notes: isRelatedTable
        ? ['RELATEDTABLE is CALCULATETABLE with no filters: in a row context, context transition selects the related rows.']
        : [],
    });
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
          case 'ALLSELECTED':
            return {
              kind: 'not-modeled',
              description: 'ALLSELECTED brings back the filters chosen outside this visual (for example, slicers); the app can\'t work this out yet',
            };
          case 'USERELATIONSHIP':
          case 'CROSSFILTER':
            return {
              kind: 'not-modeled',
              description: `${spec.name} switches which relationship between tables is used (or its direction); that depends on the data model, which this app can't see`,
            };
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
        notes: [`Here the column itself is handed to the function around it (for example SUM or VALUES), and that function decides what to do with it.`],
      });
      return;
    }
    const type = binding.references.get(node.id)?.type ?? null;
    if (type === 'measure') {
      const measure = measureStep(node.id, label, ctx, true);
      record({ nodeId: node.id, context: ctx, ...measure });
    } else if (type === 'column') {
      record({ nodeId: node.id, context: ctx, operations: [], notes: columnNotes(node, label, ctx, true) });
    } else {
      const measure = measureStep(node.id, label, ctx, false);
      record({
        nodeId: node.id,
        context: ctx,
        operations: [],
        notes: [`${label} could be a measure or a column, and that changes what happens here, so both are shown below. Choose "measure" or "column" in the tree to see just one.`],
        alternatives: {
          ifMeasure: { operations: measure.operations, innerContext: measure.innerContext, notes: measure.notes },
          ifColumn: { notes: columnNotes(node, label, ctx, false) },
        },
      });
    }
  }

  function measureStep(nodeId: number, label: string, ctx: EvalContext, reportInsight: boolean) {
    if (ctx.rows.length === 0) {
      return {
        operations: [] as Operation[],
        innerContext: ctx,
        notes: [`This measure is calculated using the filters shown above. Nothing here is going row by row, so nothing extra is added.`],
      };
    }
    const transition = contextTransition(ctx, nodeId);
    const innermost = ctx.rows[ctx.rows.length - 1];
    if (reportInsight) {
      insights.push({
        kind: 'context-transition',
        nodeId,
        message: `${label} is calculated once for each row that ${innermost.functionName} goes through (${innermost.table.description}). Each time, DAX first turns the current row into a filter (context transition), so only data for that row is included.`,
      });
    }
    return {
      operations: [{ kind: 'context-transition', rows: ctx.rows, added: transition.added }] as Operation[],
      innerContext: { filter: transition.fc, rows: ctx.rows, unknownReason: null },
      notes: [
        `${ctx.rows.map((r) => r.functionName).join(' and ')} ${ctx.rows.length === 1 ? 'is' : 'are'} going row by row, so ${label} is calculated once for each row. Before each calculation, DAX turns the current row into a filter (context transition), so the measure only includes data for that row.`,
        `(A measure used like this always behaves as if it were wrapped in CALCULATE.)`,
      ],
    };
  }

  function columnNotes(node: BracketRef | ColumnRef, label: string, ctx: EvalContext, reportInsight: boolean): string[] {
    if (ctx.rows.length === 0) {
      const message = `${label} is used on its own here, but nothing is going row by row, so there is no "current row" to read it from. In a measure, DAX can't pick one value out of a whole column and shows an error. Wrap it in something like SUM(${label}) or SELECTEDVALUE(${label}).`;
      if (reportInsight) insights.push({ kind: 'column-without-row-context', nodeId: node.id, message });
      return [message];
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
      return [`CALCULATE checks this condition once for each value of ${label}; here ${label} is the value being checked.`];
    }
    if (covering) return [`Reads ${label} from the row that ${covering.functionName} is currently on.`];
    const innermost = ctx.rows[ctx.rows.length - 1];
    if (column.table === '' || innermost.table.kind === 'unknown') {
      return [`Reads ${label} from the row that ${innermost.functionName} is currently on (assuming ${innermost.table.description} has this column).`];
    }
    return [
      `${innermost.functionName} is going row by row through ${innermost.table.description}, but ${columnText(column)} is in a different table. You would usually need RELATED(${columnText(column)}) to look it up, and whether that works depends on the data model, which this app can't see.`,
    ];
  }

  visit(root, INITIAL_CONTEXT, null);
  return { steps, insights };
}
