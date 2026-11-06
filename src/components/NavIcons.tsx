type P = { size?: number; filled?: boolean };
const base = (size = 24) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const FindIcon = ({ size }: P) => <svg {...base(size)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const SavedIcon = ({ size, filled }: P) => <svg {...base(size)} fill={filled ? 'currentColor' : 'none'}><path d="M6 3h12v18l-6-4.5L6 21z" /></svg>;
export const HikeIcon = ({ size }: P) => <svg {...base(size)}><path d="M3 20l6-10 4 6 3-4 5 8z" /><path d="M9 10V4l4 1.5L9 7" /></svg>;
export const ProfileIcon = ({ size }: P) => <svg {...base(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg>;
export const ShareIcon = ({ size }: P) => <svg {...base(size)}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>;
export const DriveIcon = ({ size }: P) => <svg {...base(size)}><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v3H3z" /><circle cx="7.5" cy="13.5" r=".8" fill="currentColor" /><circle cx="16.5" cy="13.5" r=".8" fill="currentColor" /></svg>;
export const DownloadIcon = ({ size }: P) => <svg {...base(size)}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>;
export const CheckIcon = ({ size }: P) => <svg {...base(size)}><path d="M5 12.5l4.5 4.5L19 7" /></svg>;
export const ListIcon = ({ size }: P) => <svg {...base(size)}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>;
export const MapIcon = ({ size }: P) => <svg {...base(size)}><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></svg>;
export const CloseIcon = ({ size }: P) => <svg {...base(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
