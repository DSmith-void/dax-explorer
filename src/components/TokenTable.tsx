import { createLineMap } from '../engine/source';
import type { Token } from '../engine/lexer/tokens';

interface TokenTableProps {
  source: string;
  tokens: readonly Token[];
}

/** Shows the unescaped value only where it differs from the raw text. */
function displayValue(token: Token): string {
  if (token.kind === 'String' || token.kind === 'QuotedTableName' || token.kind === 'BracketedName') {
    return token.value;
  }
  if (token.kind === 'Keyword' && token.value !== token.text) {
    return token.value;
  }
  return '';
}

export function TokenTable({ source, tokens }: TokenTableProps) {
  const positionAt = createLineMap(source);
  const visible = tokens.filter((t) => t.kind !== 'EndOfInput');

  if (visible.length === 0) {
    return <p className="placeholder-lead">No tokens: the expression is empty or contains only whitespace.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="token-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Kind</th>
            <th scope="col">Text</th>
            <th scope="col">Value</th>
            <th scope="col">Line:Col</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((token, index) => {
            const { line, column } = positionAt(token.span.start);
            return (
              <tr key={token.span.start} className={`token-${token.kind}`}>
                <td className="num">{index + 1}</td>
                <td>
                  <span className="token-kind">{token.kind}</span>
                </td>
                <td className="code">{token.text}</td>
                <td className="code">{displayValue(token)}</td>
                <td className="num">
                  {line}:{column}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
