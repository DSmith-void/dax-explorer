/**
 * Stepping into measures: each measure in the chain of calls is a "frame" with its own code, analysis
 * and timeline. Expanded measures are spliced into one flat timeline, right after the step that calls
 * them, so Previous and Next walk in and out like a debugger.
 */
import { bind, type BindOptions, type BindResult } from '../engine/binder/binder';
import { analyzeContext } from '../engine/context/analyzer';
import type { ContextAnalysis, EvalContext } from '../engine/context/model';
import type { RelationshipModel } from '../engine/context/relationships';
import type { CallerFrame } from '../engine/context/stepQuery';
import { buildTimeline, type TimelineEntry } from '../engine/context/timeline';
import { childrenOf, findNode, type AstNode } from '../engine/parser/ast';
import { analyze, type AnalysisResult } from './analysis';
import { measureDefinitionText } from './modelConversion';

export interface Frame {
  /** '' for the measure being explained; otherwise the caller's key + '/' + the calling node's id. */
  key: string;
  /** The measure's name as written in DAX, e.g. "[Total Sales]", or "this expression" without a name. */
  name: string;
  result: AnalysisResult;
  binding: BindResult | null;
  analysis: ContextAnalysis | null;
  /** This measure's own steps. */
  timeline: TimelineEntry[];
  caller: { frame: Frame; callNodeId: number } | null;
  /** 0 for the measure being explained, 1 for a measure it calls, and so on. */
  level: number;
}

/** A step of the flat timeline: `index` is its place in the flat timeline, `localIndex` in its own measure's. */
export interface FlatEntry extends TimelineEntry {
  frame: Frame;
  localIndex: number;
}

/** How to bind and analyze each measure: the binder's settings, plus the model's relationships when known. */
export type FrameOptions = BindOptions & { relationships?: RelationshipModel | null };

export interface MeasureDefinition {
  name: string;
  expression: string;
}

/** How deep measures can be stepped into (a safety net; real models rarely go past a few levels). */
export const MAX_LEVEL = 8;

export const frameName = (result: AnalysisResult) => (result.header ? `[${result.header.name}]` : 'this expression');

/** The filters a measure's code starts with when called from `callNodeId`: the caller's, after context transition. */
function callerContext(frame: Frame, callNodeId: number): EvalContext | null {
  const step = frame.analysis?.steps.get(callNodeId);
  if (!step) return null;
  // Inside a measure, the caller's rows can't be read any more: context transition turned them into filters.
  return { ...(step.innerContext ?? step.context), rows: [] };
}

export function buildFrame(result: AnalysisResult, bindOptions: FrameOptions, caller: Frame['caller'] = null): Frame {
  const root = result.parse?.root ?? null;
  const binding = root ? bind(root, bindOptions) : null;
  const name = frameName(result);
  const start = caller ? callerContext(caller.frame, caller.callNodeId) : null;
  const analysis = root && binding ? analyzeContext(root, binding, result.text, start ?? undefined, bindOptions.relationships ?? null) : null;
  const timeline =
    root && binding && analysis
      ? buildTimeline(root, binding, analysis, result.text, caller && start ? { measure: name, caller: caller.frame.name, context: start } : undefined)
      : [];
  return { key: caller ? `${caller.frame.key}/${caller.callNodeId}` : '', name, result, binding, analysis, timeline, caller, level: caller ? caller.frame.level + 1 : 0 };
}

/** The measure called at a step (its name as written), or null when the step isn't a measure call. */
export function calledMeasureName(frame: Frame, entry: TimelineEntry): string | null {
  if (entry.kind !== 'measure' || entry.nodeId === null) return null;
  const node = findNode(frame.result.parse?.root ?? null, entry.nodeId);
  if (node?.kind === 'BracketRef') return node.name;
  if (node?.kind === 'ColumnRef') return node.column;
  return null;
}

export type StepInto =
  | { kind: 'available'; key: string; definition: MeasureDefinition }
  /** It can't be stepped into, and why (in plain words). */
  | { kind: 'unavailable'; name: string; reason: string };

