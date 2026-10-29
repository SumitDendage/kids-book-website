import { useId } from 'react';

/* the AI assistant's mark: a silver robot head in a speech bubble, with headphone ears */
export default function AIMark() {
  const g = 'aiMark' + useId().replace(/[^\w-]/g, '');   /* each copy needs its own gradient id */
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef3fb" /><stop offset="0.35" stopColor="#a9bde0" /><stop offset="0.6" stopColor="#c9b6f0" /><stop offset="0.8" stopColor="#e4ecf8" /><stop offset="1" stopColor="#9fb2d9" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${g})`} strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M77 72 A36 36 0 1 0 68 79.5 C72 81 76 83 79.5 85.5 C78.5 81 77.5 76.5 77 72Z" />
        <path d="M14.6 41.5 H11 A4.5 4.5 0 0 0 6.5 46 V56 A4.5 4.5 0 0 0 11 60.5 H16.2 M85.4 41.5 H89 A4.5 4.5 0 0 1 93.5 46 V56 A4.5 4.5 0 0 1 89 60.5 H83.8" />
        <rect x="26" y="35" width="48" height="33.5" rx="12" />
      </g>
      <circle cx="39.7" cy="49" r="4.4" fill={`url(#${g})`} />
      <circle cx="60.3" cy="49" r="4.4" fill={`url(#${g})`} />
    </svg>
  );
}
