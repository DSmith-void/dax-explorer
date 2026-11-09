/**
 * Source-text positions shared by every engine stage.
 *
 * Offsets are 0-based indexes into the JavaScript string (UTF-16 code units).
 * Spans are half-open: `start` is included, `end` is not, so
 * `source.slice(span.start, span.end)` is exactly the covered text.
 */
export interface Span {
  start: number;
  end: number;
}

/** Human-readable position: 1-based line and column. */
export interface Position {
  line: number;
  column: number;
}

/**
 * Builds a function that converts offsets to line/column positions.
 * Line breaks may be \n, \r\n, or a lone \r.
 */
export function createLineMap(source: string): (offset: number) => Position {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') {
      lineStarts.push(i + 1);
    } else if (ch === '\r' && source[i + 1] !== '\n') {
      lineStarts.push(i + 1);
    }
  }

  return (offset: number): Position => {
    // Binary search for the last line start <= offset.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };
}
