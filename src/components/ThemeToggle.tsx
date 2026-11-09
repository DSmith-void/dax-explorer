import type { ThemePreference } from '../app/useThemePreference';
import { SegmentedControl } from './SegmentedControl';

interface ThemeToggleProps {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  return <SegmentedControl label="Color theme" options={OPTIONS} value={value} onChange={onChange} />;
}
