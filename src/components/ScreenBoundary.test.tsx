import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoadFailed, ScreenBoundary } from './ScreenBoundary';

describe('ScreenBoundary', () => {
  it('turns a failed chunk load into a message with a Reload button', () => {
    expect(ScreenBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const h = renderToStaticMarkup(<LoadFailed />);
    expect(h).toContain('Couldn’t load this screen');
    expect(h).toContain('>Reload<');
  });
  it('renders its children when nothing failed', () => {
    expect(renderToStaticMarkup(<ScreenBoundary><p>ok</p></ScreenBoundary>)).toBe('<p>ok</p>');
  });
});
