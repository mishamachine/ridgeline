import { describe, it, expect } from 'vitest';
import { onboardingCards } from './Onboarding';

const text = (f: Parameters<typeof onboardingCards>[0], loc = true) => onboardingCards(f, loc).map((c) => `${c.title} ${c.body}`).join(' ');

describe('onboarding copy is true for this build', () => {
  const web = { voice: false, screenOff: false, badges: true };
  it('web today: no voice or screen-off claims; says Ridgeline keeps the screen on', () => {
    const t = text(web);
    expect(t).toContain('Keep your eyes on the trail');
    expect(t).toContain('Ridgeline buzzes if you go off route and keeps the screen on while you hike.');
    expect(t).not.toMatch(/spoken|voice|talks you|screen off/i);
  });
  it('voice without screen-off still does not promise screen-off', () => {
    const t = text({ voice: true, screenOff: false, badges: true });
    expect(t).toMatch(/spoken/);
    expect(t).toContain('Keep your phone in your pocket; Ridgeline keeps the screen on while you hike.');
    expect(t).not.toMatch(/screen off/i);
  });
  it('screen-off claim only when both ship', () => expect(text({ voice: true, screenOff: true, badges: true })).toMatch(/screen off/));
  it('badges card only when badges ship', () => {
    expect(onboardingCards({ ...web, badges: false }, true).some((c) => c.id === 'badges')).toBe(false);
    expect(onboardingCards(web, true).some((c) => c.id === 'badges')).toBe(true);
  });
  it('at most 5 cards; location is last and absent on replay', () => {
    const full = onboardingCards({ voice: true, screenOff: true, badges: true }, true);
    expect(full.length).toBeLessThanOrEqual(5);
    expect(full.at(-1)!.id).toBe('location');
    expect(onboardingCards(web, false).some((c) => c.id === 'location')).toBe(false);
  });
  it('location card states the privacy promises', () => {
    const loc = onboardingCards(web, true).at(-1)!;
    expect(loc.body).toContain('location');
    expect(onboardingCards(web, true).at(-1)!.id).toBe('location');
  });
});
