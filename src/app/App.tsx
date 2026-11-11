import { useEffect, useMemo, useRef, useState } from 'react';
import { CodePane } from '../components/CodePane';
import { ContextInspectorPanel, type DetailLevel } from '../components/ContextInspectorPanel';
import { DataSourceBar } from '../components/DataSourceBar';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { ExpressionTreePanel } from '../components/ExpressionTreePanel';
import { HelpDialog } from '../components/HelpDialog';
import { Icon } from '../components/Icons';
import { MeasurePicker } from '../components/MeasurePicker';
import { ReportFiltersContext } from '../components/reportFiltersContext';
import { ReportFiltersPanel } from '../components/ReportFiltersPanel';
import { SegmentedControl } from '../components/SegmentedControl';
import { TimelineBar } from '../components/StepControls';
import { StepPanel } from '../components/StepPanel';
import { SummaryCards } from '../components/SummaryCards';
import { ThemeToggle } from '../components/ThemeToggle';
import { bind, type ReferenceType, type ResolutionMode } from '../engine/binder/binder';
import { analyzeContext } from '../engine/context/analyzer';
import type { ReportFilter } from '../engine/context/reportFilters';
import { buildTimeline } from '../engine/context/timeline';
import type { InputMode } from '../engine/definition';
import { createModelIndex } from '../engine/model';
import { findNode, type AstNode } from '../engine/parser/ast';
import { SAMPLE_MEASURES, type SampleMeasure } from '../samples/sampleMeasures';
import { analyze, type AnalysisResult } from './analysis';
import { createHelperClient, takeHelperToken, tokenFromHash, type ConnectionInfo, type ModelMetadata } from './helperClient';
import { measureDefinitionText, toModelSnapshot } from './modelConversion';
import { usePersistentState } from './usePersistentState';
import { useStepValues } from './useStepValues';
import { useDesktopVisuals } from './useDesktopVisuals';
import { useThemePreference } from './useThemePreference';

type Choices = Record<string, ReferenceType>;
type Tab = 'step' | 'part' | 'tree' | 'problems';

const isResolutionMode = (value: unknown): value is ResolutionMode => value === 'convention' || value === 'strict';
const isDetailLevel = (value: unknown): value is DetailLevel => value === 'brief' || value === 'detailed';
const isChoices = (value: unknown): value is Choices =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => v === 'measure' || v === 'column');

const DETAIL_OPTIONS: { value: DetailLevel; label: string; title: string }[] = [
  { value: 'brief', label: 'Brief', title: 'Short explanations' },
  { value: 'detailed', label: 'Detailed', title: 'Full explanations' },
];

