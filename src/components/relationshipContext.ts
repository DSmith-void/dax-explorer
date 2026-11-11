import { createContext, useContext, useMemo } from 'react';
import type { EvalContext } from '../engine/context/model';
import { filterReach, type FilterReach, type RelationshipModel } from '../engine/context/relationships';
import { reportFilterColumns, reportFilterStatus, reportFilterText } from '../engine/context/reportFilters';
import { useReportFilters } from './reportFiltersContext';

/**
 * The relationships between the model's tables, when known (a connected report, or the built-in example
 * model for the built-in examples); null otherwise. Provided once by the app for every filter view.
 */
export const RelationshipContext = createContext<RelationshipModel | null>(null);

export function useRelationships(): RelationshipModel | null {
  return useContext(RelationshipContext);
}

/** Where the filters in `context` (with the report's filters still in effect) reach; null without relationships. */
export function useFilterReach(context: EvalContext | null | undefined): { model: RelationshipModel; reach: FilterReach } | null {
  const model = useRelationships();
  const reportFilters = useReportFilters();
  return useMemo(() => {
    if (!model || !context) return null;
    const seeds = reportFilters.map((f) => ({
      columns: reportFilterColumns(f),
      text: reportFilterText(f),
      applies: reportFilterStatus(f, context.filter.removals, model) === 'applies',
    }));
    return { model, reach: filterReach(context, seeds, model) };
  }, [model, reportFilters, context]);
}
