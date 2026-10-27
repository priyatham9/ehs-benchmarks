import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { priorFromCsv, selectPeerGroup, whereDoIRank } from '../src/index.js';

const read = (p: string) => readFileSync(p, 'utf8');

describe('docs/rank.html page uses the library and committed data', () => {
  const js = read('docs/rank.js');
  const html = read('docs/rank.html');

  it('imports the three library functions from the shipped docs/lib build and reimplements nothing', () => {
    expect(js).toMatch(/import \{[^}]*whereDoIRank[^}]*\} from '\.\/lib\/index\.js'/);
    expect(js).toMatch(/import \{[^}]*selectPeerGroup[^}]*\} from '\.\/lib\/index\.js'/);
    expect(js).toMatch(/import \{[^}]*priorFromCsv[^}]*\} from '\.\/lib\/index\.js'/);
    expect(js).not.toMatch(/Math\.(exp|log|sqrt)|lgamma|OSHA_HOURS_BASIS|200000|200_000/);
  });

  it('sends nothing out: only same-origin static GETs, no beacons, no POST, no absolute URLs', () => {
    expect(js).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|method:\s*['"]POST|https?:\/\//i);
    const fetches = [...js.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
    expect(fetches.length).toBeGreaterThan(0);
    for (const a of fetches) expect(a).toMatch(/^[`']data\//);
    expect(html).not.toMatch(/<form[^>]*\saction=/i);
  });

  it('carries the non-affiliation and not-a-compliance-tool disclaimers', () => {
    expect(html).toMatch(/not affiliated with/i);
    expect(html).toMatch(/not a compliance tool/i);
  });

  it('data files the page fetches are byte-identical to the committed outputs', () => {
    expect(read('docs/data/shrinkage_by_naics2.csv')).toBe(read('outputs/shrinkage_by_naics2.csv'));
  });

  it('docs/lib build returns exactly what src returns for NAICS 236220', async () => {
    const lib = await import('../docs/lib/index.js');
    const groups = JSON.parse(read('docs/data/benchmarks/23.json'));
    const csv = read('docs/data/shrinkage_by_naics2.csv');
    const prior = priorFromCsv(csv, '23')!;
    const peer = selectPeerGroup(groups, '236220', 480)!;
    const want = whereDoIRank({ cases: 5, hours: 1_000_000, prior, distribution: peer.distribution });
    const libPrior = lib.priorFromCsv(csv, '23')!;
    const libPeer = lib.selectPeerGroup(groups, '236220', 480)!;
    const got = lib.whereDoIRank({ cases: 5, hours: 1_000_000, prior: libPrior, distribution: libPeer.distribution });
    expect(got).toEqual(want);
    expect(Math.round(got.percentile)).toBe(54); // README example
  });
});
