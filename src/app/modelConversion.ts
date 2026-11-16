import { relationshipFromInfo, type RelationshipModel } from '../engine/context/relationships';
import type { ModelSnapshot } from '../engine/model';
import type { ModelMetadata } from './helperClient';

/** The helper's model description → what the engine needs. */
export function toModelSnapshot(model: ModelMetadata): ModelSnapshot {
  return {
    tables: model.tables.map((t) => t.name),
    columns: model.columns.map((c) => ({ table: c.table, name: c.name })),
    measures: model.measures.map((m) => ({ table: m.table, name: m.name, expression: m.expression })),
    calendars: (model.calendars ?? []).map((c) => c.name),
  };
}

/** "Total Sales =\nSUM(Sales[Amount])": the form the editor's "Measure definition" input expects. */
export function measureDefinitionText(name: string, expression: string): string {
  return `${name} =\n${expression.trim()}`;
}

/** The helper's model description → the relationships, date columns, calendars and calculation groups the engine uses. */
export function toRelationshipModel(model: ModelMetadata): RelationshipModel {
  return {
    source: 'report',
    // Power BI's automatic date tables (one hidden table per date column) are left out of the drawing.
    tables: model.tables.filter((t) => !/^(LocalDateTable|DateTableTemplate)_/.test(t.name)).map((t) => t.name),
    relationships: model.relationships.map(relationshipFromInfo),
    dateColumns: model.columns.filter((c) => /^date/i.test(c.dataType)).map((c) => ({ table: c.table, column: c.name })),
    dateTables: model.tables.filter((t) => t.dataCategory?.toLowerCase() === 'time').map((t) => t.name),
    sortBy: model.columns.flatMap((c) => (c.sortByColumn ? [{ column: { table: c.table, column: c.name }, by: { table: c.table, column: c.sortByColumn } }] : [])),
    calendars: (model.calendars ?? []).map((c) => ({
      name: c.name,
      table: c.table,
      groups: c.groups.map((g) => ({ unit: g.unit, primary: g.primaryColumn, associated: g.associatedColumns })),
    })),
    calculationGroups: (model.calculationGroups ?? []).map((g) => ({ table: g.table, items: g.items.map((i) => i.name) })),
  };
}
