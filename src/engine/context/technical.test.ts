import { describe, expect, it } from 'vitest';
import { bind } from '../binder/binder';
import { splitMeasureDefinition } from '../definition';
import { tokenize } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { analyzeContext } from './analyzer';
import { INITIAL_CONTEXT } from './model';
import { technicalContext, technicalOperation } from './technical';
import { buildTimeline } from './timeline';

function timeline(definition: string) {
  const { root } = parse(tokenize(definition, splitMeasureDefinition(definition).header!.expressionStart).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  return buildTimeline(root, binding, analyzeContext(root, binding, definition), definition);
}

describe('technical wording', () => {
  it('the report filters alone are F, with no row context', () => {
    expect(technicalContext(INITIAL_CONTEXT)).toEqual({ filter: ['F'], rows: [] });
  });

  it('CALCULATE: removals, overwrite and KEEPFILTERS, in DAX terms', () => {
    const steps = timeline(`M = CALCULATE([Total Sales], REMOVEFILTERS(Product[Category]), Plant[Plant Name] = "Austin", KEEPFILTERS(Product[Color] = "Red"))`);
    const calculate = steps.find((e) => e.kind === 'calculate')!;
    expect(technicalContext(calculate.innerContext!).filter).toEqual([
      'F − filters on Product[Category], Plant[Plant Name]',
      'Plant[Plant Name] = "Austin"  [CALCULATE, overwrite]',
      'Product[Color] = "Red"  [CALCULATE, KEEPFILTERS (intersect)]',
    ]);
    expect(calculate.operations.map(technicalOperation)).toEqual([
      'REMOVEFILTERS: removes filters on Product[Category]',
      'Filter Plant[Plant Name] = "Austin": overwrites existing filters on the same columns',
      'Filter Product[Color] = "Red": KEEPFILTERS, intersected with the existing filters',
    ]);
  });

  it('an iterator and a measure inside it: row context, then context transition', () => {
    const steps = timeline('M = SUMX(VALUES(Plant[Plant Name]), [Total Sales])');
    const measure = steps.find((e) => e.kind === 'measure')!;
    expect(technicalContext(measure.context).rows).toEqual(['VALUES(Plant[Plant Name])  [SUMX]']);
    expect(measure.operations.map(technicalOperation)).toEqual(['Context transition: the row context of SUMX becomes filter context (Plant[Plant Name])']);
    expect(technicalContext(measure.innerContext!).filter).toEqual(['F − filters on Plant[Plant Name]', "Plant[Plant Name] = the current row's value  [context transition from SUMX]"]);
  });
});
