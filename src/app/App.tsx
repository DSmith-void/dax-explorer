import { useState } from 'react';
import { ContextInspectorPanel } from '../components/ContextInspectorPanel';
import { DaxInputPanel } from '../components/DaxInputPanel';
import { DiagnosticsPanel, type AnalysisRequest } from '../components/DiagnosticsPanel';
import { ExpressionTreePanel } from '../components/ExpressionTreePanel';
import { ThemeToggle } from '../components/ThemeToggle';
import { SAMPLE_MEASURES } from '../samples/sampleMeasures';
import { useThemePreference } from './useThemePreference';

export function App() {
  const [theme, setTheme] = useThemePreference();
  const [daxText, setDaxText] = useState(SAMPLE_MEASURES[0].expression);
  const [lastRequest, setLastRequest] = useState<AnalysisRequest | null>(null);

  function handleAnalyze() {
    // Milestone 1: record the request only. No parsing or semantic analysis exists yet.
    setLastRequest({
      text: daxText,
      characterCount: daxText.length,
      lineCount: daxText.split(/\r\n|\r|\n/).length,
    });
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
          value={daxText}
          onChange={setDaxText}
          samples={SAMPLE_MEASURES}
          onAnalyze={handleAnalyze}
        />
        <div className="analysis-column">
          <ExpressionTreePanel />
          <ContextInspectorPanel />
          <DiagnosticsPanel
            lastRequest={lastRequest}
            inputChangedSinceRequest={lastRequest !== null && lastRequest.text !== daxText}
          />
        </div>
      </main>

      <footer className="app-footer">
        Early preview. Examples use a synthetic model (Sales, Product, Customer, Date, Plant).
      </footer>
    </div>
  );
}
