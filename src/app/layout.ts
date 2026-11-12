import { usePersistentState } from './usePersistentState';

/**
 * The workspace's adjustable layout, like Power BI's panes: sizes set by dragging the borders, and
 * sections collapsed to a strip. Remembered in this browser only.
 */
export interface Layout {
  /** The code pane's width, in pixels. */
  left: number;
  leftOpen: boolean;
  /** The code's share of the code pane's height (the story so far gets the rest), 0.15–0.85. */
  code: number;
  codeOpen: boolean;
  storyOpen: boolean;
  /** The Step tab's columns (This step, Filters, Technical + Variables), as shares that add up to 100. */
  cols: [number, number, number];
  colsOpen: [boolean, boolean, boolean];
  technicalOpen: boolean;
  variablesOpen: boolean;
}

export const DEFAULT_LAYOUT: Layout = {
  left: 432,
  leftOpen: true,
  code: 0.55,
  codeOpen: true,
  storyOpen: true,
  cols: [36, 33, 31],
  colsOpen: [true, true, true],
  technicalOpen: true,
  variablesOpen: true,
};

export const LEFT_MIN = 260;
export const LEFT_MAX = 900;
export const COL_MIN = 15;

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isLayout(value: unknown): value is Layout {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNum(v.left) &&
    isBool(v.leftOpen) &&
    isNum(v.code) &&
    isBool(v.codeOpen) &&
    isBool(v.storyOpen) &&
    Array.isArray(v.cols) &&
    v.cols.length === 3 &&
    v.cols.every(isNum) &&
    Array.isArray(v.colsOpen) &&
    v.colsOpen.length === 3 &&
    v.colsOpen.every(isBool) &&
    isBool(v.technicalOpen) &&
    isBool(v.variablesOpen)
  );
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Moves the border between two columns by `delta` (in shares of 100), keeping both at least COL_MIN. */
export function moveBorder(cols: readonly [number, number, number], left: number, delta: number): [number, number, number] {
  const next = [...cols] as [number, number, number];
  const right = left + 1;
  const d = clamp(delta, COL_MIN - next[left], next[right] - COL_MIN);
  next[left] += d;
  next[right] -= d;
  return next;
}

export function useLayout() {
  const [layout, setLayout] = usePersistentState<Layout>('dax-explorer-layout', DEFAULT_LAYOUT, isLayout);
  const update = (change: Partial<Layout> | ((current: Layout) => Partial<Layout>)) =>
    setLayout((current) => ({ ...current, ...(typeof change === 'function' ? change(current) : change) }));
  return { layout, update, reset: () => setLayout(DEFAULT_LAYOUT) };
}
