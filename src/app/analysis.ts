import { tokenize } from '../engine/lexer/lexer';
import type { LexResult } from '../engine/lexer/tokens';

/**
 * Everything produced by one press of "Analyze DAX".
 * Milestone 2: tokenization only. Later milestones add the parse tree and analysis.
 */
export interface AnalysisResult {
  text: string;
  characterCount: number;
  lineCount: number;
  lex: LexResult;
}

export function analyze(text: string): AnalysisResult {
  return {
    text,
    characterCount: text.length,
    lineCount: text.split(/\r\n|\r|\n/).length,
    lex: tokenize(text),
  };
}
