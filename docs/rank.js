/**
 * "Where do I rank?" page. A thin wrapper: all maths is whereDoIRank,
 * selectPeerGroup and priorFromCsv from the compiled library in ./lib, the same
 * code and the same committed data as scripts/where-do-i-rank.mjs.
 * Inputs stay in the browser; only static data files are fetched.
 */
import { whereDoIRank, selectPeerGroup, priorFromCsv } from './lib/index.js';

const $ = (id) => document.getElementById(id);
const f2 = (x) => x.toFixed(2);
const p0 = (x) => String(Math.round(x));

let csvPromise;
const loadCsv = () => (csvPromise ??= fetch('data/shrinkage_by_naics2.csv').then((r) => {
  if (!r.ok) throw new Error('could not load prior data');
  return r.text();
}));

/** Pure: parsed strings in, result or error message out (given loaded data). */
export function computeRank({ cases, hours, naics, employees }, groups, csv) {
  const prior = priorFromCsv(csv, naics.slice(0, 2));
  if (!prior) return { error: `No committed shrinkage prior for sector ${naics.slice(0, 2)} (fewer than 300 establishments).` };
  const peer = selectPeerGroup(groups, naics, employees);
  if (!peer) return { error: `No committed peer group for NAICS ${naics}.` };
  return { peer, prior, result: whereDoIRank({ cases, hours, prior, distribution: peer.distribution }) };
}

function parse() {
  const cases = Number($('cases').value.trim());
  const hours = Number($('hours').value.trim().replace(/,/g, ''));
  const naics = $('naics').value.trim();
  const empText = $('employees').value.trim();
  const employees = empText === '' ? undefined : Number(empText);
  if ($('cases').value.trim() === '' || !Number.isInteger(cases) || cases < 0) return { error: 'Cases must be a non-negative whole number.' };
  if (!Number.isFinite(hours) || hours <= 0) return { error: 'Hours must be a positive number.' };
  if (!/^\d{2,6}$/.test(naics)) return { error: 'NAICS must be 2 to 6 digits.' };
  if (employees !== undefined && (!Number.isFinite(employees) || employees < 0)) return { error: 'Employees must be a non-negative number.' };
  return { cases, hours, naics, employees };
}

async function run(ev) {
  ev.preventDefault();
  $('error').hidden = true;
  $('result').hidden = true;
  const input = parse();
  if (input.error) { $('error').textContent = input.error; $('error').hidden = false; return; }
  try {
    const [csv, groups] = await Promise.all([
      loadCsv(),
      fetch(`data/benchmarks/${input.naics.slice(0, 2)}.json`).then((r) => {
        if (!r.ok) throw new Error(`No committed peer file for sector ${input.naics.slice(0, 2)}.`);
        return r.json();
      }),
    ]);
    const out = computeRank(input, groups, csv);
    if (out.error) throw new Error(out.error);
    const { peer, prior, result: r } = out;
    $('peer').textContent = `Peer group: NAICS ${peer.naics}, ${peer.sizeBand === 'all' ? 'all sizes' : peer.sizeBand} (${peer.distribution.n.toLocaleString()} establishments; prior year ${prior.year}).` + (peer.note ? ` Note: ${peer.note}.` : '');
    $('raw').textContent = f2(r.raw);
    $('shrunk').textContent = `${f2(r.shrunk)} (${p0(r.weight * 100)}% weight on industry rate)`;
    $('percentile').textContent = p0(r.percentile);
    $('credible').textContent = `${f2(r.credible[0])} to ${f2(r.credible[1])}`;
    $('prange').textContent = `${p0(r.percentileRange[0])} to ${p0(r.percentileRange[1])}`;
    $('garwood').textContent = `${f2(r.garwood[0])} to ${f2(r.garwood[1])}`;
    $('gprange').textContent = `${p0(r.garwoodPercentileRange[0])} to ${p0(r.garwoodPercentileRange[1])}`;
    $('rawp').textContent = p0(r.rawPercentile);
    $('caveat').textContent = r.caveat;
    $('result').hidden = false;
  } catch (e) {
    $('error').textContent = e.message;
    $('error').hidden = false;
  }
}

if (typeof document !== 'undefined' && $('rank-form')) $('rank-form').addEventListener('submit', run);
