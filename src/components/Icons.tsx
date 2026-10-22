type P = { size?: number };
const base = (size = 20) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const SearchIcon = ({ size }: P) => <svg {...base(size)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const BackIcon = ({ size }: P) => <svg {...base(size)}><path d="M15 5l-7 7 7 7" /></svg>;
export const ChevronIcon = ({ size }: P) => <svg {...base(size)}><path d="M9 5l7 7-7 7" /></svg>;
export const LocateIcon = ({ size }: P) => <svg {...base(size)}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
export const SwapIcon = ({ size }: P) => <svg {...base(size)}><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>;