/** True when a key press belongs to a form control (typing, choosing), not to stepping. */
function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function App() {
  const [theme, setTheme] = useThemePreference();
  const [daxText, setDaxText] = useState(SAMPLE_MEASURES[0].expression);
  const [inputMode, setInputMode] = useState<InputMode>('measure-definition');
  // The first example is explained right away, so the page never starts empty.
  const [result, setResult] = useState<AnalysisResult | null>(() => analyze(SAMPLE_MEASURES[0].expression, 'measure-definition'));
  const [editing, setEditing] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [tab, setTab] = useState<Tab>('step');
  const [helpOpen, setHelpOpen] = useState(false);
  // The concrete stand-in for the report's filters (F). Empty: none chosen yet.
  const [reportFilters, setReportFilters] = useState<readonly ReportFilter[]>([]);
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

  // Binding is cheap and depends on settings that can change after Explain, so it is derived on render.
  const binding = useMemo(
    () => (result?.parse ? bind(result.parse.root, { mode: referenceMode, userChoices, model: modelIndex }) : null),
    [result, referenceMode, userChoices, modelIndex],
  );
  // Context analysis depends on the binding (a measure and a column behave differently), so it is derived too.
  const contextAnalysis = useMemo(
    () => (result?.parse && binding ? analyzeContext(result.parse.root, binding, result.text) : null),
    [result, binding],
  );
  const timeline = useMemo(
    () => (result?.parse && binding && contextAnalysis ? buildTimeline(result.parse.root, binding, contextAnalysis, result.text) : []),
    [result, binding, contextAnalysis],
  );

  const root = result?.parse?.root ?? null;
  const index = Math.min(stepIndex, Math.max(timeline.length - 1, 0));
  const current = timeline[index];
  const selectedNode = selectedNodeId !== null ? findNode(root, selectedNodeId) : null;
  const highlightNode = selectedNode ?? (current?.nodeId !== null && current ? findNode(root, current.nodeId) : null);
  const problemCount = (result?.diagnostics.length ?? 0) + (binding?.diagnostics.length ?? 0);
  const matchingSample = result ? SAMPLE_MEASURES.find((s) => s.expression === result.text) : undefined;

  // "Listen to Power BI Desktop while connected": off unless the user turns it on (remembered).
  const [listen, setListen] = usePersistentState<boolean>('dax-explorer-listen', false, (v): v is boolean => typeof v === 'boolean');
  const desktopVisuals = useDesktopVisuals({
    client: helperClient,
    connectionKey: connectedModel ? `${connectedModel.connection.port}:${connectedModel.model.databaseName}` : null,
    listen,
  });

  // Real values at each step, from the connected report.
  const stepValues = useStepValues({
    client: helperClient,
    connectionKey: connectedModel ? `${connectedModel.connection.port}:${connectedModel.model.databaseName}` : null,
    timeline,
    current,
    root,
    binding,
    source: result?.text ?? '',
    reportFilters,
  });

  function goToStep(next: number) {
    const clamped = Math.max(0, Math.min(next, timeline.length - 1));
    setStepIndex(clamped);
    setSelectedNodeId(null); // the highlight follows the step again
  }

  // Keyboard: arrows step, Home/End jump, unless typing in a form control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing || helpOpen || isFormTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const keys: Record<string, () => void> = {
        ArrowRight: () => goToStep(index + 1),
        ArrowLeft: () => goToStep(index - 1),
        Home: () => goToStep(0),
        End: () => goToStep(timeline.length - 1),
      };
      if (keys[event.key]) {
        event.preventDefault();
        keys[event.key]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Explains a text right away (used by the picker and by Explain). */
  function explain(text: string, mode: InputMode) {
    setDaxText(text);
    setInputMode(mode);
    setResult(analyze(text, mode));
    setEditing(false);
    setStepIndex(0);
    setSelectedNodeId(null);
    setTab('step');
  }

  function handleSelectSample(sample: SampleMeasure) {
    // All built-in samples are written as "Name = expression".
    explain(sample.expression, 'measure-definition');
  }

  function handleEdit() {
    setEditing(true);
    window.setTimeout(() => editorRef.current?.focus(), 0);
  }

  /** Starts an empty editor for pasting or writing a measure. */
  function handleWriteYourOwn() {
    setDaxText('');
    setInputMode('measure-definition');
    setEditing(true);
    window.setTimeout(() => editorRef.current?.focus(), 0);
  }

  function handleCancelEdit() {
    if (result) {
      setDaxText(result.text);
      setInputMode(result.mode);
    }
    setEditing(false);
  }

  function handleModelChange(model: ModelMetadata | null, connection: ConnectionInfo | null) {
    // Report filters belong to one model: forget them when the connection changes.
    if (connectedModel?.model.databaseName !== model?.databaseName || connectedModel?.connection.port !== connection?.port) {
      setReportFilters([]);
    }
    setConnectedModel(model && connection ? { model, connection } : null);
  }

  /** Loads a measure of the connected model by name (case-insensitive); false when there is no such measure. */
  function handleExplainMeasure(name: string): boolean {
    const measure = modelMeasures.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (!measure) return false;
    explain(measure.text, 'measure-definition');
    return true;
  }

  function handleChooseReferenceType(key: string, type: ReferenceType | null) {
    setUserChoices((previous) => {
      const next = { ...previous };
      if (type === null) delete next[key];
      else next[key] = type;
      return next;
    });
  }

  /** A part of the code was clicked (in the code or the tree): go to its step, if it has one. */
  function handleSelectNode(node: AstNode) {
    const step = timeline.find((e) => e.nodeId === node.id);
    if (step) {
      setStepIndex(step.index);
      setSelectedNodeId(null);
      if (tab !== 'step' && tab !== 'part') setTab('step');
    } else {
      setSelectedNodeId(node.id);
      setTab('part');
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'step', label: 'Step by step' },
    { id: 'part', label: 'Selected part' },
    { id: 'tree', label: 'Expression tree' },
    { id: 'problems', label: 'Problems', count: problemCount },
  ];

  return (
    <ReportFiltersContext.Provider value={reportFilters}>
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="logo" />
          </span>
          <h1>
            DAX <span>Explorer</span>
          </h1>
        </div>
        <MeasurePicker
          value={editing ? daxText : (result?.text ?? daxText)}
          samples={SAMPLE_MEASURES}
          onSelectSample={handleSelectSample}
          modelMeasures={modelMeasures}
          onSelectModelMeasure={(text) => explain(text, 'measure-definition')}
        />
        <button type="button" className="secondary-button" onClick={handleWriteYourOwn}>
          <Icon name="edit" /> Write your own DAX
        </button>
        <ReportFiltersPanel
          client={helperClient}
          model={connectedModel?.model ?? null}
          filters={reportFilters}
          onChange={setReportFilters}
          onExplainMeasure={handleExplainMeasure}
          desktop={desktopVisuals}
          listen={listen}
          onListenChange={setListen}
        />
        <span className="toolbar-spacer" />
        <div className="toolbar-settings">
          <DataSourceBar
            client={helperClient}
            onModelChange={handleModelChange}
          />
          <SegmentedControl label="Explanations" options={DETAIL_OPTIONS} value={detail} onChange={setDetail} />
          <ThemeToggle value={theme} onChange={setTheme} />
          <button type="button" className="icon-button help-button" onClick={() => setHelpOpen(true)} title="How to read DAX Explorer">
            <span aria-hidden="true">?</span>
            <span className="visually-hidden">How to read DAX Explorer</span>
          </button>
        </div>
      </header>

      <TimelineBar
        entries={timeline}
        index={index}
        onStep={goToStep}
      />

      <SummaryCards
        entries={timeline}
        index={index}
        onStep={(i) => {
          goToStep(i);
          setTab('step');
        }}
      />

      <main className="workspace">
        <CodePane
          editing={editing}
          onEdit={handleEdit}
          onCancelEdit={handleCancelEdit}
          onExplain={() => explain(daxText, inputMode)}
          editorRef={editorRef}
          text={daxText}
          onTextChange={setDaxText}
          mode={inputMode}
          onModeChange={setInputMode}
          result={result}
          highlight={editing ? null : (highlightNode?.span ?? null)}
          onSelectNode={handleSelectNode}
          concept={matchingSample?.concept ?? null}
        />

        <section className="inspector-pane" aria-label="Explanation">
          <div className="tabs" role="tablist" aria-label="Explanation views">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`tabpanel-${t.id}`}
                className={tab === t.id ? 'is-active' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && <span className="count-badge is-warning">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'step' && (
              <StepPanel
                entries={timeline}
                index={index}
                onStep={goToStep}
                analysis={contextAnalysis}
                root={root}
                source={result?.text ?? ''}
                detail={detail}
                onSelectNode={handleSelectNode}
                values={stepValues}
                connected={connectedModel !== null}
              />
            )}
            {tab === 'part' && (
              <ContextInspectorPanel
                result={result}
                binding={binding}
                analysis={contextAnalysis}
                selectedId={selectedNode?.id ?? current?.nodeId ?? null}
                detail={detail}
                onSelectNode={handleSelectNode}
                onOpenMeasure={(name, expression) => explain(measureDefinitionText(name, expression), 'measure-definition')}
              />
            )}
            {tab === 'tree' && (
              <ExpressionTreePanel
                result={result}
                binding={binding}
                analysis={contextAnalysis}
                selectedId={highlightNode?.id ?? null}
                onSelectNode={handleSelectNode}
                referenceMode={referenceMode}
                onReferenceModeChange={setReferenceMode}
                onChooseReferenceType={handleChooseReferenceType}
                userChoiceCount={Object.keys(userChoices).length}
                onClearChoices={() => setUserChoices({})}
                connectedReport={connectedModel ? (connectedModel.connection.reportName ?? 'an unnamed report') : null}
              />
            )}
            {tab === 'problems' && (
              <DiagnosticsPanel
                result={result}
                binding={binding}
                analysis={contextAnalysis}
                detail={detail}
                inputChangedSinceAnalysis={editing && result !== null && (result.text !== daxText || result.mode !== inputMode)}
                onSelectNode={handleSelectNode}
              />
            )}
          </div>
        </section>
      </main>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
    </ReportFiltersContext.Provider>
  );
}
