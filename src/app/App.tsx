import { useRef, useState } from 'react';
import { ContextInspectorPanel } from '../components/ContextInspectorPanel';
import { DaxInputPanel } from '../components/DaxInputPanel';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { ExpressionTreePanel } from '../components/ExpressionTreePanel';
import { ThemeToggle } from '../components/ThemeToggle';
import type { InputMode } from '../engine/definition';
import type { AstNode } from '../engine/parser/ast';
import { SAMPLE_MEASURES, type SampleMeasure } from '../samples/sampleMeasures';
import { analyze, type AnalysisResult } from './analysis';
import { useThemePreference } from './useThemePreference';

export function App() {
  const [theme, setTheme] = useThemePreference();
  const [daxText, setDaxText] = useState(SAMPLE_MEASURES[0].expression);
  const [inputMode, setInputMode] = useState<InputMode>('measure-definition');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  function handleSelectSample(sample: SampleMeasure) {
    setDaxText(sample.expression);
    // All built-in samples are written as "Name = expression".
    setInputMode('measure-definition');
  }

  function handleAnalyze() {
    setResult(analyze(daxText, inputMode));
    setSelectedNodeId(null);
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
          <ExpressionTreePanel result={result} selectedId={selectedNodeId} onSelectNode={handleSelectNode} />
          <ContextInspectorPanel result={result} selectedId={selectedNodeId} onSelectNode={handleSelectNode} />
          <DiagnosticsPanel result={result} inputChangedSinceAnalysis={inputChangedSinceAnalysis} />
        </div>
      </main>

      <footer className="app-footer">
        Early preview. Examples use a synthetic model (Sales, Product, Customer, Date, Plant).
      </footer>
    </div>
  );
}
