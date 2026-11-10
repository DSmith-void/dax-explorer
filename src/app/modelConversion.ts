import type { ModelSnapshot } from '../engine/model';
import type { ModelMetadata } from './helperClient';

/** The helper's model description → what the engine needs. */
export function toModelSnapshot(model: ModelMetadata): ModelSnapshot {
  return {
    tables: model.tables.map((t) => t.name),
    columns: model.columns.map((c) => ({ table: c.table, name: c.name })),
    measures: model.measures.map((m) => ({ table: m.table, name: m.name, expression: m.expression })),
  };
}

/** "Total Sales =\nSUM(Sales[Amount])": the form the editor's "Measure definition" input expects. */
export function measureDefinitionText(name: string, expression: string): string {
  return `${name} =\n${expression.trim()}`;
}
