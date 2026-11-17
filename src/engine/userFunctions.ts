/**
 * User-defined functions of a connected model (DAX's FUNCTION): their inputs, read from the start of their code,
 * "(value : SCALAR NUMERIC VAL, digits : SCALAR INT64 VAL = 2) => …", and a catalog entry built from them.
 *
 * How the inputs are passed, checked in Power BI Desktop (functions defined in a query on Initech):
 *  - VAL (the default, also when no type is written): worked out once, before the function runs, with the
 *    caller's filters, like a variable. CALCULATE(x, ALL('Product')) inside the function doesn't change it.
 *  - EXPR, and references (ANYREF, COLUMNREF, MEASUREREF, TABLEREF, CALENDARREF): the code is passed, and worked
 *    out wherever the function uses it, with the function's filters there.
 *  - Calling a function inside a loop doesn't turn the row into a filter (unlike a measure), and the function's
 *    code can't read the loop's current row: a column of it must be passed in as a VAL input.
 *  - An input with a default (= 20) may be left out. Too many or too few inputs are errors.
 */
import { lookupFunction } from './catalog/functions';
import type { ArgRole, FunctionSpec, ParamSpec } from './catalog/spec';
import { tokenize } from './lexer/lexer';
import type { Expr } from './parser/ast';
import { parse } from './parser/parser';

export interface UserFunctionParam {
  name: string;
  /** As written after the colon, without the mode, e.g. "SCALAR NUMERIC"; '' when no type is written. */
  type: string;
  /** VAL: worked out before the call; EXPR: worked out inside the function (references are always EXPR). */
  mode: 'val' | 'expr';
  /** For references: what they name. */
  reference?: 'any' | 'column' | 'measure' | 'table' | 'calendar';
  /** The default value as written, or null when the input is required. */
  defaultText: string | null;
}

export interface UserFunction {
  name: string;
  expression: string;
  description: string | null;
  /** Null when the start of the code can't be read: the function is then treated as unknown. */
  params: UserFunctionParam[] | null;
  /** Where the function's own code starts (after "=>"). */
  bodyStart: number;
}

const REFERENCES: Record<string, UserFunctionParam['reference']> = {
  ANYREF: 'any',
  COLUMNREF: 'column',
  MEASUREREF: 'measure',
  TABLEREF: 'table',
  CALENDARREF: 'calendar',
};

/** Skips spaces and comments (//, --, /* … *\/) from `i`. */
function skipBlank(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('//', i) || text.startsWith('--', i)) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      return i;
    }
  }
}

/** The inputs between the brackets, split at top-level commas (strings and brackets kept whole), and the end. */
function splitInputs(text: string, open: number): { parts: string[]; close: number } | null {
  const parts: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end === -1) return null;
      i = end;
    } else if (c === '[') {
      const end = text.indexOf(']', i + 1);
      if (end === -1) return null;
      i = end;
    } else if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') {
      if (depth === 0 && c === ')') {
        const last = text.slice(start, i).trim();
        if (last !== '' || parts.length > 0) parts.push(last);
        return { parts, close: i };
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

function readInput(part: string): UserFunctionParam | null {
  const equals = part.indexOf('=');
  const head = (equals === -1 ? part : part.slice(0, equals)).trim();
  const defaultText = equals === -1 ? null : part.slice(equals + 1).trim();
  const [rawName, rawType = ''] = head.split(':');
  const name = rawName.trim();
  if (!/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name)) return null;
  const words = rawType.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const reference = words.map((w) => REFERENCES[w]).find(Boolean);
  const explicitMode = words.find((w) => w === 'VAL' || w === 'EXPR');
  const type = words.filter((w) => w !== 'VAL' && w !== 'EXPR').join(' ');
  return {
    name,
    type,
    mode: reference || explicitMode === 'EXPR' ? 'expr' : 'val',
    ...(reference ? { reference } : {}),
    defaultText: defaultText === '' ? null : defaultText,
  };
}

