import type { SampleMeasure } from '../samples/sampleMeasures';

interface MeasurePickerProps {
  /** The text currently loaded; the picker shows an entry only while the text matches it exactly. */
  value: string;
  samples: readonly SampleMeasure[];
  onSelectSample: (sample: SampleMeasure) => void;
  /** Measures from a connected model ("Name =\nexpression"). Empty when not connected. */
  modelMeasures: readonly { name: string; text: string }[];
  onSelectModelMeasure: (text: string) => void;
}

const CUSTOM_OPTION = 'custom';
const MODEL_PREFIX = 'model:';

/** Chooses what to explain: a measure from the connected model or a built-in sample. */
export function MeasurePicker({ value, samples, onSelectSample, modelMeasures, onSelectModelMeasure }: MeasurePickerProps) {
  const matchingSample = samples.find((sample) => sample.expression === value);
  const matchingModelMeasure = modelMeasures.find((m) => m.text === value);
  const selected = matchingModelMeasure
    ? MODEL_PREFIX + matchingModelMeasure.name
    : (matchingSample?.id ?? CUSTOM_OPTION);

  return (
    <label className="measure-picker">
      <span className="visually-hidden">Measure to explain</span>
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
            Your own DAX
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
        <optgroup label="Built-in examples">
          {samples.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.title}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
