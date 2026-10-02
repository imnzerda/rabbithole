import { afterEach, describe, expect, it, vi } from 'vitest';
import { languageViews } from '../src/pageviews.js';

afterEach(() => vi.unstubAllGlobals());

describe('vues par lots', () => {
  it('suit la continuation : les vues arrivent par morceaux', async () => {
    const responses = [
      { query: { pages: [{ title: 'A', pageviews: { d1: 5, d2: 5 } }, { title: 'B' }] }, continue: { pvipcontinue: 'B', continue: '||' } },
      { query: { normalized: [{ from: 'b_x', to: 'B' }], pages: [{ title: 'A' }, { title: 'B', pageviews: { d1: 7, d2: null } }] } },
    ];
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    const views = await languageViews('en', ['A', 'b_x'], 0);
    expect(views).toEqual(new Map([['A', 10], ['b_x', 7]]));
    expect(urls[1]).toContain('pvipcontinue=B');
  });
});
