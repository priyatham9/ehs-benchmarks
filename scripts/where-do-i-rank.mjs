/**
 * Where does an establishment rank? Reads only committed data:
 *   docs/data/benchmarks/<sector>.json   peer percentiles (CY2025 filings)
 *   outputs/shrinkage_by_naics2.csv      empirical-Bayes prior per 2-digit sector
 *
 * Usage:  npm run build && node scripts/where-do-i-rank.mjs \
 *           --naics 236220 --cases 5 --hours 1000000 [--employees 480] [--json]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { priorFromCsv, selectPeerGroup, whereDoIRank } from '../dist/index.js';

const { values } = parseArgs({
  options: {
    naics: { type: 'string' },
    cases: { type: 'string' },
    hours: { type: 'string' },
    employees: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});
const fail = (m) => { console.error(`error: ${m}`); process.exit(1); };
if (!values.naics || values.cases === undefined || values.hours === undefined) {
  fail('required: --naics <code> --cases <recordable cases> --hours <employee hours> [--employees <n>] [--json]');
}
const cases = Number(values.cases);
const hours = Number(values.hours);
const employees = values.employees === undefined ? undefined : Number(values.employees);
if (!Number.isInteger(cases) || cases < 0) fail('--cases must be a non-negative integer');
if (!Number.isFinite(hours) || hours <= 0) fail('--hours must be a positive number');
if (!/^\d{2,6}$/.test(values.naics)) fail('--naics must be 2 to 6 digits');

const sector = values.naics.slice(0, 2);
let groups;
try {
  groups = JSON.parse(readFileSync(resolve('docs/data/benchmarks', `${sector}.json`), 'utf8'));
} catch {
  fail(`no committed peer file for sector ${sector}`);
}
const peer = selectPeerGroup(groups, values.naics, employees);
if (!peer) fail(`no committed peer group for NAICS ${values.naics}`);
const prior = priorFromCsv(readFileSync(resolve('outputs/shrinkage_by_naics2.csv'), 'utf8'), sector);
if (!prior) fail(`no committed shrinkage prior for sector ${sector} (fewer than 300 establishments)`);

const r = whereDoIRank({ cases, hours, prior, distribution: peer.distribution });
if (values.json) {
  console.log(JSON.stringify({ peerGroup: peer.key, note: peer.note, priorYear: prior.year, ...r }, null, 2));
} else {
  const f = (x) => x.toFixed(2);
  const p = (x) => Math.round(x);
  console.log(`Peer group: NAICS ${peer.naics}, ${peer.sizeBand === 'all' ? 'all sizes' : peer.sizeBand} (${peer.distribution.n.toLocaleString()} establishments)`);
  if (peer.note) console.log(`Note: ${peer.note}`);
  console.log(`Raw TRIR:     ${f(r.raw)}  (exact 95% interval ${f(r.garwood[0])} to ${f(r.garwood[1])})`);
  console.log(`Shrunk TRIR:  ${f(r.shrunk)}  (95% credible ${f(r.credible[0])} to ${f(r.credible[1])}; ${p(r.weight * 100)}% weight on industry rate)`);
  console.log(`Percentile:   ${p(r.percentile)}  (95% range ${p(r.percentileRange[0])} to ${p(r.percentileRange[1])}; model-free range ${p(r.garwoodPercentileRange[0])} to ${p(r.garwoodPercentileRange[1])}; raw-rate percentile ${p(r.rawPercentile)})`);
  console.log(`\n${r.caveat}`);
}
