import { lookupFunction, parametersForCall, type FunctionSpec, type ParamSpec } from '../catalog/functions';
import type { Diagnostic } from '../diagnostics';
import { childrenOf, type AstNode, type BracketRef, type ColumnRef, type Expr } from '../parser/ast';

/**
 * The binder attaches meaning that the parser cannot know:
 *  - which catalog function each call refers to (and the role of each argument),
 *  - whether each [X] / Table[X] reference is a measure or a column, and WHY.
 *
 * Evidence, strongest first:
 *  1. function-signature  — the argument position only accepts a column. Certain; locks the choice.
 *  2. user                — the user said so.
 *  3. other-occurrence    — (convention mode only) the same name is used as a column elsewhere. Assumed.
 *  4. convention          — (convention mode only) [X] is a measure, Table[X] is a column. Assumed.
 *  Otherwise the reference stays unresolved; nothing is guessed.
 */

export type ReferenceType = 'measure' | 'column';
export type ResolutionMode = 'convention' | 'strict';
export type ResolutionSource = 'function-signature' | 'user' | 'other-occurrence' | 'convention' | 'unresolved';

export interface ReferenceResolution {
  nodeId: number;
  /** Normalized identity used to apply one choice to every occurrence, e.g. "[total sales]". */
  key: string;
  type: ReferenceType | null;
  source: ResolutionSource;
  /** Human-readable reason, e.g. "required by SUM (column argument)". */
  detail: string;
  /** True when the function signature decides; the user cannot override it. */
  locked: boolean;
}

export interface CallBinding {
  nodeId: number;
  /** Undefined when the function is not in the catalog. */
  spec: FunctionSpec | undefined;
  /** Parameter for each argument position; null if unknown or the argument count fits no overload. */
  params: ParamSpec[] | null;
}

export interface BindOptions {
  mode: ResolutionMode;
  /** Keyed by ReferenceResolution.key. */
  userChoices: Readonly<Record<string, ReferenceType>>;
}

export interface BindResult {
  references: Map<number, ReferenceResolution>;
  calls: Map<number, CallBinding>;
  /** Bare names that are keyword arguments (e.g. DESC in RANKX), not table references. */
  keywordNodeIds: Set<number>;
  /** Distinct functions not in the catalog, as first written. */
  unknownFunctions: string[];
  diagnostics: Diagnostic[];
}

export function referenceKey(node: BracketRef | ColumnRef): string {
  return node.kind === 'BracketRef'
    ? `[${node.name.toLowerCase()}]`
    : `${node.table.toLowerCase()}[${node.column.toLowerCase()}]`;
}

interface ColumnRequirement {
  functionName: string;
  parameterName: string;
}

interface ReferenceOccurrence {
  node: BracketRef | ColumnRef;
  requirement: ColumnRequirement | null;
}

