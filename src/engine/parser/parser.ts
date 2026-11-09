import type { Diagnostic } from '../diagnostics';
import type { Token } from '../lexer/tokens';
import type { Span } from '../source';
import type {
  BinaryOperator,
  Expr,
  FunctionCall,
  ParseResult,
  TableConstructor,
  VarBlock,
  VarDeclaration,
} from './ast';

/**
 * Binding strength of each binary operator (higher binds tighter), following
 * the DAX operator-precedence table. Operators of equal strength associate
 * left to right, as documented for DAX.
 *
 *   ||  <  &&  <  NOT  <  comparisons, IN  <  &  <  + -  <  * /  <  unary sign  <  ^
 */
const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  '||': 1,
  '&&': 2,
  // 3 is NOT (prefix), see parsePrefix
  '=': 4,
  '==': 4,
  '<>': 4,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  IN: 4,
  '&': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  // 8 is unary + and -, see parsePrefix
  '^': 9,
};

/** NOT applies to a whole comparison: NOT a = b means NOT (a = b). */
const NOT_OPERAND_PRECEDENCE = 4;
/** Unary minus binds tighter than * but looser than ^: -2^2 = -(2^2). */
const SIGN_OPERAND_PRECEDENCE = 9;

/** Tokens where error recovery may safely resume. */
function isSyncToken(token: Token): boolean {
  return (
    token.kind === 'EndOfInput' ||
    (token.kind === 'Punctuation' && (token.text === ',' || token.text === ')' || token.text === '}')) ||
    (token.kind === 'Keyword' && (token.value === 'RETURN' || token.value === 'VAR'))
  );
}

/**
 * Parses tokens (from `tokenize`) into an expression tree.
 *
 * Never throws. Problems become Diagnostics plus Error/Omitted nodes, and
 * parsing resumes at the next safe point so the rest of the tree is still built.
 * Errors already reported by the lexer (Error tokens) are not reported twice.
 */
