import type { SampleMeasure } from '../samples/sampleMeasures';
import { Icon } from './Icons';
import { MeasureBrowser } from './MeasurePicker';
import type { PickerMeasure } from './measureTree';

interface StartPanelProps {
  /** The connected report's name, or null when not connected. */
  report: string | null;
  samples: readonly SampleMeasure[];
  onSelectSample: (sample: SampleMeasure) => void;
  modelMeasures: readonly PickerMeasure[];
  onSelectModelMeasure: (text: string) => void;
  onWriteYourOwn: () => void;
}

/**
 * Shown when nothing is loaded yet (for example right after connecting): choose a measure here, or write
 * your own, with three lines on how to read what follows.
 */
export function StartPanel({ report, samples, onSelectSample, modelMeasures, onSelectModelMeasure, onWriteYourOwn }: StartPanelProps) {
  return (
    <section className="start-panel" aria-labelledby="start-title">
      <div className="start-choose">
        <h2 id="start-title" className="start-title">
          {report ? `Choose a measure from ${report}` : 'Choose an example to explain'}
        </h2>
        <div className="start-browser">
          <MeasureBrowser value="" samples={samples} onSelectSample={onSelectSample} modelMeasures={modelMeasures} onSelectModelMeasure={onSelectModelMeasure} />
        </div>
        <p className="start-or">
          or{' '}
          <button type="button" className="secondary-button" onClick={onWriteYourOwn}>
            <Icon name="edit" /> Write your own DAX
          </button>
        </p>
      </div>
      <aside className="start-how" aria-label="How to read DAX Explorer">
        <h3>How to read it</h3>
        <ol>
          <li>
            <strong>Step through it</strong> with <kbd>→</kbd> or Next. Each step says where it runs, what changes, and its value.
          </li>
          <li>
            <strong>F</strong> is the report's filters: where in the report the value is for. Choose them from the F button, or take
            them from a visual.
          </li>
          <li>
            <strong>Hints</strong> point out likely mistakes, slow patterns and what DAX does silently.
          </li>
        </ol>
      </aside>
    </section>
  );
}
