interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional tooltip text. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group, e.g. "Color theme". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A row of mutually exclusive buttons (a radio group styled as a switch). */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          className={value === option.value ? 'is-active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