export function parse(allTokens: readonly Token[]): ParseResult {
  const tokens = allTokens.filter((t) => t.kind !== 'Comment');
  const diagnostics: Diagnostic[] = [];
  let index = 0;
  let nextId = 1;
  /** Stack of VAR scopes; each maps upper-cased name -> declaration id. */
  const scopes: Map<string, number>[] = [];

  const peek = (offset = 0): Token => tokens[Math.min(index + offset, tokens.length - 1)];
  const advance = (): Token => {
    const token = peek();
    if (token.kind !== 'EndOfInput') index++;
    return token;
  };
  const isPunct = (token: Token, text: string) => token.kind === 'Punctuation' && token.text === text;
  const isKeyword = (token: Token, value: string) => token.kind === 'Keyword' && token.value === value;
  const id = () => nextId++;
  const spanFrom = (start: number, end: number): Span => ({ start, end });

  function error(code: string, message: string, span: Span) {
    diagnostics.push({ severity: 'error', code, message, span });
  }

  function describe(token: Token): string {
    return token.kind === 'EndOfInput' ? 'the end of the input' : `"${token.text}"`;
  }

  /** Previous consumed token's end, used to close spans. */
  function lastEnd(): number {
    return index > 0 ? tokens[index - 1].span.end : 0;
  }

  // ------------------------------------------------------------------
  // Expressions
  // ------------------------------------------------------------------

  function parseExpression(): Expr {
    return parseBinary(0);
  }

  function binaryOperatorAt(token: Token): BinaryOperator | null {
    if (token.kind === 'Operator' && token.text in BINARY_PRECEDENCE) return token.text as BinaryOperator;
    if (isKeyword(token, 'IN')) return 'IN';
    return null;
  }

  /** Precedence climbing: parse operators whose strength is at least minPrecedence. */
  function parseBinary(minPrecedence: number): Expr {
    let left = parsePrefix();
    for (;;) {
      const operator = binaryOperatorAt(peek());
      if (!operator) break;
      const precedence = BINARY_PRECEDENCE[operator];
      if (precedence < minPrecedence) break;
      advance();
      // +1 makes equal-precedence operators associate to the left.
      const right = parseBinary(precedence + 1);
      left = { kind: 'BinaryOp', id: id(), span: spanFrom(left.span.start, right.span.end), operator, left, right };
    }
    return left;
  }

  function parsePrefix(): Expr {
    const token = peek();
    if (isKeyword(token, 'NOT')) {
      advance();
      const operand = parseBinary(NOT_OPERAND_PRECEDENCE);
      return { kind: 'UnaryOp', id: id(), span: spanFrom(token.span.start, operand.span.end), operator: 'NOT', operand };
    }
    if (token.kind === 'Operator' && (token.text === '-' || token.text === '+')) {
      advance();
      const operand = parseBinary(SIGN_OPERAND_PRECEDENCE);
      return {
        kind: 'UnaryOp',
        id: id(),
        span: spanFrom(token.span.start, operand.span.end),
        operator: token.text,
        operand,
      };
    }
    return parsePrimary();
  }

  function parsePrimary(): Expr {
    const token = peek();
    const start = token.span.start;

    switch (token.kind) {
      case 'Number':
        advance();
        return { kind: 'NumberLiteral', id: id(), span: token.span, value: token.value };

      case 'String':
        advance();
        return { kind: 'StringLiteral', id: id(), span: token.span, value: token.value };

      case 'BracketedName':
        advance();
        return { kind: 'BracketRef', id: id(), span: token.span, name: token.value };

      case 'QuotedTableName': {
        advance();
        const column = peek();
        if (column.kind === 'BracketedName') {
          advance();
          return {
            kind: 'ColumnRef',
            id: id(),
            span: spanFrom(start, column.span.end),
            table: token.value,
            tableQuoted: true,
            column: column.value,
          };
        }
        return { kind: 'TableRef', id: id(), span: token.span, name: token.value, quoted: true };
      }

      case 'Identifier': {
        advance();
        const next = peek();
        if (isPunct(next, '(')) return parseCallArguments(token);
        if (next.kind === 'BracketedName') {
          advance();
          return {
            kind: 'ColumnRef',
            id: id(),
            span: spanFrom(start, next.span.end),
            table: token.text,
            tableQuoted: false,
            column: next.value,
          };
        }
        const upper = token.text.toUpperCase();
        const declarationId = lookupVariable(upper);
        if (declarationId !== undefined) {
          return { kind: 'VariableRef', id: id(), span: token.span, name: token.text, declarationId };
        }
        if (upper === 'TRUE' || upper === 'FALSE') {
          return { kind: 'BooleanLiteral', id: id(), span: token.span, value: upper === 'TRUE' };
        }
        return { kind: 'TableRef', id: id(), span: token.span, name: token.text, quoted: false };
      }

      case 'Keyword':
        if (token.value === 'VAR') return parseVarBlock();
        break;

      case 'Punctuation':
        if (token.text === '(') return parseParenthesized();
        if (token.text === '{') return parseTableConstructor();
        break;

      case 'Error':
        // The lexer already reported this; just represent it in the tree.
        advance();
        return { kind: 'Error', id: id(), span: token.span };

      default:
        break;
    }

    // Anything else cannot start an expression.
    if (isSyncToken(token)) {
      // Don't consume: the caller uses this token to recover (e.g. a closing parenthesis).
      // The zero-width placeholder sits right after the previous token so it stays inside its parent.
      error('expected-expression', `Expected an expression but found ${describe(token)}.`, token.span);
      const at = index > 0 ? lastEnd() : start;
      return { kind: 'Error', id: id(), span: spanFrom(at, at) };
    }
    advance();
    error('unexpected-token', `Unexpected ${describe(token)}: it cannot start an expression.`, token.span);
    return { kind: 'Error', id: id(), span: token.span };
  }

  /** After NAME has been consumed and "(" is next. */
  function parseCallArguments(nameToken: Token): FunctionCall {
    advance(); // (
    const args: Expr[] = [];
    let closed = false;

    if (isPunct(peek(), ')')) {
      advance();
      closed = true;
    } else {
      for (;;) {
        const token = peek();
        if (isPunct(token, ',') || isPunct(token, ')')) {
          // Skipped optional argument.
          args.push({ kind: 'Omitted', id: id(), span: spanFrom(token.span.start, token.span.start) });
        } else {
          args.push(parseExpression());
        }

        const after = peek();
        if (isPunct(after, ',')) {
          advance();
          continue;
        }
        if (isPunct(after, ')')) {
          advance();
          closed = true;
          break;
        }
        if (after.kind === 'EndOfInput') break;
        error(
          'expected-comma-or-paren',
          `Expected "," or ")" in the arguments of ${nameToken.text}, but found ${describe(after)}.`,
          after.span,
        );
        if (!skipToArgumentBoundary()) break;
        // Resume at the boundary we skipped to (consume it here so it isn't mistaken for a skipped argument).
        if (isPunct(advance(), ')')) {
          closed = true;
          break;
        }
      }
    }

    if (!closed) {
      error('expected-closing-paren', `Missing ")" to close ${nameToken.text}(.`, spanFrom(lastEnd(), lastEnd()));
    }
    return {
      kind: 'FunctionCall',
      id: id(),
      span: spanFrom(nameToken.span.start, lastEnd()),
      name: nameToken.text,
      nameSpan: nameToken.span,
      args,
    };
  }

  /**
   * Skips tokens until a "," or ")" at the current nesting level.
   * Leaves that token unconsumed. Returns false if the input ended first.
   */
  function skipToArgumentBoundary(): boolean {
    let depth = 0;
    for (;;) {
      const token = peek();
      if (token.kind === 'EndOfInput') return false;
      if (depth === 0 && (isPunct(token, ',') || isPunct(token, ')'))) return true;
      if (isPunct(token, '(') || isPunct(token, '{')) depth++;
      if ((isPunct(token, ')') || isPunct(token, '}')) && depth > 0) depth--;
      advance();
    }
  }

  /** "(" expr ")" or a tuple "(" expr, expr, ... ")". */
  function parseParenthesized(): Expr {
    const open = advance();
    const items: Expr[] = [parseExpression()];
    while (isPunct(peek(), ',')) {
      advance();
      items.push(parseExpression());
    }
    if (isPunct(peek(), ')')) {
      advance();
    } else {
      error('expected-closing-paren', `Expected ")" but found ${describe(peek())}.`, peek().span);
    }
    if (items.length === 1) {
      // Plain grouping: the inner expression is the node (parentheses only affect structure).
      return items[0];
    }
    return { kind: 'Tuple', id: id(), span: spanFrom(open.span.start, lastEnd()), items };
  }

  function parseTableConstructor(): TableConstructor {
    const open = advance();
    const items: Expr[] = [];
    if (!isPunct(peek(), '}')) {
      items.push(parseExpression());
      while (isPunct(peek(), ',')) {
        advance();
        items.push(parseExpression());
      }
    }
    if (isPunct(peek(), '}')) {
      advance();
    } else {
      error('expected-closing-brace', `Expected "}" to close the table constructor but found ${describe(peek())}.`, peek().span);
    }
    return { kind: 'TableConstructor', id: id(), span: spanFrom(open.span.start, lastEnd()), items };
  }

  // ------------------------------------------------------------------
  // Variables
  // ------------------------------------------------------------------

  function lookupVariable(upperName: string): number | undefined {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const found = scopes[i].get(upperName);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function parseVarBlock(): VarBlock {
    const start = peek().span.start;
    const scope = new Map<string, number>();
    scopes.push(scope);
    const declarations: VarDeclaration[] = [];

    while (isKeyword(peek(), 'VAR')) {
      const varToken = advance();
      const nameToken = peek();
      if (nameToken.kind !== 'Identifier') {
        error('expected-variable-name', `Expected a variable name after VAR but found ${describe(nameToken)}.`, nameToken.span);
        break;
      }
      advance();
      if (peek().kind === 'Operator' && peek().text === '=') {
        advance();
      } else {
        error('expected-equals', `Expected "=" after VAR ${nameToken.text} but found ${describe(peek())}.`, peek().span);
      }
      // The variable is not visible inside its own definition.
      const value = parseExpression();
      const declaration: VarDeclaration = {
        kind: 'VarDeclaration',
        id: id(),
        span: spanFrom(varToken.span.start, value.span.end),
        name: nameToken.text,
        nameSpan: nameToken.span,
        value,
      };
      declarations.push(declaration);
      scope.set(nameToken.text.toUpperCase(), declaration.id);
    }

    let body: Expr;
    if (isKeyword(peek(), 'RETURN')) {
      advance();
      body = parseExpression();
    } else {
      error('expected-return', `Expected RETURN after the VAR definitions but found ${describe(peek())}.`, peek().span);
      body = { kind: 'Error', id: id(), span: spanFrom(lastEnd(), lastEnd()) };
    }

    scopes.pop();
    return { kind: 'VarBlock', id: id(), span: spanFrom(start, Math.max(body.span.end, lastEnd())), declarations, body };
  }

  // ------------------------------------------------------------------
  // Entry point
  // ------------------------------------------------------------------

  if (peek().kind === 'EndOfInput') {
    error('expected-expression', 'There is no expression to analyze.', peek().span);
    return { root: null, diagnostics };
  }

  const root = parseExpression();
  // Report leftover input once, then stop (e.g. "1 2" or a stray ")").
  // Skip lexer Error tokens first: the lexer already reported those.
  while (peek().kind === 'Error') advance();
  const leftover = peek();
  if (leftover.kind !== 'EndOfInput') {
    const lastToken = tokens[tokens.length - 2] ?? leftover;
    error(
      'unexpected-trailing-input',
      `Unexpected ${describe(leftover)} after the end of the expression. Is an operator or comma missing?`,
      spanFrom(leftover.span.start, lastToken.span.end),
    );
  }

  return { root, diagnostics };
}
