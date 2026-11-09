import { useState } from 'react';
import { ContextInspectorPanel } from '../components/ContextInspectorPanel';
import { DaxInputPanel } from '../components/DaxInputPanel';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { ExpressionTreePanel } from '../components/ExpressionTreePanel';
import { ThemeToggle } from '../components/ThemeToggle';
import type { InputMode } from '../engine/definition';
import { SAMPLE_MEASURES, type SampleMeasure } from '../samples/sampleMeasures';
import { analyze, type AnalysisResult } from './analysis';
import { useThemePreference } from './useThemePreference';

export function App() {
  const [theme, setTheme] = useThemePreference();
  const [daxText, setDaxText] = useState(SAMPLE_MEASURES[0].expression);
  const [inputMode, setInputMode] = useState<InputMode>('measure-definition');
  const [result, setResult] = useState<AnalysisResult | null>(null);

  function handleSelectSample(sample: SampleMeasure) {
    setDaxText(sample.expression);
    // All built-in samples are written as "Name = expression".
    setInputMode('measure-definition');
  }

  function handleAnalyze() {
    setResult(analyze(daxText, inputMode));
  }

  const inputChangedSinceAnalysis = result !== null && (result.text !== daxText || result.mode !== inputMode);

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
          value={daxText}
          onChange={setDaxText}
          mode={inputMode}
          onModeChange={setInputMode}
          samples={SAMPLE_MEASURES}
          onSelectSample={handleSelectSample}
          onAnalyze={handleAnalyze}
        />
        <div className="analysis-column">
          <ExpressionTreePanel result={result} />
          <ContextInspectorPanel />
          <DiagnosticsPanel result={result} inputChangedSinceAnalysis={inputChangedSinceAnalysis} />
        </div>
      </main>

      <footer className="app-footer">
        Early preview. Examples use a synthetic model (Sales, Product, Customer, Date, Plant).
      </footer>
    </div>
  );
}
