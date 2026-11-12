import { useEffect, useRef } from 'react';

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

/** "How to read this": a short guide for first-time users. */
export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      aria-labelledby="help-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (outside the content) closes the guide.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="help-content">
        <header className="help-header">
          <h2 id="help-title">How to read DAX Explorer</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Close (Esc)">
            <span aria-hidden="true">✕</span>
            <span className="visually-hidden">Close</span>
          </button>
        </header>

        <section>
          <h3>1. Pick a measure</h3>
          <p>
            Choose one from the list at the top, or press <strong>Write your own DAX</strong> to paste a measure. The built-in
            examples use the made-up Initech company. To use your own model, open the <strong>data</strong> button at the top
            right.
          </p>
        </section>

        <section>
          <h3>2. Step through it</h3>
          <p>
            Press <strong>Next</strong> (or the <kbd>→</kbd> key) to go through the calculation one step at a time;{' '}
            <kbd>←</kbd> goes back, <kbd>Home</kbd> and <kbd>End</kbd> jump to the first and last step. You can also drag the
            timeline, or click any part of the code to jump to its step.
          </p>
          <p>
            When a step calculates another measure, <strong>Step into</strong> shows that measure&apos;s own steps right after it,
            in a colored band, from &quot;Enter [Measure]&quot; to &quot;Back in …&quot;. Next and Previous walk in and out; the
            names above the code show where you are, and clicking one goes back out. Press Next instead to step over it.
          </p>
          <p className="muted">
            The steps follow the logical order DAX defines, not the order the Power BI engine physically runs a query in.
          </p>
        </section>

        <section>
          <h3>3. Read the step</h3>
          <dl className="help-terms">
            <dt>F</dt>
            <dd>The filters coming from the report: wherever the measure is shown (a row of a table visual, slicers, …).</dd>
            <dt>Filters</dt>
            <dd>The filters in effect at this step. &quot;F + 1 change&quot; means one filter was added or removed.</dd>
            <dt>Row by row</dt>
            <dd>Whether a function such as SUMX or FILTER is going through a table one row at a time (row context).</dd>
            <dt>Context transitions</dt>
            <dd>How often a current row has been turned into a filter so far (it happens when a measure or CALCULATE is used row by row).</dd>
            <dt>Tables reached</dt>
            <dd>
              A small map of the model&apos;s tables, under the filters. A dot marks a table with a filter on it; tinted tables
              are filtered through a relationship, and the arrows show which way filters can travel (from the 1 side to the
              * side). A minus badge means filters are removed from that table at this step. Click a table to see why.
            </dd>
            <dt>Variables</dt>
            <dd>How many VARs have been stored so far. A stored variable keeps its value, even inside a later CALCULATE.</dd>
          </dl>
        </section>

        <section>
          <h3>Colors in the code</h3>
          <p className="help-colors">
            <span className="syn-function">FUNCTIONS</span> <span className="syn-table">Tables</span>{' '}
            <span className="syn-bracketed">[Measures and columns]</span> <span className="syn-keyword">VAR RETURN</span>{' '}
            <span className="syn-string">&quot;text&quot;</span> <span className="syn-number">123</span>{' '}
            <span className="is-current-sample">the current step</span>
          </p>
        </section>

        <section>
          <h3>Technical, and arranging the screen</h3>
          <p>
            The Technical box uses DAX&apos;s own terms (filter context, row context, context transition) and shows the exact query
            behind each value, to copy into DAX Studio. Drag the borders between sections to resize them, or fold a section away with
            its ‹ button. Everything runs on this computer.
          </p>
        </section>
      </div>
    </dialog>
  );
}
