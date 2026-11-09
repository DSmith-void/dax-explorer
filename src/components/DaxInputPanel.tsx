import type { SampleMeasure } from '../samples/sampleMeasures';
import { Panel } from './Panel';

interface DaxInputPanelProps {
  value: string;
  onChange: (value: string) => void;
  samples: readonly SampleMeasure[];
  onAnalyze: () => void;
}

const CUSTOM_OPTION = 'custom';

export function DaxInputPanel({ value, onChange, samples, onAnalyze }: DaxInputPanelProps) {
  // Derived, not stored: the picker shows a sample only while the text matches it exactly.
  const matchingSample = samples.find((sample) => sample.expression === value);
  const isEmpty = value.trim().length === 0;

  return (
    <Panel id="dax-input" title="DAX Expression" className="input-panel">
      <div className="input-toolbar">
        <label className="field">
          <span className="field-label">Sample</span>
          <select
            value={matchingSample?.id ?? CUSTOM_OPTION}
            onChange={(event) => {
              const sample = samples.find((s) => s.id === event.target.value);
              if (sample) onChange(sample.expression);
            }}
          >
            {!matchingSample && (
              <option value={CUSTOM_OPTION} disabled>
                Custom expression
              </option>
            )}
            {samples.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {matchingSample && <p className="sample-concept">{matchingSample.concept}</p>}

      <label className="visually-hidden" htmlFor="dax-editor">
        DAX expression
      </label>
      <textarea
        id="dax-editor"
        className="dax-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder="Paste or write a DAX measure, e.g. Total Sales = SUM(Sales[Amount])"
      />

      <div className="input-actions">
        <button type="button" className="primary-button" onClick={onAnalyze} disabled={isEmpty}>
          Analyze DAX
        </button>
        <span className="hint">Runs locally in your browser. Nothing is sent anywhere.</span>
      </div>
    </Panel>
  );
}
