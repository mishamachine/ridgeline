// A one-line message that fades after a moment. The Toaster in App.tsx shows it.
type Listener = (msg: string | null) => void;
let listener: Listener = () => {};
let timer: ReturnType<typeof setTimeout> | undefined;

export const onToast = (l: Listener) => { listener = l; return () => { listener = () => {}; }; };

export function toast(msg: string, ms = 2600) {
  listener(msg);
  clearTimeout(timer);
  timer = setTimeout(() => listener(null), ms);
}
