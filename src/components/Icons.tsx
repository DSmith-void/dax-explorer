/** Small line icons, drawn inline (no icon library). Decorative: the buttons that use them carry their own labels. */
const PATHS = {
  prev: 'M13 4.5 6.5 10l6.5 5.5',
  next: 'M7 4.5l6.5 5.5L7 15.5',
  edit: 'M4 16h3l8.5-8.5-3-3L4 13zM11 6l3 3',
  filter: 'M3.5 4.5h13l-5 6v5l-3-1.5v-3.5z',
  rows: 'M3.5 5h13M3.5 10h13M3.5 15h13',
  transition: 'M4 7h10l-3-3M16 13H6l3 3',
  variable: 'M7 4c-2 2-2 10 0 12M13 4c2 2 2 10 0 12M8.5 8l3 4M11.5 8l-3 4',
  steps: 'M4 5h2M4 10h2M4 15h2M9 5h7M9 10h7M9 15h7',
  logo: 'M7 5 3 10l4 5M13 5l4 5-4 5M11 4 9 16',
  data: 'M4 5.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5-6-1.1-6-2.5zM4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={['icon', className].filter(Boolean).join(' ')}
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
