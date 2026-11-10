import type { Ref } from 'react';
import type { AnalysisResult } from '../app/analysis';
import type { InputMode } from '../engine/definition';
import type { AstNode } from '../engine/parser/ast';
import type { Span } from '../engine/source';
import { CodeView } from './CodeView';
import { Icon } from './Icons';
import { SegmentedControl } from './SegmentedControl';

interface CodePaneProps {
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onExplain: () => void;
  editorRef: Ref<HTMLTextAreaElement>;
  text: string;
  onTextChange: (text: string) => void;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  /** The last explained text (shown read-only). */
  result: AnalysisResult | null;
  highlight: Span | null;
  onSelectNode: (node: AstNode) => void;
  /** A one-line hint about the loaded example, if any. */
  concept: string | null;
}

const MODE_OPTIONS: { value: InputMode; label: string; title: string }[] = [
  { value: 'measure-definition', label: 'Measure', title: 'Name = expression, as in the Power BI formula bar' },
  { value: 'expression', label: 'Expression only', title: 'The whole text is a DAX expression, with no name' },
];

/** The DAX: read-only with the current step highlighted, or a text box while editing. */
export function CodePane({
  editing,
  onEdit,
  onCancelEdit,
  onExplain,
  editorRef,
  text,
  onTextChange,
  mode,
  onModeChange,
  result,
  highlight,
  onSelectNode,
  concept,
}: CodePaneProps) {
  return (
    <section className="code-pane" aria-label="DAX">
      <header className="pane-header">
        {editing ? (
          <>
            <SegmentedControl label="What you are writing" options={MODE_OPTIONS} value={mode} onChange={onModeChange} />
            <span className="pane-header-spacer" />
            {result && (
              <button type="button" className="secondary-button" onClick={onCancelEdit}>
                Cancel
              </button>
            )}
            <button type="button" className="primary-button" onClick={onExplain} disabled={text.trim().length === 0}>
              Explain
            </button>
          </>
        ) : (
          <>
            <p className="pane-concept">{concept ?? 'Click any part of the code to see what happens there.'}</p>
            <span className="pane-header-spacer" />
            <button type="button" className="secondary-button" onClick={onEdit}>
              <Icon name="edit" /> Edit
            </button>
          </>
        )}
      </header>

      {editing ? (
        <>
          <label className="visually-hidden" htmlFor="dax-editor">
            DAX
          </label>
          <textarea
            ref={editorRef}
            id="dax-editor"
            className="dax-editor"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (text.trim()) onExplain();
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            placeholder={mode === 'measure-definition' ? 'Total Sales = SUM(Sales[Amount])' : 'SUM(Sales[Amount])'}
          />
          <p className="pane-hint">
            Paste or write DAX, then press Explain (Ctrl+Enter). It runs in your browser; nothing is sent anywhere.
          </p>
        </>
      ) : result?.lex ? (
        <CodeView
          text={result.text}
          tokens={result.lex.tokens}
          expressionStart={result.header?.expressionStart ?? 0}
          root={result.parse?.root ?? null}
          highlight={highlight}
          onSelectNode={onSelectNode}
        />
      ) : (
        <pre className="code-view code-view-plain">{result?.text ?? text}</pre>
      )}
    </section>
  );
}
