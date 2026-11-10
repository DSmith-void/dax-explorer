import { createContext, useContext } from 'react';
import type { ReportFilter } from '../engine/context/reportFilters';

/**
 * The report filters chosen to stand in for "F" (empty until the user picks some). Provided once by the
 * app so every filter view can show them without passing them through each panel.
 */
export const ReportFiltersContext = createContext<readonly ReportFilter[]>([]);

export function useReportFilters(): readonly ReportFilter[] {
  return useContext(ReportFiltersContext);
}
