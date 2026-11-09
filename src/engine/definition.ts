import type { Diagnostic } from './diagnostics';
import type { Span } from './source';

/**
 * How the input text should be interpreted.
 * - measure-definition: `Name = expression`, as shown in Power BI's formula bar.
 * - expression: the whole text is a DAX expression.
 */
export type InputMode = 'measure-definition' | 'expression';

export interface MeasureDefinitionHeader {
  /** The measure name exactly as written, trimmed. Plain text, never lexed as DAX. */
  name: string;
  nameSpan: Span;
  operator: '=' | ':=';
  operatorSpan: Span;
  /** Offset where the DAX expression begins (just after the operator). */
  expressionStart: number;
}

export interface SplitResult {
  /** Null when no valid header was found; see diagnostics. */
  header: MeasureDefinitionHeader | null;
  diagnostics: Diagnostic[];
}

/**
 * Separates `Name = expression` into the measure name and the expression.
 *
 * Rule: the header is the first non-blank line, and the name is everything
 * before the first `=` (or `:=`) on that line. A measure name is a label, not
 * DAX, so it may contain spaces and symbols such as | % ( ) '.
 *
 * Because an expression can itself contain `=`, this rule is only applied when
 * the user has chosen "Measure definition" input; it is never auto-detected.
 */
export function splitMeasureDefinition(source: string): SplitResult {
  // Find the first line that contains anything other than whitespace.
  let lineStart = 0;
  while (lineStart < source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') lineEnd++;
    if (source.slice(lineStart, lineEnd).trim() !== '') {
      return splitHeaderLine(source, lineStart, lineEnd);
    }
    lineStart = lineEnd + 1;
  }
  return {
    header: null,
    diagnostics: [
      {
        severity: 'error',
        code: 'missing-measure-header',
        message: 'The input is empty. Expected a measure definition such as "Total Sales = SUM(Sales[Amount])".',
        span: { start: 0, end: source.length },
      },
    ],
  };
}

function splitHeaderLine(source: string, lineStart: number, lineEnd: number): SplitResult {
  const line = source.slice(lineStart, lineEnd);
  const equalsIndex = line.indexOf('=');

  if (equalsIndex === -1) {
    const firstChar = line.search(/\S/);
    return {
      header: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'missing-measure-header',
          message:
            'Expected "Name = expression" on the first line. If you pasted only an expression, choose "Expression only" as the input type.',
          span: { start: lineStart + firstChar, end: lineEnd },
        },
      ],
    };
  }

  const isColonEquals = equalsIndex > 0 && line[equalsIndex - 1] === ':';
  const operatorStart = lineStart + (isColonEquals ? equalsIndex - 1 : equalsIndex);
  const operatorEnd = lineStart + equalsIndex + 1;

  const rawName = source.slice(lineStart, operatorStart);
  const leading = rawName.length - rawName.trimStart().length;
  const name = rawName.trim();
  const nameSpan = { start: lineStart + leading, end: lineStart + leading + name.length };
  const operatorSpan = { start: operatorStart, end: operatorEnd };
  const diagnostics: Diagnostic[] = [];

  if (name === '') {
    diagnostics.push({
      severity: 'error',
      code: 'empty-measure-name',
      message: 'The measure name before "=" is empty.',
      span: operatorSpan,
    });
    return { header: null, diagnostics };
  }

  // A name that starts like DAX code suggests the user pasted an expression, not a definition.
  // This is a hint only: the split still happens as the user requested.
  if (/^[[\]'"]/.test(name)) {
    diagnostics.push({
      severity: 'warning',
      code: 'suspicious-measure-name',
      message: `The measure name "${name}" starts like DAX code. If you pasted only an expression, choose "Expression only" as the input type.`,
      span: nameSpan,
    });
  }

  return {
    header: { name, nameSpan, operator: isColonEquals ? ':=' : '=', operatorSpan, expressionStart: operatorEnd },
    diagnostics,
  };
}
