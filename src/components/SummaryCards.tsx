import type { EvalContext } from '../engine/context/model';
import type { TimelineEntry } from '../engine/context/timeline';
import { Icon, type IconName } from './Icons';

interface SummaryCardsProps {
  entries: readonly TimelineEntry[];
  index: number;
  onStep: (index: number) => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const hasTransition = (e: TimelineEntry) => e.operations.some((op) => op.kind === 'context-transition');

/** The context in effect once this step has happened (what the calculation inside sees). */
function effectiveContext(entry: TimelineEntry | undefined): EvalContext | null {
  return entry ? (entry.innerContext ?? entry.context) : null;
}

/**
 * Four facts about the current step, in the style of a debugger's summary cards. Each card jumps to
 * the next step where that thing happens.
 */
export function SummaryCards({ entries, index, onStep }: SummaryCardsProps) {
  const current = entries[index];
  const context = effectiveContext(current);
  const soFar = entries.slice(0, index + 1);

  const changes = context ? context.filter.entries.length + context.filter.removals.length : 0;
  const rows = context?.rows ?? [];
  const transitions = soFar.filter(hasTransition).length;
  const variables = soFar.filter((e) => e.kind === 'variable').length;

  /** The next step (after the current one, else from the start) that matches. */
  const nextWhere = (test: (e: TimelineEntry) => boolean) =>
    entries.find((e) => e.index > index && test(e)) ?? entries.find(test) ?? null;

  const cards: { key: string; label: string; icon: IconName; value: string; detail: string; target: TimelineEntry | null; jump: string }[] = [
    {
      key: 'filters',
      label: 'Filters',
      icon: 'filter',
      value: context?.unknownReason ? 'Unknown' : changes === 0 ? "Report's filters" : `F + ${plural(changes, 'change', 'changes')}`,
      detail: 'in effect at this step',
      target: nextWhere((e) => e.kind === 'calculate' || e.kind === 'filter-input'),
      jump: 'Go to the next step that changes the filters',
    },
    {
      key: 'rows',
      label: 'Row by row',
      icon: 'rows',
      value: rows.length === 0 ? 'No' : rows.map((r) => r.functionName).join(' › '),
      detail: rows.length === 0 ? 'no current row' : 'has a current row',
      target: nextWhere((e) => e.kind === 'iterate'),
      jump: 'Go to the next step that goes row by row',
    },
    {
      key: 'transitions',
      label: 'Context transitions',
      icon: 'transition',
      value: `${transitions}`,
      detail: 'so far: a row turned into a filter',
      target: nextWhere(hasTransition),
      jump: 'Go to the next context transition',
    },
    {
      key: 'variables',
      label: 'Variables',
      icon: 'variable',
      value: `${variables}`,
      detail: 'stored so far',
      target: nextWhere((e) => e.kind === 'variable'),
      jump: 'Go to the next variable',
    },
  ];

  return (
    <div className="summary-cards">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          className="summary-card"
          disabled={!card.target}
          title={card.target ? card.jump : `Nothing like this in this measure`}
          onClick={() => card.target && onStep(card.target.index)}
        >
          <span className="summary-card-label">{card.label}</span>
          <span className="summary-card-value">
            <Icon name={card.icon} />
            {card.value}
          </span>
          <span className="summary-card-detail">{card.detail}</span>
        </button>
      ))}
    </div>
  );
}
