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
  /** Measures from a connected model, ready to load ("Name =\nexpression"). Empty when not connected. */
  modelMeasures: readonly { name: string; text: string }[];
  onSelectModelMeasure: (text: string) => void;
  onAnalyze: () => void;
}

const CUSTOM_OPTION = 'custom';
const MODEL_PREFIX = 'model:';

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
  modelMeasures,
  onSelectModelMeasure,
  onAnalyze,
}: DaxInputPanelProps) {
  // Derived, not stored: the picker shows an entry only while the text matches it exactly.
  const matchingSample = samples.find((sample) => sample.expression === value);
  const matchingModelMeasure = modelMeasures.find((m) => m.text === value);
  const selected = matchingSample?.id ?? (matchingModelMeasure ? MODEL_PREFIX + matchingModelMeasure.name : CUSTOM_OPTION);
  const isEmpty = value.trim().length === 0;

  return (
    <Panel id="dax-input" title="DAX Expression" className="input-panel">
      <div className="input-toolbar">
        <label className="field">
          <span className="field-label">{modelMeasures.length > 0 ? 'Measure or sample' : 'Sample'}</span>
          <select
            value={selected}
            onChange={(event) => {
              const id = event.target.value;
              if (id.startsWith(MODEL_PREFIX)) {
                const measure = modelMeasures.find((m) => MODEL_PREFIX + m.name === id);
                if (measure) onSelectModelMeasure(measure.text);
                return;
              }
              const sample = samples.find((s) => s.id === id);
              if (sample) onSelectSample(sample);
            }}
          >
            {selected === CUSTOM_OPTION && (
              <option value={CUSTOM_OPTION} disabled>
                Custom expression
              </option>
            )}
            {modelMeasures.length > 0 && (
              <optgroup label="Measures in your model">
                {modelMeasures.map((m) => (
                  <option key={m.name} value={MODEL_PREFIX + m.name}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Built-in samples">
              {samples.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.title}
                </option>
              ))}
            </optgroup>
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
