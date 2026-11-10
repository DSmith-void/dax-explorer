import { useEffect, useMemo, useRef, useState } from 'react';
import { ContextInspectorPanel, type DetailLevel } from '../components/ContextInspectorPanel';
import { DataSourceBar } from '../components/DataSourceBar';
import { SegmentedControl } from '../components/SegmentedControl';
import { DaxInputPanel } from '../components/DaxInputPanel';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { ExpressionTreePanel } from '../components/ExpressionTreePanel';
import { ThemeToggle } from '../components/ThemeToggle';
import { bind, type ReferenceType, type ResolutionMode } from '../engine/binder/binder';
import { analyzeContext } from '../engine/context/analyzer';
import type { InputMode } from '../engine/definition';
import type { AstNode } from '../engine/parser/ast';
import { SAMPLE_MEASURES, type SampleMeasure } from '../samples/sampleMeasures';
import { analyze, type AnalysisResult } from './analysis';
import { createModelIndex } from '../engine/model';
import { createHelperClient, takeHelperToken, tokenFromHash, type ConnectionInfo, type ModelMetadata } from './helperClient';
import { measureDefinitionText, toModelSnapshot } from './modelConversion';
import { usePersistentState } from './usePersistentState';
import { useThemePreference } from './useThemePreference';

type Choices = Record<string, ReferenceType>;

const isResolutionMode = (value: unknown): value is ResolutionMode => value === 'convention' || value === 'strict';
const isDetailLevel = (value: unknown): value is DetailLevel => value === 'brief' || value === 'detailed';

const DETAIL_OPTIONS: { value: DetailLevel; label: string; title: string }[] = [
  { value: 'brief', label: 'Brief', title: 'One-line summaries; open the full explanation when you want it' },
  { value: 'detailed', label: 'Detailed', title: 'Full explanations, step by step' },
];
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
  // Detailed by default: this is a learning tool. Remembered once changed.
  const [detail, setDetail] = usePersistentState<DetailLevel>('dax-explorer-detail', 'detailed', isDetailLevel);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // The optional local helper (Power BI Desktop connection). Created once; the token is read from the address bar.
  const [helperClient] = useState(() => createHelperClient(takeHelperToken()));
  // If the helper's link (with "#token=...") is pasted into a tab where the app is already open, only the
  // fragment changes and the page doesn't reload; reload so the token is picked up.
  useEffect(() => {
    const onHashChange = () => {
      if (tokenFromHash(window.location.hash)) window.location.reload();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  // The connected model (from Power BI Desktop), if any: makes measure/column types certain.
  const [connectedModel, setConnectedModel] = useState<{ model: ModelMetadata; connection: ConnectionInfo } | null>(null);
  const modelIndex = useMemo(
    () => (connectedModel ? createModelIndex(toModelSnapshot(connectedModel.model)) : undefined),
    [connectedModel],
  );
  const modelMeasures = useMemo(
    () =>
      connectedModel
        ? connectedModel.model.measures
            .filter((m) => !m.isHidden)
            .map((m) => ({ name: m.name, text: measureDefinitionText(m.name, m.expression) }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [connectedModel],
  );

  // Binding is cheap and depends on settings that can change after Analyze, so it is derived on render.
  const binding = useMemo(
    () => (result?.parse ? bind(result.parse.root, { mode: referenceMode, userChoices, model: modelIndex }) : null),
    [result, referenceMode, userChoices, modelIndex],
  );
  // Context analysis depends on the binding (a measure and a column behave differently), so it is derived too.
  const contextAnalysis = useMemo(
    () => (result?.parse && binding ? analyzeContext(result.parse.root, binding, result.text) : null),
    [result, binding],
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

  /** Loads a measure from the connected model into the editor and analyzes it right away. */
  function handleOpenMeasure(text: string) {
    setDaxText(text);
    setInputMode('measure-definition');
    setResult(analyze(text, 'measure-definition'));
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
        <div className="header-settings">
          <div className="panel-setting">
            <span className="field-label" aria-hidden="true">
              Explanations
            </span>
            <SegmentedControl label="Explanations" options={DETAIL_OPTIONS} value={detail} onChange={setDetail} />
          </div>
          <ThemeToggle value={theme} onChange={setTheme} />
        </div>
      </header>

      <DataSourceBar
        client={helperClient}
        onModelChange={(model, connection) => setConnectedModel(model && connection ? { model, connection } : null)}
      />

      <main className="workspace">
        <DaxInputPanel
          editorRef={editorRef}
          value={daxText}
          onChange={setDaxText}
          mode={inputMode}
          onModeChange={setInputMode}
          samples={SAMPLE_MEASURES}
          onSelectSample={handleSelectSample}
          modelMeasures={modelMeasures}
          onSelectModelMeasure={handleOpenMeasure}
          onAnalyze={handleAnalyze}
        />
        <div className="analysis-column">
          <ExpressionTreePanel
            result={result}
            binding={binding}
            analysis={contextAnalysis}
            selectedId={selectedNodeId}
            onSelectNode={handleSelectNode}
            referenceMode={referenceMode}
            onReferenceModeChange={setReferenceMode}
            onChooseReferenceType={handleChooseReferenceType}
            userChoiceCount={Object.keys(userChoices).length}
            onClearChoices={() => setUserChoices({})}
            connectedReport={connectedModel ? (connectedModel.connection.reportName ?? 'an unnamed report') : null}
          />
          <ContextInspectorPanel
            result={result}
            binding={binding}
            analysis={contextAnalysis}
            selectedId={selectedNodeId}
            detail={detail}
            onSelectNode={handleSelectNode}
            onOpenMeasure={(name, expression) => handleOpenMeasure(measureDefinitionText(name, expression))}
          />
          <DiagnosticsPanel
            result={result}
            binding={binding}
            analysis={contextAnalysis}
            detail={detail}
            inputChangedSinceAnalysis={inputChangedSinceAnalysis}
            onSelectNode={handleSelectNode}
          />
        </div>
      </main>

      <footer className="app-footer">
        Early preview. Built-in samples use a synthetic model (Sales, Product, Customer, Date, Plant).
      </footer>
    </div>
  );
}
