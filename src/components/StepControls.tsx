import type { CSSProperties } from 'react';
import type { TimelineEntry } from '../engine/context/timeline';
import { Icon } from './Icons';

interface TimelineBarProps {
  entries: readonly TimelineEntry[];
  index: number;
  onStep: (index: number) => void;
}

/**
 * The one place for stepping: the timeline slider, Previous and Next, and the current step's title.
 * (The arrow keys, Home and End also step, from anywhere on the page.)
 */
export function TimelineBar({ entries, index, onStep }: TimelineBarProps) {
  const current = entries[index];
  const count = entries.length;
  const max = Math.max(count - 1, 0);
  const percent = max === 0 ? 100 : (index / max) * 100;
  return (
    <div className="timeline-bar" role="group" aria-label="Step through the calculation">
      <span className="toolbar-label" aria-hidden="true">
        Timeline
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={Math.min(index, max)}
        disabled={count === 0}
        onChange={(event) => onStep(Number(event.target.value))}
        style={{ '--progress': `${percent}%` } as CSSProperties}
        aria-label="Timeline"
        aria-valuetext={current ? `Step ${index + 1} of ${count}: ${current.title}` : 'No steps'}
      />
      <span className="step-count">{count === 0 ? 'No steps' : `Step ${index + 1} of ${count}`}</span>
      <span className="timeline-buttons">
        <button type="button" className="secondary-button" onClick={() => onStep(index - 1)} disabled={count === 0 || index <= 0} title="Previous step (← key)">
          <Icon name="prev" /> Previous
        </button>
        <button type="button" className="primary-button next-button" onClick={() => onStep(index + 1)} disabled={count === 0 || index >= count - 1} title="Next step (→ key)">
          Next <Icon name="next" />
        </button>
      </span>
      <p className="timeline-title" aria-live="polite">
        {current ? current.title : 'Pick a measure or write your own DAX to see its steps.'}
      </p>
    </div>
  );
}
