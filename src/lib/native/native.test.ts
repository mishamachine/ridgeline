import { describe, it, expect } from 'vitest';
import { parseTrailLink } from './links';
import { trailBase } from '../cells';
import { isNative } from './platform';
import { share } from './share';

describe('native helpers', () => {
  it('is not native under test', () => expect(isNative()).toBe(false));

  it('uses the site root only in the native apps', () => {
    expect(trailBase(false)).toBe('/trails/');
    expect(trailBase(true)).toBe('https://hike.bbprojectfactory.com/trails/');
  });

  it('reads trail ids from app links', () => {
    expect(parseTrailLink('https://hike.bbprojectfactory.com/trail/relation-123')).toBe('relation-123');
    expect(parseTrailLink('https://hike.bbprojectfactory.com/trail/way-9/')).toBe('way-9');
    expect(parseTrailLink('https://hike.bbprojectfactory.com/privacy')).toBeNull();
    expect(parseTrailLink('https://example.com/trail/1')).toBeNull();
    expect(parseTrailLink('not a url')).toBeNull();
  });

  it('falls back to copying the link when the browser cannot share', async () => {
    const written: string[] = [];
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (s: string) => { written.push(s); } } } });
    expect(await share({ text: 'Mount Si', url: 'https://hike.bbprojectfactory.com/trail/1' })).toBe('copied');
    expect(written).toEqual(['Mount Si https://hike.bbprojectfactory.com/trail/1']);
  });
});
