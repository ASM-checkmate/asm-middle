// Small inline SVG glyphs (the deck uses ink-outlined icons in chrome; emoji only inside option tiles/categories).
export type GlyphName = 'book' | 'close' | 'back' | 'refresh' | 'check' | 'moon' | 'sparkle' | 'ring' | 'friends' | 'home';

const INK = '#2A2118';
const PAPER = '#FFF6E6';

export function Glyph({ name, size = 22, color = INK }: { name: GlyphName; size?: number; color?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'glyph', 'aria-hidden': true };
  switch (name) {
    case 'book':
      return (
        <svg {...common}>
          <path d="M12 6.6c-1.7-1.5-3.9-2.1-6.6-2.1v13.2c2.7 0 4.9.6 6.6 2.1 1.7-1.5 3.9-2.1 6.6-2.1V4.5c-2.7 0-4.9.6-6.6 2.1z" fill={PAPER} />
          <path d="M12 6.6v13.2" />
          <path d="M8.2 9.2h1.6M8.2 12.2h1.6" strokeWidth={1.8} />
        </svg>
      );
    case 'close':
      return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case 'back':
      return <svg {...common}><path d="M14.5 5.5L8 12l6.5 6.5" /></svg>;
    case 'refresh':
      return <svg {...common}><path d="M19 12a7 7 0 1 1-2.1-5" /><path d="M19 4v4.5h-4.5" /></svg>;
    case 'check':
      return <svg {...common}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
    case 'moon':
      return <svg {...common}><path d="M15.5 3.5a8.5 8.5 0 1 0 5 15.5 7 7 0 0 1-5-15.5z" fill="#FFC64D" /></svg>;
    case 'friends':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={PAPER} />
          <path d="M2.5 19.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" fill={PAPER} />
          <circle cx="16.5" cy="8" r="3.2" fill="#FFC64D" />
          <path d="M15 13.2c3.6 0 6.5 2.4 6.5 6" />
        </svg>
      );
    case 'ring':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" fill={PAPER} />
          <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18" strokeWidth={1.6} />
          <path d="M12 3.5A8.5 8.5 0 0 1 20.5 12H12z" fill="#FF6A48" stroke="none" />
          <path d="M12 12L3.5 12A8.5 8.5 0 0 1 12 3.5z" fill="#FFC64D" stroke="none" />
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="3" fill={PAPER} />
        </svg>
      );
    case 'sparkle':
      return <svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="#FFC64D" /></svg>;
    case 'home':
      // the owner's house: the small "서울 09:12" pill in the chrome wears it
      return (
        <svg {...common}>
          <path d="M6 11v8.5h12V11" fill={PAPER} />
          <path d="M3.5 12.5L12 4.5l8.5 8" />
          <path d="M10 19.5v-5h4v5" fill="#FF6A48" />
        </svg>
      );
  }
}
