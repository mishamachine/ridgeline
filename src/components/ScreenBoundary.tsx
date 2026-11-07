import { Component, Suspense, type ReactNode } from 'react';
import { Placeholder } from './Bobo';

export function LoadFailed() {
  return (
    <div className="placeholder" role="alert">
      <div className="placeholder-title">Couldn’t load this screen</div>
      <div className="placeholder-body"><button className="btn btn-primary" onClick={() => location.reload()}>Reload</button></div>
    </div>
  );
}

/** Catches a screen whose chunk failed to load, so the rest of the app keeps working. */
export class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <LoadFailed /> : this.props.children; }
}

/** A screen that loads on demand: the static Bobo while it loads, "Couldn't load this screen · Reload" if it cannot. */
export const Later = ({ children }: { children: ReactNode }) => (
  <ScreenBoundary><Suspense fallback={<Placeholder title="Loading…" />}>{children}</Suspense></ScreenBoundary>
);