export function bind(root: Expr | null, options: BindOptions): BindResult {
  const result: BindResult = {
    references: new Map(),
    calls: new Map(),
    keywordNodeIds: new Set(),
    unknownFunctions: [],
    diagnostics: [],
  };
  if (!root) return result;

  const occurrences: ReferenceOccurrence[] = [];
  const unknown = new Map<string, string>();

  // ---- Pass 1: walk the tree, bind calls, collect references and positional evidence ----
  function visit(node: AstNode, requirement: ColumnRequirement | null) {
    if (node.kind === 'BracketRef' || node.kind === 'ColumnRef') {
      occurrences.push({ node, requirement });
      return;
    }
    if (node.kind !== 'FunctionCall') {
      for (const child of childrenOf(node)) visit(child.node, null);
      return;
    }

    const spec = lookupFunction(node.name);
    const params = spec ? parametersForCall(spec, node.args.length) : null;
    result.calls.set(node.id, { nodeId: node.id, spec, params });

    if (!spec) {
      const upper = node.name.toUpperCase();
      if (!unknown.has(upper)) unknown.set(upper, node.name);
    } else if (!params) {
      result.diagnostics.push({
        severity: 'warning',
        code: 'argument-count',
        message: `${spec.name} does not accept ${node.args.length} ${node.args.length === 1 ? 'argument' : 'arguments'} (${describeArity(spec)}).`,
        span: node.nameSpan,
      });
    }

    node.args.forEach((arg, index) => {
      const param = params?.[index];
      if (param?.role === 'keyword' && arg.kind === 'TableRef' && !arg.quoted && param.keywords?.includes(arg.name.toUpperCase())) {
        result.keywordNodeIds.add(arg.id);
        return;
      }
      const requiresColumn = param?.role === 'column' || param?.role === 'tableOrColumn';
      // In a tableOrColumn position a bracketed reference cannot be a table, so it must be a column.
      visit(arg, requiresColumn && spec ? { functionName: spec.name, parameterName: param.name } : null);
    });
  }
  visit(root, null);
  result.unknownFunctions = [...unknown.values()];

  // ---- Pass 2: resolve each reference from the evidence ----
  const columnUseElsewhere = new Map<string, ColumnRequirement>();
  for (const { node, requirement } of occurrences) {
    const key = referenceKey(node);
    if (requirement && !columnUseElsewhere.has(key)) columnUseElsewhere.set(key, requirement);
  }

  for (const { node, requirement } of occurrences) {
    const key = referenceKey(node);
    const userChoice = options.userChoices[key];
    let resolution: ReferenceResolution;

    if (requirement) {
      resolution = {
        nodeId: node.id,
        key,
        type: 'column',
        source: 'function-signature',
        detail: `certain: ${requirement.functionName} only accepts a column here`,
        locked: true,
      };
      if (userChoice === 'measure') {
        result.diagnostics.push({
          severity: 'warning',
          code: 'reference-type-conflict',
          message: `You marked ${displayName(node)} as a measure, but ${requirement.functionName} only accepts a column in this position.`,
          span: node.span,
        });
      }
    } else if (userChoice) {
      resolution = { nodeId: node.id, key, type: userChoice, source: 'user', detail: 'your choice', locked: false };
    } else if (options.mode === 'convention') {
      const elsewhere = columnUseElsewhere.get(key);
      resolution = elsewhere
        ? {
            nodeId: node.id,
            key,
            type: 'column',
            source: 'other-occurrence',
            detail: `assumed to be a column, because the same name is used as a column in ${elsewhere.functionName} elsewhere in this DAX`,
            locked: false,
          }
        : {
            nodeId: node.id,
            key,
            type: node.kind === 'BracketRef' ? 'measure' : 'column',
            source: 'convention',
            detail:
              node.kind === 'BracketRef'
                ? 'assumed, because names in [brackets] without a table name are usually measures'
                : 'assumed, because names written as Table[Name] are usually columns',
            locked: false,
          };
    } else {
      const elsewhere = columnUseElsewhere.get(key);
      resolution = {
        nodeId: node.id,
        key,
        type: null,
        source: 'unresolved',
        detail: elsewhere
          ? `unknown: use the measure / column buttons to choose (hint: it is used as a column in ${elsewhere.functionName} elsewhere)`
          : 'unknown: use the measure / column buttons to choose',
        locked: false,
      };
    }
    result.references.set(node.id, resolution);
  }

  return result;
}

function displayName(node: BracketRef | ColumnRef): string {
  return node.kind === 'BracketRef' ? `[${node.name}]` : `${node.table}[${node.column}]`;
}

function describeArity(spec: FunctionSpec): string {
  const counts = spec.overloads.map((params) => {
    const required = params.filter((param) => !param.optional).length;
    if (params.some((param) => param.repeating)) return `${required} or more`;
    return required === params.length ? `${required}` : `${required} to ${params.length}`;
  });
  return `expects ${counts.join(' or ')}`;
}
