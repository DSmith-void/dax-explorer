import type { ReactNode } from 'react';

interface PanelProps {
  id: string;
  title: string;
  /** Optional short status label shown beside the title, e.g. "Planned". */
  status?: string;
  /** Extra controls rendered at the right of the panel header. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A titled card used for every region of the workspace. */
export function Panel({ id, title, status, actions, className, children }: PanelProps) {
  const headingId = `${id}-heading`;
  return (
    <section className={['panel', className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <header className="panel-header">
        <h2 id={headingId}>{title}</h2>
        {status && <span className="status-badge">{status}</span>}
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
