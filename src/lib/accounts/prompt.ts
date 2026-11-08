// The guest prompt: a soft card that offers sign-in when a guest has made something worth keeping.
// Rules: each kind shows once; "Not now" counts; after 3 dismissals it stops for good; never during a hike,
// before the tour is done, while signed in, or while accounts are off.
export type PromptKind = 'save' | 'hike' | 'badge';
export interface PromptState { shown: Partial<Record<PromptKind, true>>; dismissals: number }
export interface PromptContext { accountsOn: boolean; signedIn: boolean; onboardingDone: boolean; hikeActive: boolean }

export const MAX_DISMISSALS = 3;
export const PROMPT_KEY = 'ridgeline:guestPrompt';
export const EMPTY_PROMPT_STATE: PromptState = { shown: {}, dismissals: 0 };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadPromptState(s: Store): PromptState {
  try {
    const raw = JSON.parse(s.getItem(PROMPT_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...EMPTY_PROMPT_STATE, shown: {} };
    const shown: PromptState['shown'] = {};
    for (const k of ['save', 'hike', 'badge'] as const) if (raw.shown?.[k] === true) shown[k] = true;
    return { shown, dismissals: Number.isInteger(raw.dismissals) && raw.dismissals > 0 ? raw.dismissals : 0 };
  } catch { return { ...EMPTY_PROMPT_STATE, shown: {} }; }
}
export function savePromptState(s: Store, st: PromptState) { try { s.setItem(PROMPT_KEY, JSON.stringify(st)); } catch { /* private mode: it may show again next launch */ } }

/** True when at least one of the kinds has not been shown yet and nothing blocks the card. */
export function canShow(kinds: PromptKind[], st: PromptState, ctx: PromptContext): boolean {
  if (!ctx.accountsOn || ctx.signedIn || !ctx.onboardingDone || ctx.hikeActive) return false;
  if (st.dismissals >= MAX_DISMISSALS) return false;
  return kinds.some((k) => !st.shown[k]);
}

/** Showing a card uses up every kind it stands for (the first hike and its first badge share one card). */
export const markShown = (st: PromptState, kinds: PromptKind[]): PromptState => ({ ...st, shown: { ...st.shown, ...Object.fromEntries(kinds.map((k) => [k, true])) } });
export const dismiss = (st: PromptState): PromptState => ({ ...st, dismissals: st.dismissals + 1 });
