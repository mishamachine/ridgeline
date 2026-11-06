// The one place that hands a file to the phone's share sheet. A native wrapper can replace this later; keep the shape.
export interface ShareArgs {
  files: File[];
  title: string;
  text: string;
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

/** Web Share Level 2 with files; falls back to saving the image and copying the link. */
export const shareFiles: ShareFiles = async ({ files, title, text, url }) => {
  try {
    if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files })) {
      await navigator.share({ files, title, text, url });
      return { status: 'shared', copied: false };
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return { status: 'cancelled', copied: false };
  }
  files.forEach(download);
  return { status: 'fallback', copied: await copyLink(url) };
};
