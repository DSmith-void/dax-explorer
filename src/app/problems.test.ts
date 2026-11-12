import { describe, expect, it } from 'vitest';
import { bind } from '../engine/binder/binder';
import { analyzeContext } from '../engine/context/analyzer';
import { analyze } from './analysis';
import { listProblems, problemCount } from './problems';

function problems(text: string) {
  const result = analyze(text, 'measure-definition');
  const root = result.parse?.root ?? null;
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  const analysis = analyzeContext(root, binding, result.text);
  return listProblems(result, binding, analysis);
}

describe('listProblems', () => {
  it('a clean measure has only names assumed from how they are written, which do not count', () => {
    const list = problems('M = [Total Sales] * 2');
    expect(list).toEqual([{ kind: 'assumed', title: '[Total Sales] is taken to be a measure, from how it is written.', line: 1, nodeId: expect.any(Number) }]);
    expect(problemCount(list)).toBe(0);
  });

  it('syntax errors first, then a column with no current row, then what the app cannot check', () => {
    const list = problems('M = Sales[Amount] * 2 + MYHELPER(1');
    expect(list.map((p) => p.kind)).toEqual(expect.arrayContaining(['error']));
    expect(list[0].kind).toBe('error');
    const warning = problems('M = Sales[Amount] * 2');
    expect(warning.map((p) => `${p.kind}: ${p.title}`)).toContain('warning: Sales[Amount] has no current row to read from (an error in a measure).');
    const unknown = problems('M = MYHELPER(1)');
    expect(unknown.map((p) => `${p.kind}: ${p.title}`)).toContain("unchecked: The app doesn't know MYHELPER yet, so the parts inside it aren't checked.");
  });

  it('a name used several times is listed once', () => {
    expect(problems('M = [Total Sales] + [Total Sales]').filter((p) => p.kind === 'assumed')).toHaveLength(1);
  });
});
