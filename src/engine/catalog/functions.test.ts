import { describe, expect, it } from 'vitest';
import { bind } from '../binder/binder';
import { analyzeContext } from '../context/analyzer';
import { buildTimeline } from '../context/timeline';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { NOT_IN_CATALOG, REFERENCE_FUNCTIONS } from './coverage';
import { arity, FUNCTION_CATALOG, lookupFunction, parametersForCall, type FunctionSpec } from './functions';
import { POWER_BI_ARITY } from './powerBiArity';

/** The smallest and largest number of inputs over all of a function's parameter lists. */
function range(spec: FunctionSpec): [number, number] {
  const ranges = spec.overloads.map(arity);
  return [Math.min(...ranges.map((r) => r.min)), Math.max(...ranges.map((r) => r.max))];
}

/**
 * TRUE, FALSE and NOT: Power BI reads them partly as keywords and an operator, so a call with 60 inputs is a
 * syntax error rather than "too many arguments", and the probe could not read a count for them.
 */
const NOT_PROBED_RELIABLY = new Set(['TRUE', 'FALSE', 'NOT', /* accepts and ignores any number of inputs */ 'USERNAME']);

/** What each of Power BI's input kinds may be in the catalog (see powerBiArity.ts for the letters). */
const ACCEPTED_ROLES: Record<string, string[]> = {
  C: ['column', 'tableOrColumn'],
  T: ['table', 'tableOrColumn'],
  // "a table reference expression": a table, or a column of one (ALL('Sales'[Amount]) is valid).
  R: ['table', 'tableOrColumn', 'column'],
  // "a column name": the name of a new column, written as text (or as a column).
  N: ['scalar', 'column'],
  // "a calendar reference": the dates input, which takes a date column or a calendar.
  K: ['column'],
};

describe('coverage of the DAX function list', () => {
  it('every function on the list is in the catalog or has a status, not both', () => {
    const missing = REFERENCE_FUNCTIONS.filter((name) => !lookupFunction(name) && !NOT_IN_CATALOG.has(name));
    const both = REFERENCE_FUNCTIONS.filter((name) => lookupFunction(name) && NOT_IN_CATALOG.has(name));
    expect({ missing, both }).toEqual({ missing: [], both: [] });
  });

  it('every status is about a function on the list', () => {
    expect([...NOT_IN_CATALOG.keys()].filter((name) => !REFERENCE_FUNCTIONS.includes(name))).toEqual([]);
  });

  it('covers the INFO functions with one shared entry', () => {
    expect(lookupFunction('INFO.VIEW.MEASURES')?.returns).toBe('table');
    expect(lookupFunction('info.tables')?.name).toBe('INFO.TABLES');
  });
});

describe('the catalog matches what Power BI Desktop says', () => {
  const checked = FUNCTION_CATALOG.filter((spec) => POWER_BI_ARITY[spec.name] && !NOT_PROBED_RELIABLY.has(spec.name));

  it('has Power BI data for nearly every catalog entry', () => {
    expect(checked.length).toBeGreaterThan(300);
  });

  it.each(checked.map((spec) => [spec.name, spec] as const))('%s takes as many inputs as Power BI allows', (name, spec) => {
    const [min, max] = POWER_BI_ARITY[name];
    expect(range(spec)).toEqual([min, max]);
  });

  it.each(checked.map((spec) => [spec.name, spec] as const))('%s asks for a column or table where Power BI does', (name, spec) => {
    const roles = POWER_BI_ARITY[name][2];
    const params = parametersForCall(spec, roles.length);
    [...roles].forEach((role, i) => {
      if (role === 's' || !params) return;
      expect({ position: i + 1, role: params[i].role }).toEqual({ position: i + 1, role: expect.toBeOneOf(ACCEPTED_ROLES[role]) });
    });
  });
});

describe('every catalog function can be explained', () => {
  /** A call with the fewest inputs, each a value of the kind the function expects, on the Initech model. */
  function sampleCall(spec: FunctionSpec): string {
    const params = parametersForCall(spec, range(spec)[0]) ?? [];
    const args = params.map((param) => {
      switch (param.role) {
        case 'column':
          return "'Sales'[Amount]";
        case 'table':
        case 'tableOrColumn':
          return "'Sales'";
        case 'rowExpression':
          return "'Sales'[Amount]";
        case 'keyword':
          return param.keywords![0];
        case 'filter':
          return "'Sales'[Amount] > 1";
        default:
          return '1';
      }
    });
    return `${spec.name}(${args.join(', ')})`;
  }

  it.each(FUNCTION_CATALOG.map((spec) => [spec.name, sampleCall(spec)] as const))('%s: %s', (_, call) => {
    const { root, diagnostics } = parse(tokenize(call).tokens);
    expect(diagnostics).toEqual([]);
    const binding = bind(root, { mode: 'convention', userChoices: {} });
    expect(binding.diagnostics.filter((d) => d.code === 'argument-count')).toEqual([]);
    expect(binding.unknownFunctions).toEqual([]);
    const analysis = analyzeContext(root, binding, call);
    expect(analysis.insights.filter((i) => i.kind === 'unknown-function')).toEqual([]);
    expect(buildTimeline(root, binding, analysis, call).filter((e) => e.kind === 'unknown')).toEqual([]);
  });
});
