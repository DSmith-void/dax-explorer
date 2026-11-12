import type { CSSProperties, ReactNode, Ref } from 'react';
import type { AnalysisResult } from '../app/analysis';
import { frameTint, type Frame } from '../app/frames';
import type { InputMode } from '../engine/definition';
import type { AstNode } from '../engine/parser/ast';
import type { Span } from '../engine/source';
import { CodeView, type CodeAnnotation } from './CodeView';
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
  /** The chain of measures stepped into, from the measure being explained to the one shown. */
  frames: readonly Frame[];
  onSelectFrame: (frame: Frame) => void;
  /** Values worked out so far, shown in the code. */
  annotations?: readonly CodeAnnotation[];
  /** Buttons at the end of the header (collapse, hide). */
  actions?: ReactNode;
  /** Only the header shows. */
  collapsed?: boolean;
  /** Its share of the pane's height, when the story is shown too. */
  style?: CSSProperties;
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
  frames,
  onSelectFrame,
  annotations,
  actions,
  collapsed = false,
  style,
}: CodePaneProps) {
  const shown = editing ? undefined : frames[frames.length - 1];
  const tint = shown ? frameTint(shown.level) : 0;
  return (
    <section className={`code-pane${tint ? ` frame-tint-${tint}` : ''}${collapsed ? ' is-folded' : ''}`} aria-label="DAX" style={style}>
      {shown && shown.level > 0 && (
        // Keyed by the measure, so the highlight replays each time the code switches to another measure.
        <nav key={shown.key} className="frame-breadcrumb" aria-label="Measures stepped into">
          {frames.map((frame, i) => (
            <span key={frame.key} className="frame-crumb">
              {i > 0 && <span aria-hidden="true"> › </span>}
              {frame === shown ? (
                <strong aria-current="location">{frame.name}</strong>
              ) : (
                <button type="button" className="link-button" onClick={() => onSelectFrame(frame)} title={`Back to ${frame.name}`}>
                  {frame.name}
                </button>
              )}
            </span>
          ))}
          <span className="muted"> · the code of {shown.name}, as {frames[frames.length - 2].name} calls it</span>
        </nav>
      )}
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
            {actions}
          </>
        ) : (
          <>
            <p className="pane-concept">{concept ?? 'Click any part of the code to see what happens there.'}</p>
            <span className="pane-header-spacer" />
            {(!shown || shown.level === 0) && (
              <button type="button" className="secondary-button" onClick={onEdit}>
                <Icon name="edit" /> Edit
              </button>
            )}
            {actions}
          </>
        )}
      </header>

      {!collapsed && (editing ? (
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
          annotations={annotations}
        />
      ) : (
        (result?.text ?? text).trim() === '' ? (
          <p className="code-empty">Choose a measure from the list above, or press Edit to write your own DAX.</p>
        ) : (
          <pre className="code-view code-view-plain">{result?.text ?? text}</pre>
        )
      ))}
    </section>
  );
}
