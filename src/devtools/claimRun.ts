/**
 * One measure under one report-filter setup: analyzed exactly as the app does it, and turned into claims.
 * Pure (no Power BI): the live run (claimCheck.live.test.ts) asks Power BI; the normal tests compare the
 * claims with the ones Power BI has confirmed (claims.confirmed.json).
 */
import { bind } from '../engine/binder/binder';
import { claimsForStep, candidateColumns, type Claim } from '../engine/claims/claims';
import { analyzeContext } from '../engine/context/analyzer';
import type { ReportFilter } from '../engine/context/reportFilters';
import type { RowChoice, StepQueryOptions } from '../engine/context/stepQuery';
import { buildTimeline, type TimelineEntry } from '../engine/context/timeline';
import { splitMeasureDefinition } from '../engine/definition';
import { tokenize } from '../engine/lexer/lexer';
import { parse } from '../engine/parser/parser';
import { INITECH_MODEL } from '../samples/initechModel';

export interface MeasureRun {
  timeline: TimelineEntry[];
  options: StepQueryOptions;
  claims: () => Claim[];
}

export function runMeasure(definition: string, reportFilters: ReportFilter[], rows: Map<string, RowChoice> = new Map()): MeasureRun {
  const start = splitMeasureDefinition(definition).header?.expressionStart ?? 0;
  const { root } = parse(tokenize(definition, start).tokens);
  const binding = bind(root, { mode: 'convention', userChoices: {} });
  const analysis = analyzeContext(root, binding, definition, undefined, INITECH_MODEL);
  const timeline = buildTimeline(root, binding, analysis, definition);
  const options: StepQueryOptions = { root, binding, source: definition, reportFilters, rows, frameKey: 'root' };
  const columns = candidateColumns(root, reportFilters);
  return {
    timeline,
    options,
    claims: () => timeline.flatMap((entry) => claimsForStep(entry, options, analysis, columns, INITECH_MODEL)),
  };
}
