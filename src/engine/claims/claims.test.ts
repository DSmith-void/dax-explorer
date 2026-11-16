import { describe, expect, it } from 'vitest';
import { bind } from '../binder/binder';
import { tokenize } from '../lexer/lexer';
import { createModelIndex } from '../model';
import { parse } from '../parser/parser';
import { candidateColumns } from './claims';

describe('candidateColumns', () => {
  it('leaves out a measure written with its table name (Table[Measure], which DAX allows)', () => {
    const source = 'CALCULATE(Sales[Total Sales], Sales[Ship Date] = DATE(2024, 1, 1))';
    const { root } = parse(tokenize(source).tokens);
    const model = createModelIndex({
      tables: ['Sales'],
      columns: [{ table: 'Sales', name: 'Ship Date' }],
      measures: [{ table: 'Sales', name: 'Total Sales', expression: 'SUM(Sales[Amount])' }],
    });
    const binding = bind(root, { mode: 'convention', userChoices: {}, model });
    expect(candidateColumns(root, [], binding)).toEqual([{ table: 'Sales', column: 'Ship Date' }]);
    // Without a binding, every Table[Name] is taken as a column.
    expect(candidateColumns(root, [])).toHaveLength(2);
  });
});
