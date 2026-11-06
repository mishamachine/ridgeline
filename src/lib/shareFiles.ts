import { count } from './counter';

// The one place that hands a file to the phone's share sheet. A native wrapper can replace this later; keep the shape.
export interface ShareArgs {
  files: File[];
  title: string;
  /** Must already contain the link. */
  text: string;
  /** Copied to the clipboard on the fallback path. */
  url: string;
}
export interface ShareOutcome {
  status: 'shared' | 'fallback' | 'cancelled';
  /** Fallback only: whether the link made it to the clipboard. */
  copied: boolean;
}
export type ShareFiles = (args: ShareArgs) => Promise<ShareOutcome>;

function download(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const copyLink = async (url: string): Promise<boolean> => {
  try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
};

/** Web Share Level 2 with files and text only (iOS Safari drops files when a url is sent too, so `text` carries the link). Falls back to saving the image and copying the link. */
export const shareFiles: ShareFiles = async ({ files, title, text, url }) => {
  try {
    if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files })) {
      await navigator.share({ files, title, text });
      count('share');
      return { status: 'shared', copied: false };
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return { status: 'cancelled', copied: false };
  }
  files.forEach(download);
  const copied = await copyLink(url);
  if (files.length > 0 || copied) count('share'); // only when a file was saved or the link copied
  return { status: 'fallback', copied };
};
