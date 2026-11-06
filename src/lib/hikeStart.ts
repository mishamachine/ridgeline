/** What "Start hike" does while a hike may already be running. */
export type StartAction = 'start' | 'resume' | 'confirm';

export function startAction(current: { id: string } | null, next: { id: string }): StartAction {
  if (!current) return 'start';
  return current.id === next.id ? 'resume' : 'confirm';
}
