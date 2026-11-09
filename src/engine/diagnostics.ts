import type { Span } from './source';

/** A problem found in the input, tied to the exact text it concerns. */
export interface Diagnostic {
  severity: 'error' | 'warning';
  /** Stable machine-readable identifier, e.g. "unterminated-string". Tests assert on this. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  span: Span;
}
