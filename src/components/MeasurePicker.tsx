import { useMemo, useState } from 'react';
import type { SampleMeasure } from '../samples/sampleMeasures';
import { measureTree, searchMeasures, type MeasureNode, type PickerMeasure } from './measureTree';
import { usePopover } from './usePopover';

interface MeasurePickerProps {
  /** The text currently loaded; the picker names an entry only while the text matches it exactly. */
  value: string;
  samples: readonly SampleMeasure[];
  onSelectSample: (sample: SampleMeasure) => void;
  /** Measures from the connected model. Empty when not connected: the built-in examples are listed then. */
  modelMeasures: readonly PickerMeasure[];
  onSelectModelMeasure: (text: string) => void;
}

/**
 * Chooses what to explain. Connected: the model's measures, by table and display folder (like Power BI's
 * Data pane), with a search. Not connected: the built-in examples.
 */
export function MeasurePicker({ value, samples, onSelectSample, modelMeasures, onSelectModelMeasure }: MeasurePickerProps) {
  const { open, setOpen, container } = usePopover<HTMLDivElement>();
  const connected = modelMeasures.length > 0;
  const current = modelMeasures.find((m) => m.text === value);
  const sample = connected ? undefined : samples.find((s) => s.expression === value);
  // Nothing chosen yet: an invitation; DAX written by hand: "Custom DAX" (next to "Write your own DAX").
  const label = current?.name ?? sample?.title ?? (value.trim() === '' ? (connected ? 'Choose a measure' : 'Choose an example') : 'Custom DAX');

  return (
    <div className="measure-picker" ref={container}>
      <button type="button" className="picker-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} title="Choose the measure to explain">
        <span className="visually-hidden">Measure to explain: </span>
        <span className="picker-label">{label}</span>
        <span className="data-pill-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="data-panel measure-panel" role="dialog" aria-label={connected ? 'Measures in your model' : 'Built-in examples'}>
          <MeasureBrowser
            value={value}
            samples={samples}
            modelMeasures={modelMeasures}
            autoFocus
            onSelectSample={(s) => {
              onSelectSample(s);
              setOpen(false);
            }}
            onSelectModelMeasure={(text) => {
              onSelectModelMeasure(text);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The list to choose from: connected, a search and the measures by table and display folder; not
 * connected, the built-in examples. Used by the picker and by the start panel.
 */
export function MeasureBrowser({
  value,
  samples,
  onSelectSample,
  modelMeasures,
  onSelectModelMeasure,
  autoFocus = false,
}: MeasurePickerProps & { autoFocus?: boolean }) {
  const [search, setSearch] = useState('');
  const connected = modelMeasures.length > 0;
  const current = modelMeasures.find((m) => m.text === value);
  const sample = connected ? undefined : samples.find((s) => s.expression === value);
  const tree = useMemo(() => measureTree(modelMeasures), [modelMeasures]);
  const results = useMemo(() => searchMeasures(modelMeasures, search), [modelMeasures, search]);

  const pick = (measure: PickerMeasure) => {
    onSelectModelMeasure(measure.text);
    setSearch('');
  };

  if (!connected) {
    return (
      <>
        <p className="data-panel-title">Built-in examples</p>
        <ul className="picker-list">
          {samples.map((s) => (
            <li key={s.id}>
              <button type="button" className={s === sample ? 'is-current' : undefined} onClick={() => onSelectSample(s)}>
                <span>{s.title}</span>
                <span className="picker-path">{s.concept}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <>
      <input
        type="search"
        className="text-input"
        placeholder={`Search ${modelMeasures.length} measures`}
        aria-label="Search measures"
        value={search}
        autoFocus={autoFocus}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) pick(results[0].measure);
        }}
      />
      {search.trim() ? (
        results.length === 0 ? (
          <p className="data-bar-muted">No measure name contains "{search.trim()}".</p>
        ) : (
          <ul className="picker-list">
            {results.map((r) => (
              <li key={`${r.measure.table}|${r.measure.name}`}>
                <button type="button" className={r.measure === current ? 'is-current' : undefined} onClick={() => pick(r.measure)}>
                  <span>{r.measure.name}</span>
                  {r.path && <span className="picker-path">{r.path}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="picker-list picker-tree">
          {tree.map((node, i) => (
            <TreeNode key={i} node={node} current={current} onPick={pick} />
          ))}
        </ul>
      )}
    </>
  );
}

/** A folder (closed until clicked, or open when it holds the current measure) or a measure. */
function TreeNode({ node, current, onPick }: { node: MeasureNode; current: PickerMeasure | undefined; onPick: (m: PickerMeasure) => void }) {
  const holdsCurrent = node.kind === 'folder' && current !== undefined && contains(node, current);
  const [open, setOpen] = useState(holdsCurrent);
  if (node.kind === 'measure') {
    return (
      <li>
        <button type="button" className={node.measure === current ? 'is-current' : undefined} onClick={() => onPick(node.measure)}>
          <span>{node.measure.name}</span>
        </button>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className="picker-folder" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="picker-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>{node.name}</span>
        <span className="picker-count">{node.count}</span>
      </button>
      {open && (
        <ul className="picker-list">
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} current={current} onPick={onPick} />
          ))}
        </ul>
      )}
    </li>
  );
}

function contains(node: MeasureNode, measure: PickerMeasure): boolean {
  return node.kind === 'measure' ? node.measure === measure : node.children.some((c) => contains(c, measure));
}
