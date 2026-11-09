import { useMemo, useRef, useState } from 'react';
import { ContextInspectorPanel } from '../components/ContextInspectorPanel';
import { DaxInputPanel } from '../components/DaxInputPanel';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { ExpressionTreePanel } from '../components/ExpressionTreePanel';
import { ThemeToggle } from '../components/ThemeToggle';
import { bind, type ReferenceType, type ResolutionMode } from '../engine/binder/binder';
import type { InputMode } from '../engine/definition';
import type { AstNode } from '../engine/parser/ast';
import { SAMPLE_MEASURES, type SampleMeasure } from '../samples/sampleMeasures';
import { analyze, type AnalysisResult } from './analysis';
import { usePersistentState } from './usePersistentState';
import { useThemePreference } from './useThemePreference';

type Choices = Record<string, ReferenceType>;

const isResolutionMode = (value: unknown): value is ResolutionMode => value === 'convention' || value === 'strict';
const isChoices = (value: unknown): value is Choices =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => v === 'measure' || v === 'column');

export function App() {
  const [theme, setTheme] = useThemePreference();
  const [daxText, setDaxText] = useState(SAMPLE_MEASURES[0].expression);
  const [inputMode, setInputMode] = useState<InputMode>('measure-definition');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [referenceMode, setReferenceMode] = usePersistentState<ResolutionMode>(
    'dax-explorer-reference-mode',
    'convention',
    isResolutionMode,
  );
  const [userChoices, setUserChoices] = usePersistentState<Choices>('dax-explorer-reference-choices', {}, isChoices);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Binding is cheap and depends on settings that can change after Analyze, so it is derived on render.
  const binding = useMemo(
    () => (result?.parse ? bind(result.parse.root, { mode: referenceMode, userChoices }) : null),
    [result, referenceMode, userChoices],
  );

  function handleSelectSample(sample: SampleMeasure) {
    setDaxText(sample.expression);
    // All built-in samples are written as "Name = expression".
    setInputMode('measure-definition');
  }

  function handleAnalyze() {
    setResult(analyze(daxText, inputMode));
    setSelectedNodeId(null);
  }

  function handleChooseReferenceType(key: string, type: ReferenceType | null) {
    setUserChoices((previous) => {
      const next = { ...previous };
      if (type === null) delete next[key];
      else next[key] = type;
      return next;
    });
  }

  const inputChangedSinceAnalysis = result !== null && (result.text !== daxText || result.mode !== inputMode);

  function handleSelectNode(node: AstNode) {
    setSelectedNodeId(node.id);
    // Highlight the node's text in the editor, but only if the positions still match the editor contents.
    const editor = editorRef.current;
    if (editor && !inputChangedSinceAnalysis) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(node.span.start, node.span.end);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>DAX Execution Explorer</h1>
          <p className="tagline">See how a DAX expression is evaluated, one context at a time.</p>
        </div>
        <ThemeToggle value={theme} onChange={setTheme} />
      </header>

      <main className="workspace">
        <DaxInputPanel
          editorRef={editorRef}
          value={daxText}
          onChange={setDaxText}
          mode={inputMode}
          onModeChange={setInputMode}
          samples={SAMPLE_MEASURES}
          onSelectSample={handleSelectSample}
          onAnalyze={handleAnalyze}
        />
        <div className="analysis-column">
          <ExpressionTreePanel
            result={result}
            binding={binding}
            selectedId={selectedNodeId}
            onSelectNode={handleSelectNode}
            referenceMode={referenceMode}
            onReferenceModeChange={setReferenceMode}
            onChooseReferenceType={handleChooseReferenceType}
            userChoiceCount={Object.keys(userChoices).length}
            onClearChoices={() => setUserChoices({})}
          />
          <ContextInspectorPanel
            result={result}
            binding={binding}
            selectedId={selectedNodeId}
            onSelectNode={handleSelectNode}
          />
          <DiagnosticsPanel result={result} binding={binding} inputChangedSinceAnalysis={inputChangedSinceAnalysis} />
        </div>
      </main>

      <footer className="app-footer">
        Early preview. Examples use a synthetic model (Sales, Product, Customer, Date, Plant).
      </footer>
    </div>
  );
}
