import type { Ref } from 'react';
import type { InputMode } from '../engine/definition';
import type { SampleMeasure } from '../samples/sampleMeasures';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';

interface DaxInputPanelProps {
  /** Lets the app highlight text in the editor when a tree node is selected. */
  editorRef: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  samples: readonly SampleMeasure[];
  onSelectSample: (sample: SampleMeasure) => void;
  onAnalyze: () => void;
}

const CUSTOM_OPTION = 'custom';

const MODE_OPTIONS: { value: InputMode; label: string; title: string }[] = [
  {
    value: 'measure-definition',
    label: 'Measure definition',
    title: 'Name = expression, as shown in the Power BI formula bar',
  },
  { value: 'expression', label: 'Expression only', title: 'The whole text is a DAX expression' },
];

const MODE_HINTS: Record<InputMode, string> = {
  'measure-definition':
    'First line is "Name = expression". The name is everything before the first "=" and is read as plain text.',
  expression: 'The whole text is treated as a DAX expression, with no measure name.',
};

export function DaxInputPanel({
  editorRef,
  value,
  onChange,
  mode,
  onModeChange,
  samples,
  onSelectSample,
  onAnalyze,
}: DaxInputPanelProps) {
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
              if (sample) onSelectSample(sample);
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
        <div className="field field-fit">
          <span className="field-label" aria-hidden="true">
            Input type
          </span>
          <SegmentedControl label="Input type" options={MODE_OPTIONS} value={mode} onChange={onModeChange} />
        </div>
      </div>

      <p className="sample-concept">{MODE_HINTS[mode]}</p>
      {matchingSample && <p className="sample-concept">Sample: {matchingSample.concept}</p>}

      <label className="visually-hidden" htmlFor="dax-editor">
        DAX expression
      </label>
      <textarea
        ref={editorRef}
        id="dax-editor"
        className="dax-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder={
          mode === 'measure-definition'
            ? 'Total Sales = SUM(Sales[Amount])'
            : 'SUM(Sales[Amount])'
        }
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
