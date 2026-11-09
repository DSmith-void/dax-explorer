import type { MeasureDefinitionHeader, InputMode } from '../engine/definition';
import { splitMeasureDefinition } from '../engine/definition';
import type { Diagnostic } from '../engine/diagnostics';
import { tokenize } from '../engine/lexer/lexer';
import type { LexResult } from '../engine/lexer/tokens';
import type { ParseResult } from '../engine/parser/ast';
import { parse } from '../engine/parser/parser';

/**
 * Everything produced by one press of "Analyze DAX".
 * Milestone 3: header split, tokenization and parsing. Semantic analysis comes later.
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
  /** Null when parsing was not attempted. */
  parse: ParseResult | null;
  /** All problems from every stage, in source order. */
  diagnostics: Diagnostic[];
}

function bySourceOrder(a: Diagnostic, b: Diagnostic) {
  return a.span.start - b.span.start;
}

export function analyze(text: string, mode: InputMode): AnalysisResult {
  const base = {
    text,
    mode,
    characterCount: text.length,
    lineCount: text.split(/\r\n|\r|\n/).length,
  };

  let header: MeasureDefinitionHeader | null = null;
  const diagnostics: Diagnostic[] = [];
  let expressionStart = 0;

  if (mode === 'measure-definition') {
    const split = splitMeasureDefinition(text);
    diagnostics.push(...split.diagnostics);
    if (!split.header) {
      // Without a header we don't know where the expression starts, so we stop here
      // rather than lexing the name as if it were DAX.
      return { ...base, header: null, lex: null, parse: null, diagnostics };
    }
    header = split.header;
    expressionStart = header.expressionStart;
  }

  const lex = tokenize(text, expressionStart);
  const parseResult = parse(lex.tokens);
  diagnostics.push(...lex.diagnostics, ...parseResult.diagnostics);
  return { ...base, header, lex, parse: parseResult, diagnostics: diagnostics.sort(bySourceOrder) };
}