/** Reads a function's inputs from the start of its code; `params` is null when that can't be done. */
export function readUserFunction(name: string, expression: string, description: string | null = null): UserFunction {
  const unreadable: UserFunction = { name, expression, description, params: null, bodyStart: 0 };
  const open = skipBlank(expression, 0);
  if (expression[open] !== '(') return unreadable;
  const inputs = splitInputs(expression, open);
  if (!inputs) return unreadable;
  const arrow = skipBlank(expression, inputs.close + 1);
  if (!expression.startsWith('=>', arrow)) return unreadable;
  const params = inputs.parts.map(readInput);
  if (params.some((p) => p === null)) return unreadable;
  return { name, expression, description, params: params as UserFunctionParam[], bodyStart: arrow + 2 };
}

/**
 * The function's code as if written at the call (how Power BI runs it: checked in Power BI Desktop, it adds no
 * context transition, and a loop's current row reaches its code): a VAR for each value input (the code written at
 * the call) and each left-out input (its default), then the function's own code, with each expression input and
 * reference pasted where it is used. `args` are the inputs' code as written at the call. Null when the inputs
 * can't be read, or when there are more inputs than the function takes.
 */
export function inlineCall(fn: UserFunction, args: readonly string[]): string | null {
  if (!fn.params || args.length > fn.params.length) return null;
  const vars: string[] = [];
  const pasted = new Map<string, string>();
  fn.params.forEach((param, i) => {
    const arg = args[i];
    if (arg === undefined) {
      if (param.defaultText === null) return;
      vars.push(`VAR ${param.name} = ${param.defaultText}`);
    } else if (param.mode === 'val') {
      vars.push(`VAR ${param.name} = ${arg}`);
    } else {
      // A reference stays a reference (a column in VALUES(c) can't be in brackets); other code is bracketed.
      const isReference = /^('[^']*(?:''[^']*)*'|[\p{L}_][\p{L}\p{N}_.]*)?(\[[^\]]*(?:\]\][^\]]*)*\])?$/u.test(arg.trim());
      pasted.set(param.name.toLowerCase(), isReference ? arg.trim() : `(${arg.trim()})`);
    }
  });
  let body = fn.expression.slice(fn.bodyStart);
  if (pasted.size > 0) {
    const { tokens } = tokenize(fn.expression, fn.bodyStart);
    let out = '';
    let at = fn.bodyStart;
    tokens.forEach((token, i) => {
      const replacement = token.kind === 'Identifier' ? pasted.get(token.text.toLowerCase()) : undefined;
      // Not a function call with the same name.
      if (!replacement || tokens[i + 1]?.text === '(') return;
      out += fn.expression.slice(at, token.span.start) + replacement;
      at = token.span.end;
    });
    body = out + fn.expression.slice(at);
  }
  body = body.trim();
  return vars.length > 0 ? `${vars.join('\n')}\nRETURN\n${body}` : body;
}

/** The role the app gives an input: VAL inputs are worked out in the caller's context; the rest inside. */
export function userInputRole(param: UserFunctionParam): ArgRole {
  if (param.mode === 'expr') return 'inside';
  return /^TABLE\b/.test(param.type) ? 'table' : 'scalar';
}

/**
 * What the function returns, from its code's outermost expression (after its variables): a table for a table
 * function, {…} or a table name; a value otherwise. Another user-defined function there is taken as a value.
 */
function returnsOf(fn: UserFunction): 'scalar' | 'table' {
  let node: Expr | null = parse(tokenize(fn.expression, fn.bodyStart).tokens).root;
  while (node?.kind === 'VarBlock') node = node.body;
  if (!node) return 'scalar';
  if (node.kind === 'TableConstructor' || node.kind === 'TableRef') return 'table';
  if (node.kind === 'FunctionCall') return lookupFunction(node.name)?.returns ?? 'scalar';
  return 'scalar';
}

/** A catalog entry for a readable function: one input list, with inputs that have defaults optional. */
export function userFunctionSpec(fn: UserFunction): FunctionSpec | undefined {
  if (!fn.params) return undefined;
  const params: ParamSpec[] = fn.params.map((param) => ({
    name: param.name,
    role: userInputRole(param),
    ...(param.defaultText !== null ? { optional: true } : {}),
  }));
  return {
    name: fn.name,
    category: 'other',
    returns: returnsOf(fn),
    summary: fn.description ?? `The model's own function ${fn.name}.`,
    overloads: [params],
    userDefined: fn,
  };
}