/**
 * Whether the measure called at this step can be stepped into. Its definition comes from the connected
 * model (through the binding), or else from `lookup` (the built-in examples' measures).
 */
export function stepIntoTarget(frame: Frame, entry: TimelineEntry, lookup: (name: string) => MeasureDefinition | undefined): StepInto | null {
  const name = calledMeasureName(frame, entry);
  if (name === null || entry.nodeId === null) return null;
  const fromModel = frame.binding?.references.get(entry.nodeId)?.definition;
  const definition = fromModel ? { name: fromModel.name, expression: fromModel.expression } : lookup(name);
  if (!definition) {
    return { kind: 'unavailable', name, reason: `The code of [${name}] isn't known here. Connect to a report that has it to step into it.` };
  }
  for (let f: Frame | null = frame; f; f = f.caller?.frame ?? null) {
    if (f.result.header?.name.toLowerCase() === definition.name.toLowerCase()) {
      return { kind: 'unavailable', name, reason: `[${name}] is already being calculated further out, so stepping into it would go round in a circle.` };
    }
  }
  if (frame.level + 1 >= MAX_LEVEL) {
    return { kind: 'unavailable', name, reason: `Measures can be stepped into up to ${MAX_LEVEL} levels deep.` };
  }
  return { kind: 'available', key: `${frame.key}/${entry.nodeId}`, definition };
}

/**
 * The flat timeline: the measure's steps, with each expanded measure's steps right after the step that
 * calls it (from "Enter [Measure]" to "Back in [Caller]").
 */
export function flattenTimeline(
  root: Frame,
  expanded: ReadonlySet<string>,
  lookup: (name: string) => MeasureDefinition | undefined,
  bindOptions: FrameOptions,
): FlatEntry[] {
  const flat: FlatEntry[] = [];
  const visit = (frame: Frame, depthOffset: number) => {
    for (const entry of frame.timeline) {
      flat.push({ ...entry, index: flat.length, localIndex: entry.index, depth: entry.depth + depthOffset, frame });
      if (!expanded.has(`${frame.key}/${entry.nodeId}`)) continue;
      const target = stepIntoTarget(frame, entry, lookup);
      if (target?.kind !== 'available' || entry.nodeId === null) continue;
      const child = buildFrame(analyze(measureDefinitionText(target.definition.name, target.definition.expression), 'measure-definition'), bindOptions, {
        frame,
        callNodeId: entry.nodeId,
      });
      visit(child, entry.depth + depthOffset + 1);
    }
  };
  visit(root, 0);
  return flat;
}

/** The measures that call `frame`'s measure, innermost first, as the value queries need them. */
export function callersOf(frame: Frame): CallerFrame[] {
  const callers: CallerFrame[] = [];
  for (let f = frame; f.caller; f = f.caller.frame) {
    const { frame: c, callNodeId } = f.caller;
    const root = c.result.parse?.root;
    if (!root || !c.binding) break;
    callers.push({ key: c.key, root, binding: c.binding, source: c.result.text, callNodeId });
  }
  return callers;
}

/** The tables a measure's code names (Table[Column] and table references), in order of appearance. */
export function frameTables(frame: Frame): string[] {
  const tables: string[] = [];
  const visit = (node: AstNode) => {
    const name = node.kind === 'ColumnRef' ? node.table : node.kind === 'TableRef' ? node.name : '';
    if (name && !tables.some((t) => t.toLowerCase() === name.toLowerCase())) tables.push(name);
    for (const child of childrenOf(node)) visit(child.node);
  };
  const root = frame.result.parse?.root;
  if (root) visit(root);
  return tables;
}

/** The frames from the measure being explained down to `frame`, for the breadcrumb. */
export function framePath(frame: Frame): Frame[] {
  const path: Frame[] = [];
  for (let f: Frame | null = frame; f; f = f.caller?.frame ?? null) path.unshift(f);
  return path;
}

/** The tint of a measure stepped into (1, 2, 3, then repeating); 0 for the measure being explained. */
export const frameTint = (level: number) => (level === 0 ? 0 : ((level - 1) % 3) + 1);
