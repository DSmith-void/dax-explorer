/**
 * One measure under one report-filter setup: analyzed exactly as the app does it, and turned into claims.
 * Pure (no Power BI): the live runs (claimCheck.live.test.ts, modelCheck.live.test.ts) ask Power BI; the normal
 * tests compare the Initech claims with the ones Power BI has confirmed (claims.confirmed.json).
 */
import { bind } from '../engine/binder/binder';
import { claimsForStep, candidateColumns, type Claim } from '../engine/claims/claims';
import { analyzeContext } from '../engine/context/analyzer';
import type { ContextAnalysis } from '../engine/context/model';
import type { ReportFilter } from '../engine/context/reportFilters';
import type { RelationshipModel } from '../engine/context/relationships';
import type { RowChoice, StepQueryOptions } from '../engine/context/stepQuery';
import { buildTimeline, type TimelineEntry } from '../engine/context/timeline';
import { splitMeasureDefinition } from '../engine/definition';
import { tokenize } from '../engine/lexer/lexer';
import type { ModelIndex } from '../engine/model';
import { parse } from '../engine/parser/parser';
import { INITECH_MODEL } from '../samples/initechModel';

export interface MeasureRun {
  timeline: TimelineEntry[];
  analysis: ContextAnalysis;
  options: StepQueryOptions;
  claims: () => Claim[];
}

/**
 * The model the measure is analyzed against: a connected model's names and relationships, as the app uses them.
 * Without one, Initech's relationships, with names told apart by convention (the claim library is written so).
 */
export interface RunModel {
  index: ModelIndex;
  relationships: RelationshipModel;
}

export function runMeasure(definition: string, reportFilters: ReportFilter[], rows: Map<string, RowChoice> = new Map(), model?: RunModel): MeasureRun {
  const start = splitMeasureDefinition(definition).header?.expressionStart ?? 0;
  const { root } = parse(tokenize(definition, start).tokens);
  const relationships = model?.relationships ?? INITECH_MODEL;
  const binding = bind(root, { mode: 'convention', userChoices: {}, ...(model ? { model: model.index } : {}) });
  const analysis = analyzeContext(root, binding, definition, undefined, relationships);
  const timeline = buildTimeline(root, binding, analysis, definition);
  const options: StepQueryOptions = { root, binding, source: definition, reportFilters, rows, frameKey: 'root' };
  const columns = candidateColumns(root, reportFilters, binding);
  return {
    timeline,
    analysis,
    options,
    claims: () => timeline.flatMap((entry) => claimsForStep(entry, options, analysis, columns, relationships)),
  };
}
