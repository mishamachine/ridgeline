import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HikeSummary } from '../lib/hype';
import { Celebrate } from './Celebrate';
import { Landing } from './Landing';

const summary: HikeSummary = {
  trail: { id: 'osm-r123', name: 'Rattlesnake Ledge', highlights: ['Views', 'Lake'] },
  distanceM: 6115, climbFt: 1540, movingMs: 161 * 60000,
  startedAt: new Date(2026, 10, 7, 9, 0).getTime(), endedAt: new Date(2026, 10, 7, 12, 0).getTime(),
  highlightsHit: ['Views', 'Waterfall'], completedFraction: 1, track: [],
};
const noop = () => {};
const html = (s: HikeSummary, extra = {}) => renderToStaticMarkup(<Celebrate summary={s} onDone={noop} onShareApp={noop} {...extra} />);

describe('Celebrate', () => {
  it('hypes with real stats and one share button', () => {
    const h = html(summary, { newBadges: [{ name: 'Ledge Sitter', sub: 'Your 4th badge.' }] });
    expect(h).toContain('1,540 ft up.');
    expect(h).toContain('Share my hike');
    expect(h).toContain('>Done<');
    expect(h).toContain("Know someone who&#x27;d love this? Share Ridgeline");
    expect(h).toContain('New badge: Ledge Sitter');
    expect(h.match(/Share my hike/g)).toHaveLength(1);
  });
  it('shows only highlights that are on the trail', () => {
    const h = html(summary);
    expect(h).toContain('>Views<');
    expect(h).not.toContain('Waterfall');
  });
  it('has no badge card when there is no new badge', () => {
    expect(html(summary)).not.toContain('New badge');
  });
  it('does not say summit when the hike was cut short', () => {
    const h = html({ ...summary, completedFraction: 0.5 });
    expect(h.toLowerCase()).not.toMatch(/summit|crushed|complete/);
    expect(h).toContain('3.8 miles on Rattlesnake Ledge.');
  });
});

describe('Landing', () => {
  const stats = { miles: 3.8, climbFt: 1540, time: '2:41' };
  it('names the trail and shows the shared stats', () => {
    const h = renderToStaticMarkup(<Landing trail={{ name: 'Rattlesnake Ledge' }} stats={stats} onGetApp={noop} onSeeTrail={noop} />);
    expect(h).toContain('Your friend just hiked Rattlesnake Ledge.');
    expect(h).toContain('3.8 mi · 1,540 ft climbed · 2:41. Your turn?');
    expect(h).toContain('Get Ridgeline, free');
    expect(h).toContain('See this trail first');
  });
  it('falls back for an unknown trail and hides the trail button', () => {
    const h = renderToStaticMarkup(<Landing stats={{}} onGetApp={noop} onSeeTrail={noop} />);
    expect(h).toContain('Your friend just hiked a Ridgeline trail.');
    expect(h).not.toContain('Your turn');
    expect(h).not.toContain('See this trail first');
  });
  it('only promises turn-by-turn when voice is on', () => {
    expect(renderToStaticMarkup(<Landing stats={stats} onGetApp={noop} />)).toContain('Clear trail maps and your progress');
    expect(renderToStaticMarkup(<Landing stats={stats} features={{ voice: true }} onGetApp={noop} />)).toContain('Turn-by-turn at trail forks');
    expect(renderToStaticMarkup(<Landing stats={stats} onGetApp={noop} />)).not.toContain('Turn-by-turn');
  });
  it('hides store buttons while the store links are empty', () => {
    expect(renderToStaticMarkup(<Landing stats={stats} platform="ios" onGetApp={noop} />)).not.toContain('App Store');
    expect(renderToStaticMarkup(<Landing stats={stats} platform="ios" storeUrls={{ ios: 'https://example.test/x' }} onGetApp={noop} />)).toContain('Get it on the App Store');
  });
  it('escapes a hostile trail name', () => {
    const h = renderToStaticMarkup(<Landing trail={{ name: '<img src=x onerror=alert(1)>' }} stats={{}} onGetApp={noop} />);
    expect(h).not.toContain('<img src=x');
  });
});
