import type { MeasureDefinitionHeader, InputMode } from '../engine/definition';
import { splitMeasureDefinition } from '../engine/definition';
import type { Diagnostic } from '../engine/diagnostics';
import { tokenize } from '../engine/lexer/lexer';
import type { LexResult } from '../engine/lexer/tokens';

/**
 * Everything produced by one press of "Analyze DAX".
 * Milestone 2: header split + tokenization. Later milestones add the parse tree and analysis.
 */
export interface AnalysisResult {
  text: string;
  mode: InputMode;
  characterCount: number;
  lineCount: number;
  /** Present in measure-definition mode when the header was found. */
  header: MeasureDefinitionHeader | null;
  /** Null when lexing was not attempted (e.g. the measure header is missing). */
  lex: LexResult | null;
  /** All problems from every stage, in source order. */
  diagnostics: Diagnostic[];
}

export function analyze(text: string, mode: InputMode): AnalysisResult {
  const base = {
    text,
    mode,
    characterCount: text.length,
    lineCount: text.split(/\r\n|\r|\n/).length,
  };

  if (mode === 'expression') {
    const lex = tokenize(text);
    return { ...base, header: null, lex, diagnostics: lex.diagnostics };
  }

  const split = splitMeasureDefinition(text);
  if (!split.header) {
    // Without a header we don't know where the expression starts, so we don't lex at all
    // rather than lexing the name as if it were DAX.
    return { ...base, header: null, lex: null, diagnostics: split.diagnostics };
  }

  const lex = tokenize(text, split.header.expressionStart);
  const diagnostics = [...split.diagnostics, ...lex.diagnostics].sort((a, b) => a.span.start - b.span.start);
  return { ...base, header: split.header, lex, diagnostics };
}
