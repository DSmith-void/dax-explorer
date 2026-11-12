import { useRef } from 'react';
import { Icon, type IconName } from './Icons';

interface SplitterProps {
  /** "vertical": a border between columns (drag sideways). "horizontal": between rows (drag up and down). */
  orientation: 'vertical' | 'horizontal';
  label: string;
  /** Called while dragging, with how far the pointer moved since the last call, in pixels. */
  onDrag: (deltaPx: number) => void;
  /** Called on a double-click: back to the default size. */
  onReset?: () => void;
}

/**
 * A border that can be dragged to resize what is on either side, like Power BI's pane edges. Also works
 * from the keyboard: focus it and use the arrow keys (Shift for bigger steps).
 */
export function Splitter({ orientation, label, onDrag, onReset }: SplitterProps) {
  const last = useRef<number | null>(null);
  const vertical = orientation === 'vertical';
  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      title={`${label}: drag to resize${onReset ? ', double-click to reset' : ''}`}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = vertical ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const now = vertical ? e.clientX : e.clientY;
        if (now !== last.current) onDrag(now - last.current);
        last.current = now;
      }}
      onPointerUp={(e) => {
        last.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 12;
        const back = vertical ? 'ArrowLeft' : 'ArrowUp';
        const forward = vertical ? 'ArrowRight' : 'ArrowDown';
        if (e.key === back) onDrag(-step);
        else if (e.key === forward) onDrag(step);
        else return;
        e.preventDefault();
      }}
    />
  );
}

/**
 * A collapsed section: a thin strip with its symbol and title, in the section's colour, like a collapsed
 * Power BI pane. Click to open it.
 */
export function PaneStrip({ title, icon, tone = 'muted', onOpen }: { title: string; icon: IconName; tone?: 'accent' | 'filter' | 'technical' | 'muted'; onOpen: () => void }) {
  return (
    <button type="button" className={`pane-strip strip-${tone}`} onClick={onOpen} title={`Show ${title}`} aria-label={`Show ${title}`}>
      <span className="pane-strip-chevron" aria-hidden="true">
        ›
      </span>
      <Icon name={icon} />
      <span className="pane-strip-title">{title}</span>
    </button>
  );
}

/** The small button in a section's header that collapses it. */
export function CollapseButton({ title, onClick, direction = 'left' }: { title: string; onClick: () => void; direction?: 'left' | 'up' }) {
  return (
    <button type="button" className="collapse-button" onClick={onClick} title={`Hide ${title}`} aria-label={`Hide ${title}`}>
      <span aria-hidden="true">{direction === 'left' ? '‹' : '▴'}</span>
    </button>
  );
}
