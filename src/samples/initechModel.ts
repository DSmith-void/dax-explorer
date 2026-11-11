import type { RelationshipModel } from '../engine/context/relationships';

/**
 * The relationships of the made-up Initech sample report (samples/Initech), so the built-in examples can
 * show how filters spread between tables without a connected report. Keep in step with
 * samples/Initech/Initech.SemanticModel/definition/relationships.tmdl.
 */
export const INITECH_MODEL: RelationshipModel = {
  source: 'example',
  tables: ['Sales', 'Product', 'Customer', 'Plant', 'Date'],
  relationships: [
    { fromTable: 'Sales', fromColumn: 'Date', toTable: 'Date', toColumn: 'Date', fromMany: true, toMany: false, active: true, bothDirections: false },
    { fromTable: 'Sales', fromColumn: 'Product Key', toTable: 'Product', toColumn: 'Product Key', fromMany: true, toMany: false, active: true, bothDirections: false },
    { fromTable: 'Sales', fromColumn: 'Customer Key', toTable: 'Customer', toColumn: 'Customer Key', fromMany: true, toMany: false, active: true, bothDirections: false },
    { fromTable: 'Sales', fromColumn: 'Plant Key', toTable: 'Plant', toColumn: 'Plant Key', fromMany: true, toMany: false, active: true, bothDirections: false },
  ],
};
