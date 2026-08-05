import React, { useMemo } from 'react';

// Eager URL map — survives Vite/Rollup tree-shaking (dynamic Flags[code] did not).
const FLAG_URLS = import.meta.glob(
  '../../node_modules/country-flag-icons/3x2/*.svg',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>;

function flagUrlFor(code: string): string | null {
  const upper = code.toUpperCase();
  const key = Object.keys(FLAG_URLS).find((k) => k.endsWith(`/${upper}.svg`));
  return key ? FLAG_URLS[key] : null;
}

/** SVG flag pack — works on Windows where flag emoji fonts are missing. */
export const CountryFlag: React.FC<{ code?: string | null; className?: string; title?: string }> = ({
  code,
  className = 'w-3.5 h-[11px]',
  title,
}) => {
  const src = useMemo(() => (code ? flagUrlFor(code) : null), [code]);
  if (!src || !code) return null;

  return (
    <img
      src={src}
      alt={title || code.toUpperCase()}
      title={title || code.toUpperCase()}
      className={`inline-block shrink-0 rounded-[1px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)] ${className}`}
      draggable={false}
    />
  );
};
