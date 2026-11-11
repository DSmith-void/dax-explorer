import { useState } from 'react';
import type { EvalContext } from '../engine/context/model';
import { flowFrom, pathText, type FilterReach, type Relationship, type RelationshipModel, type TableReach } from '../engine/context/relationships';
import { useFilterReach } from './relationshipContext';

interface TablesReachedProps {
  /** The filters in effect (what the inside sees, for a step that changes them). */
  context: EvalContext;
  /** Tables the measure's code names: always shown, even in a big model. */
  usedTables: readonly string[];
  /** Folded to one line (Brief). */
  folded: boolean;
}

/** Up to this many tables are drawn; a bigger model shows the ones that matter and counts the rest. */
const MAX_TABLES = 10;
const BOX_HEIGHT = 26;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

interface Placed {
  reach: TableReach;
  x: number;
  y: number;
  width: number;
  rows: boolean;
}

/**
 * "Tables reached": a small drawing of the model's tables and relationships, showing which tables the
 * filters at this step sit on, which ones they reach through relationships (and which way they flow),
 * and which they don't. Click a table to see why.
 */
export function TablesReached({ context, usedTables, folded }: TablesReachedProps) {
  const found = useFilterReach(context);
  const [selected, setSelected] = useState<string | null>(null);

  if (!found) {
    return folded ? null : (
      <p className="value-note tables-reached-none">Connect to a report to see how the filters spread between its tables.</p>
    );
  }

  const { model, reach } = found;
  const touched = reach.tables.filter((t) => t.state !== 'not-reached');
  const cleared = reach.tables.filter((t) => t.removed.length > 0);
  const summary =
    (touched.length === 0
      ? 'No table is filtered here.'
      : `Filters reach ${touched.length} of ${reach.tables.length} tables: ${touched.map((t) => t.table).join(', ')}.`) +
    (cleared.length === 0 ? '' : ` Filters removed here: ${cleared.map(removedText).join('; ')}.`);
  // Drawn as the relationships are at this point (after USERELATIONSHIP and CROSSFILTER).
  const layout = placeTables(reach.model, reach, usedTables, context);
  const chosen = selected ? reach.tables.find((t) => same(t.table, selected)) : undefined;

  return (
    <details className="tables-reached" open={!folded}>
      <summary>
        <span className="tables-reached-title">Tables reached</span>
        <span className="muted">
          {touched.length} of {reach.tables.length}
          {model.source === 'example' ? ' · built-in example model' : ''}
        </span>
      </summary>
      <svg className="tables-map" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={summary}>
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="flow-arrow-head" />
          </marker>
          <marker id="idle-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="idle-arrow-head" />
          </marker>
        </defs>
        {layout.edges.map(({ r, a, b, offset }, i) => {
          const flowing = reach.flowing.includes(r);
          const [ex1, ey1] = edgePoint(a, b);
          const [ex2, ey2] = edgePoint(b, a);
          // Two relationships between the same tables are drawn side by side.
          const length = Math.hypot(ex2 - ex1, ey2 - ey1) || 1;
          const [nx, ny] = [-(ey2 - ey1) / length, (ex2 - ex1) / length];
          const [x1, y1, x2, y2] = [ex1 + nx * offset, ey1 + ny * offset, ex2 + nx * offset, ey2 + ny * offset];
          // Arrow heads point the way a filter can travel: from the one side to the many side (both ways if set so).
          // A filter on a whole table goes the other way, to the tables it looks up (a is the "to" end).
          const againstFlow = reach.against.includes(r);
          const towardB = !againstFlow && !r.cut && flowFrom({ ...r, active: true }, a.reach.table).kind === 'flows';
          const towardA = againstFlow || (!r.cut && flowFrom({ ...r, active: true }, b.reach.table).kind === 'flows');
          const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
          const marker = `url(#${flowing ? 'flow' : 'idle'}-arrow)`;
          // a is the relationship's "to" table, b its "from" table.
          const endA = r.toMany ? '*' : '1';
          const endB = r.fromMany ? '*' : '1';
          return (
            <g key={i} className={['map-edge', flowing ? 'is-flowing' : '', r.active ? '' : 'is-inactive', r.changedBy ? 'is-changed' : '', r.cut ? 'is-cut' : ''].filter(Boolean).join(' ')}>
              <title>{`${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]${r.active ? '' : ' (inactive)'}${r.bothDirections ? ', filters both ways' : ''}${r.cut ? ', carries no filter here' : ''}${r.changedBy ? ` — changed here by ${r.changedBy}` : ''}${r.switchedOffBy ? ` — switched off here, because ${r.switchedOffBy} uses another relationship` : ''}`}</title>
              <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={r.active && towardB ? marker : undefined} markerStart={r.active && towardA ? marker : undefined} />
              <text className="map-cardinality" x={label(x1, y1, x2, y2, r.active && towardA)[0]} y={label(x1, y1, x2, y2, r.active && towardA)[1]} textAnchor="middle">
                {endA}
              </text>
              <text className="map-cardinality" x={label(x2, y2, x1, y1, r.active && towardB)[0]} y={label(x2, y2, x1, y1, r.active && towardB)[1]} textAnchor="middle">
                {endB}
              </text>
              {r.changedBy && (
                // Away from the 1 / * labels; for side-by-side relationships, on the outer side of its own lane.
                <text className="map-change" x={mx + nx * 12 * (offset > 0 ? 1 : -1)} y={my + ny * 12 * (offset > 0 ? 1 : -1) + 3.5} textAnchor="middle">
                  {r.cut ? '✕ ' : ''}
                  {r.changedBy}
                </text>
              )}
            </g>
          );
        })}
        {reach.treatAs.map(({ from, to }, i) => {
          const a = layout.boxes.find((b) => same(b.reach.table, from));
          const b = layout.boxes.find((x) => same(x.reach.table, to));
          if (!a || !b || a === b) return null;
          const [x1, y1] = edgePoint(a, b);
          const [x2, y2] = edgePoint(b, a);
          return (
            <g key={`t${i}`} className="map-treatas">
              <title>{`TREATAS: the values from ${from} filter ${to}, as if through a relationship`}</title>
              <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#flow-arrow)" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle">
                TREATAS
              </text>
            </g>
          );
        })}
        {layout.boxes.map((p) => (
          <g
            key={p.reach.table}
            className={`map-table is-${p.reach.state}${p.reach.removed.length > 0 ? ' is-cleared' : ''}${selected && same(selected, p.reach.table) ? ' is-selected' : ''}`}
            onClick={() => setSelected(selected && same(selected, p.reach.table) ? null : p.reach.table)}
            role="button"
            tabIndex={0}
            aria-label={`${p.reach.table}: ${stateText(p.reach)}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelected(p.reach.table);
              }
            }}
          >
            <rect x={p.x - p.width / 2} y={p.y - BOX_HEIGHT / 2} width={p.width} height={BOX_HEIGHT} rx="5" />
            {p.reach.state === 'filtered' && <circle cx={p.x - p.width / 2 + 9} cy={p.y} r="3.5" className="map-dot" />}
            {p.reach.removed.length > 0 && (
              <g className="map-cleared" aria-hidden="true">
                <circle cx={p.x + p.width / 2 - 1} cy={p.y - BOX_HEIGHT / 2 + 1} r="6.5" />
                <path d={`M${p.x + p.width / 2 - 4} ${p.y - BOX_HEIGHT / 2 + 1} h6`} />
              </g>
            )}
            <text x={p.x + (p.reach.state === 'filtered' ? 5 : 0)} y={p.y + 4} textAnchor="middle">
              {p.reach.table}
            </text>
            {p.rows && (
              <text className="map-rows" x={p.x} y={p.y + BOX_HEIGHT / 2 + 11} textAnchor="middle">
                row by row
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="map-key" aria-hidden="true">
        <span className="map-key-flow" /> a filter travels this way here
        <span className="map-key-idle" /> relationship, no filter on it here
        <span className="map-key-inactive" /> inactive
      </p>
      <p className="tables-reached-detail">{chosen ? explain(chosen, touched.length) : `${summary} Click a table to see how.`}</p>
      {layout.hidden > 0 && <p className="value-note">+ {layout.hidden} other tables, not drawn (none of them is filtered or used here).</p>}
      {reach.unknown.length > 0 && <p className="value-note">Not checked: which tables {reach.unknown.join('; ')} filters.</p>}
      {reach.problems.map((p, i) => (
        <p key={i} className="value-note map-problem">
          {p.charAt(0).toUpperCase() + p.slice(1)}.
        </p>
      ))}
      {reach.unchecked.length > 0 && (
        <p className="value-note">
          Not checked: which way filters flow through the many-to-many relationship{reach.unchecked.length > 1 ? 's' : ''}{' '}
          {reach.unchecked.map((r) => `${r.fromTable} – ${r.toTable}`).join(', ')}.
        </p>
      )}
    </details>
  );
}

function stateText(t: TableReach): string {
  const removed = t.removed.length > 0 ? `; filters removed: ${removedText(t)}` : '';
  if (t.state === 'filtered') return `filtered here${removed}`;
  if (t.state === 'reached') return `reached through relationships${removed}`;
  return `not reached${removed}`;
}

/** "Product[Category]", or "all of Sales". */
function removedText(t: TableReach): string {
  return t.removed.map((what) => (what === 'all' ? `all of ${t.table}` : what.startsWith('all but') ? `${t.table}, ${what}` : `${t.table}[${what}]`)).join(', ');
}

/** The sentence under the map for a clicked table. */
function explain(t: TableReach, touched: number): string {
  const removed = t.removed.length > 0 ? ` Filters on ${removedText(t)} are removed at this point, so any report filter there no longer applies.` : '';
  return explainState(t, touched) + removed;
}

function explainState(t: TableReach, touched: number): string {
  if (t.state === 'filtered') return `${t.table} is filtered here: ${t.filters.join('; ')}.`;
  if (t.state === 'reached' && t.expanded) return `${t.table} is filtered too: ${pathText(t)}.`;
  if (t.state === 'reached') return `${t.table} is filtered through relationships: ${pathText(t)}.`;
  if (touched === 0) return `${t.table} isn't filtered: no table is.`;
  return `No filter reaches ${t.table}. Filters travel along a relationship from the one side (1) to the many side (*), unless it is set to filter both ways, and inactive relationships (dashed) carry none.`;
}

/** Tables to draw, and where: the most connected one in the middle, its neighbours around it, the rest further out. */
function placeTables(model: RelationshipModel, reach: FilterReach, usedTables: readonly string[], context: EvalContext) {
  const byName = (name: string) => reach.tables.find((t) => same(t.table, name));
  let shown = reach.tables;
  let hidden = 0;
  if (shown.length > MAX_TABLES) {
    const important = reach.tables.filter((t) => t.state !== 'not-reached' || usedTables.some((u) => same(u, t.table)));
    const neighbours = model.relationships
      .flatMap((r) => (important.some((t) => same(t.table, r.fromTable) || same(t.table, r.toTable)) ? [r.fromTable, r.toTable] : []))
      .map(byName)
      .filter((t): t is TableReach => t !== undefined);
    const set = [...important];
    for (const t of neighbours) if (set.length < MAX_TABLES + 2 && !set.includes(t)) set.push(t);
    hidden = reach.tables.length - set.length;
    shown = set;
  }
  const isShown = (name: string) => shown.some((t) => same(t.table, name));
  const edges0 = model.relationships.filter((r) => isShown(r.fromTable) && isShown(r.toTable));
  const degree = (t: TableReach) => edges0.filter((r) => same(r.fromTable, t.table) || same(r.toTable, t.table)).length;
  const center = [...shown].sort((a, b) => degree(b) - degree(a))[0];
  const neighbourOf = (a: string, b: string) => edges0.some((r) => (same(r.fromTable, a) && same(r.toTable, b)) || (same(r.toTable, a) && same(r.fromTable, b)));
  const ring1 = shown.filter((t) => t !== center && center && neighbourOf(center.table, t.table));
  const ring2 = shown.filter((t) => t !== center && !ring1.includes(t));

  const width = ring2.length > 0 ? 640 : 540;
  const height = ring2.length > 0 ? 250 : 190;
  const cx = width / 2;
  const cy = height / 2;
  const rowTables = context.rows.flatMap((r) => (r.table.kind === 'table' ? [r.table.table] : r.table.kind === 'columns' ? r.table.columns.map((c) => c.table) : []));
  const place = (t: TableReach, x: number, y: number): Placed => ({
    reach: t,
    x,
    y,
    width: Math.max(60, t.table.length * 7.2 + 26),
    rows: rowTables.some((r) => same(r, t.table)),
  });
  const boxes: Placed[] = [];
  if (center) boxes.push(place(center, cx, cy));
  const ring = (list: TableReach[], rx: number, ry: number, offset: number) =>
    list.forEach((t, i) => {
      const angle = -Math.PI / 2 + offset + (2 * Math.PI * i) / Math.max(list.length, 1);
      boxes.push(place(t, cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)));
    });
  ring(ring1, ring2.length > 0 ? 170 : 185, ring2.length > 0 ? 62 : 68, 0);
  ring(ring2, 270, 105, Math.PI / Math.max(ring2.length, 2));
  // Keep every box inside the drawing.
  for (const b of boxes) {
    b.x = Math.min(Math.max(b.x, b.width / 2 + 4), width - b.width / 2 - 4);
    b.y = Math.min(Math.max(b.y, BOX_HEIGHT / 2 + 4), height - BOX_HEIGHT / 2 - 14);
  }
  const at = (name: string) => boxes.find((b) => same(b.reach.table, name))!;
  // Relationships between the same two tables get their own lane (offset sideways), so they don't overlap.
  const lanes = new Map<string, number>();
  const edges = edges0.map((r: Relationship) => {
    const pair = [r.fromTable.toLowerCase(), r.toTable.toLowerCase()].sort().join('|');
    const count = edges0.filter((x) => [x.fromTable.toLowerCase(), x.toTable.toLowerCase()].sort().join('|') === pair).length;
    const lane = lanes.get(pair) ?? 0;
    lanes.set(pair, lane + 1);
    return { r, a: at(r.toTable), b: at(r.fromTable), offset: count === 1 ? 0 : (lane - (count - 1) / 2) * 12 };
  });
  return { width, height, boxes, edges, hidden };
}

/**
 * Where to write the 1 or * for the end at (x1, y1): a little along the line and off to its side, further
 * along when an arrowhead sits at that end, so the two never overlap.
 */
function label(x1: number, y1: number, x2: number, y2: number, arrowHere: boolean): [number, number] {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  const along = arrowHere ? 24 : 12;
  return [x1 + ux * along - uy * 10, y1 + uy * along + ux * 10 + 3.5];
}

/** Where the line from box `a` towards box `b` leaves a's border. */
function edgePoint(a: Placed, b: Placed): [number, number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return [a.x, a.y];
  const scale = Math.min(Math.abs(a.width / 2 / (dx || 1e-9)), Math.abs(BOX_HEIGHT / 2 / (dy || 1e-9)));
  return [a.x + dx * Math.min(scale, 1), a.y + dy * Math.min(scale, 1)];
}
