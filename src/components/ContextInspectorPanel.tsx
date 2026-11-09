import { Panel } from './Panel';

const PLANNED_SECTIONS = [
  'Incoming filter context',
  'Incoming row context',
  'Filters added, replaced, retained, removed',
  'Context transition',
  'Resulting evaluation context',
];

export function ContextInspectorPanel() {
  return (
    <Panel id="context-inspector" title="Context Inspector" status="Planned">
      <p className="placeholder-lead">
        Select a node in the expression tree to see how it changes the evaluation context:
      </p>
      <ul className="placeholder-list">
        {PLANNED_SECTIONS.map((section) => (
          <li key={section}>{section}</li>
        ))}
      </ul>
    </Panel>
  );
}
