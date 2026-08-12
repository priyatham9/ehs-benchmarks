/**
 * ehs-benchmarks — site controller.
 *
 * Imports the compiled ehs-metrics library directly, so the percentile a
 * visitor sees is produced by the same tested code that built the published
 * benchmark files.
 */
import { normalizeName, scoreMatch, rankAgainst, trir, checkPlausibility } from './lib/index.js';

const DATA = 'data';
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
};
const fmt = (n, d = 0) =>
  n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => (n == null ? '—' : `${Number(n).toFixed(d)}%`);

const cache = new Map();

/**
 * Every data file is requested with the dataset's build stamp as a query
 * parameter. Without it, a browser holding a previously cached shard manifest
 * requests files that no longer exist after the dataset is rebuilt — the
 * shard layout changes whenever the underlying data does. findings.json is
 * fetched once with a live timestamp to obtain that stamp.
 */
let buildStamp = null;
async function version() {
  if (buildStamp === null) {
    const r = await fetch(`${DATA}/findings.json?t=${Date.now()}`);
    if (!r.ok) throw new Error(`findings.json: ${r.status}`);
    const f = await r.json();
    buildStamp = f.generated ?? 'dev';
    cache.set('findings.json', Promise.resolve(f));
  }
  return buildStamp;
}

async function load(path) {
  const v = await version();
  if (!cache.has(path)) {
    cache.set(path, fetch(`${DATA}/${path}?v=${encodeURIComponent(v)}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

const SECTOR_NAMES = {
  11: 'Agriculture, forestry, fishing', 21: 'Mining, quarrying, oil & gas', 22: 'Utilities',
  23: 'Construction', 31: 'Manufacturing (food, textile)', 32: 'Manufacturing (wood, chemical, plastics)',
  33: 'Manufacturing (metal, machinery, transport)', 42: 'Wholesale trade', 44: 'Retail trade',
  45: 'Retail trade', 48: 'Transportation', 49: 'Transportation & warehousing',
  51: 'Information', 52: 'Finance & insurance', 53: 'Real estate', 54: 'Professional & technical',
  55: 'Management of companies', 56: 'Administrative & waste services', 61: 'Educational services',
  62: 'Health care & social assistance', 71: 'Arts, entertainment & recreation',
  72: 'Accommodation & food services', 81: 'Other services', 92: 'Public administration',
};
const sectorLabel = (code) => `${code} · ${SECTOR_NAMES[code] ?? 'Other'}`;
const BANDS = ['20-49', '50-99', '100-249', '250-499', '500-999', '1000+'];

/* ==========================================================================
   SVG chart primitives — deliberately small, no library, nothing decorative.
   ========================================================================== */

const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return n;
}

/** Horizontal bars. `items`: [{label, value, note}] */
function hbar(items, { width = 760, rowH = 26, labelW = 250, fmtValue = (v) => fmt(v) } = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const h = items.length * rowH + 8;
  const barW = width - labelW - 96;
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${h}`, role: 'img' });
  items.forEach((it, i) => {
    const y = i * rowH + 4;
    root.append(
      svg('text', { x: 0, y: y + 15, class: 'label-strong' }, it.label.length > 34 ? it.label.slice(0, 33) + '…' : it.label),
      svg('rect', { class: 'bar', x: labelW, y: y + 5, width: Math.max(1, (it.value / max) * barW), height: rowH - 13 }),
      svg('text', { x: labelW + barW + 8, y: y + 15 }, fmtValue(it.value)),
    );
  });
  return root;
}

/** Vertical columns for a distribution over ordered bins. */
function columns(values, labels, { width = 760, height = 220, highlight = -1, fmtValue = (v) => fmt(v) } = {}) {
  const padL = 44, padB = 30, padT = 12;
  const max = Math.max(...values, 1);
  const plotW = width - padL - 12;
  const plotH = height - padB - padT;
  const bw = plotW / values.length;
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });

  for (let g = 0; g <= 4; g++) {
    const y = padT + (plotH * g) / 4;
    root.append(
      svg('line', { class: 'grid', x1: padL, y1: y, x2: width - 12, y2: y }),
      svg('text', { x: padL - 8, y: y + 3, 'text-anchor': 'end' }, fmt(Math.round((max * (4 - g)) / 4))),
    );
  }
  values.forEach((v, i) => {
    const bh = (v / max) * plotH;
    root.append(svg('rect', {
      class: i === highlight ? 'bar' : 'bar',
      x: padL + i * bw + 2,
      y: padT + plotH - bh,
      width: Math.max(1, bw - 4),
      height: Math.max(0, bh),
      opacity: highlight >= 0 && i !== highlight ? 0.55 : 1,
    }));
    root.append(svg('title', {}, `${labels[i]}: ${fmtValue(v)}`));
    if (values.length <= 16 || i % 2 === 0) {
      root.append(svg('text', { x: padL + i * bw + bw / 2, y: height - 10, 'text-anchor': 'middle' }, labels[i]));
    }
  });
  root.append(svg('line', { class: 'axis', x1: padL, y1: padT + plotH, x2: width - 12, y2: padT + plotH }));
  return root;
}

/** Percentile strip: quartile bands with the visitor's rate marked. */
function percentileStrip(p, rate, rank) {
  const width = 760, height = 96, padL = 8, padR = 8;
  const scaleMax = Math.max(p.p99, rate) * 1.06 || 1;
  const x = (v) => padL + (Math.min(v, scaleMax) / scaleMax) * (width - padL - padR);
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });
  const bandY = 30, bandH = 26;

  const bands = [
    [0, p.p25, 0.95], [p.p25, p.p50, 0.72], [p.p50, p.p75, 0.5], [p.p75, p.p90, 0.3], [p.p90, scaleMax, 0.16],
  ];
  for (const [a, b, op] of bands) {
    root.append(svg('rect', { class: 'bar', x: x(a), y: bandY, width: Math.max(0, x(b) - x(a)), height: bandH, opacity: op }));
  }
  for (const [key, label] of [['p25', 'p25'], ['p50', 'median'], ['p75', 'p75'], ['p90', 'p90']]) {
    root.append(
      svg('line', { class: 'grid', x1: x(p[key]), y1: bandY, x2: x(p[key]), y2: bandY + bandH + 6 }),
      svg('text', { x: x(p[key]), y: bandY + bandH + 19, 'text-anchor': 'middle' }, `${label} ${p[key].toFixed(2)}`),
    );
  }
  root.append(
    svg('line', { class: 'marker', x1: x(rate), y1: bandY - 12, x2: x(rate), y2: bandY + bandH + 2 }),
    svg('text', { x: x(rate), y: bandY - 17, 'text-anchor': 'middle', class: 'label-strong' }, `you ${rate.toFixed(2)} · p${Math.round(rank)}`),
  );
  return root;
}

/** Small multi-year sparkline for a sector row. */
function spark(values, { width = 90, height = 22 } = {}) {
  const clean = values.filter((v) => v != null);
  if (clean.length < 2) return document.createTextNode('—');
  const min = Math.min(...clean), max = Math.max(...clean);
  const span = max - min || 1;
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height });
  const pts = clean.map((v, i) => `${(i / (clean.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / span) * (height - 8)}`);
  root.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--green)', 'stroke-width': 2 }));
  return root;
}

/** A collapsible drill-down block. */
function drill(summaryText, buildBody) {
  const d = el('details', { class: 'drill' }, el('summary', {}, summaryText));
  let built = false;
  d.addEventListener('toggle', () => {
    if (d.open && !built) { built = true; d.append(el('div', { class: 'drill-body' }, buildBody())); }
  });
  return d;
}

function table(headers, rows) {
  const thead = el('thead', {}, el('tr', {}, headers.map((h) =>
    el('th', { class: h.num ? 'num' : null }, h.label ?? h))));
  const tbody = el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) =>
    el('td', { class: typeof c === 'object' && c?.num ? 'num' : null }, typeof c === 'object' && c !== null && !(c instanceof Node) ? c.v : c)))));
  return el('div', { class: 'scroll-x' }, el('table', {}, thead, tbody));
}
const num = (v) => ({ num: true, v });

/* ==========================================================================
   Views
   ========================================================================== */

async function renderFindings() {
  const [f, oiics] = await Promise.all([load('findings.json'), load('oiics.json')]);

  $('#findings-tiles').replaceChildren(
    el('div', { class: 'tiles' },
      tile('Establishment filings read', fmt(f.totalRows), `${f.years[0]}–${f.years[f.years.length - 1]}, three calendar years`, 'plain'),
      tile('Corrected national TRIR', f.correctedTrir.toFixed(2), 'recordables per 100 FTE per year'),
      tile('If you skip the cleaning', f.naiveTrir.toFixed(2), `wrong by a factor of ${f.errorFactor}`, 'alarm'),
      tile('Injury cases coded', fmt(f.caseRows), `mean ${f.meanDaysAway} days away per case`, 'plain'),
    ),
  );

  // ---- Finding 1: hours ----
  const sectorRows = f.excludedBySector.map((s) => [
    sectorLabel(s.s), num(fmt(s.implausible)), num(fmt(s.zero)), num(fmt(Math.round(s.hours / 1e9)) + 'B'),
  ]);
  const extremeRows = f.extremeRecords.map((r) => [
    r.name, r.state, r.naics, num(r.year),
    num(r.hours.toExponential(2)), num(fmt(r.employees)), num(fmt(r.perEmployee)),
  ]);

  $('#finding-hours').replaceChildren(
    el('div', { class: 'prose' },
      el('p', { html:
        `Only <strong>${pct(f.excludedShare, 2)}</strong> of filings fail a basic plausibility test — but those ` +
        `few records carry <strong>${pct(f.hoursDiscardedShare)}</strong> of every hour reported to OSHA. ` +
        `Sum the hours column as published and the national TRIR reads <strong>${f.naiveTrir.toFixed(2)}</strong>. ` +
        `Drop the impossible records and it is <strong>${f.correctedTrir.toFixed(2)}</strong> — ` +
        `<strong>${f.errorFactor}× higher</strong>. Any benchmark built on the raw file is wrong by roughly that factor.` }),
    ),
    el('div', { class: 'callout' },
      el('h3', {}, 'The test'),
      el('p', { style: 'margin:0', html:
        'Hours worked divided by average employees must land between 100 and 4,000 per year. ' +
        'Below that, hours were reported in the wrong unit; above it, a data-entry error. ' +
        `<strong>${fmt(f.extremeRecordCount)}</strong> filings report more than 100,000 hours per employee.` }),
    ),
    drill(`Which sectors the excluded records come from · ${f.excludedBySector.length} sectors`, () =>
      table(['Sector', { label: 'Implausible hrs/emp', num: true }, { label: 'Zero hours', num: true }, { label: 'Hours excluded', num: true }], sectorRows)),
    drill(`The ten most extreme filings · public record`, () =>
      el('div', {},
        el('p', { class: 'muted', style: 'font-size:12px;margin:8px 0' },
          'These are unedited public filings. The right-hand column is hours per employee per year; a full-time worker is about 2,000.'),
        table(['Establishment', 'State', 'NAICS', { label: 'Year', num: true }, { label: 'Hours filed', num: true }, { label: 'Employees', num: true }, { label: 'Hrs/employee', num: true }], extremeRows))),
  );

  // ---- Finding 2: zero inflation ----
  const chem = await load('benchmarks/32.json').catch(() => null);
  const chemDist = chem?.['325|all'];
  $('#finding-zero').replaceChildren(
    el('div', { class: 'prose' },
      el('p', { html:
        'Injury-rate distributions are not bell curves — they spike hard at zero. In chemical manufacturing ' +
        `(NAICS 325), <strong>${chemDist ? pct(chemDist.zeroRate * 100) : '—'}</strong> of establishments report no recordable case at all, ` +
        `while the 90th percentile sits at <strong>${chemDist ? chemDist.trir.p90.toFixed(2) : '—'}</strong>. ` +
        'A mean is meaningless against a distribution shaped like that, and "we had zero" is a statement about ' +
        'establishment size as much as about safety performance.' }),
    ),
    chemDist ? el('div', {},
      el('div', { class: 'legend' }, el('span', {}, 'NAICS 325 · chemical manufacturing · TRIR percentiles')),
      hbar(
        [['p10', chemDist.trir.p10], ['p25', chemDist.trir.p25], ['p50 (median)', chemDist.trir.p50],
         ['p75', chemDist.trir.p75], ['p90', chemDist.trir.p90], ['p95', chemDist.trir.p95], ['p99', chemDist.trir.p99]]
          .map(([label, value]) => ({ label, value })),
        { labelW: 120, fmtValue: (v) => v.toFixed(2) },
      ),
    ) : el('p', { class: 'empty' }, 'Chemical-sector distribution unavailable.'),
  );

  // ---- Finding 3: shift timing ----
  const shiftLabels = oiics.hourIntoShift.map((_, i) => `${i}`);
  const peak = oiics.hourIntoShift.indexOf(Math.max(...oiics.hourIntoShift));
  const firstFour = oiics.hourIntoShift.slice(0, 4).reduce((a, b) => a + b, 0);
  $('#finding-shift').replaceChildren(
    el('div', { class: 'prose' },
      el('p', { html:
        `${fmt(oiics.withShiftTiming)} cases record both shift start and incident time, so we can place each injury ` +
        `inside the working day. Injuries peak in hour <strong>${peak}</strong> of the shift, and ` +
        `<strong>${pct((firstFour / oiics.withShiftTiming) * 100)}</strong> occur in the first four hours — ` +
        'not at the fatigued end of the day, where safety programmes usually aim their attention.' }),
    ),
    columns(oiics.hourIntoShift, shiftLabels, { highlight: peak }),
    el('div', { class: 'legend' }, el('span', {}, 'X: full hours elapsed since shift start · Y: recorded cases')),
  );
}

function tile(label, value, sub, variant = '') {
  return el('div', { class: 'tile' },
    el('div', { class: 'tile-label' }, label),
    el('div', { class: `tile-value ${variant}` }, value),
    el('div', { class: 'tile-sub' }, sub));
}

/* ---------------- benchmark ---------------- */

let naicsCatalog = null;

async function initBenchmark() {
  naicsCatalog = await load('naics-catalog.json');
  const sectors = [...new Set(Object.values(naicsCatalog).map((v) => v.s))].sort();
  $('#bm-sector').replaceChildren(...sectors.map((s) => el('option', { value: s }, sectorLabel(s))));
  $('#bm-band').replaceChildren(
    el('option', { value: 'all' }, 'All sizes'),
    ...BANDS.map((b) => el('option', { value: b }, `${b} employees`)),
  );
  $('#bm-sector').value = '32';
  refreshNaics();
  $('#bm-sector').addEventListener('change', refreshNaics);
  $('#bm-run').addEventListener('click', runBenchmark);
}

function refreshNaics() {
  const sector = $('#bm-sector').value;
  const opts = Object.entries(naicsCatalog)
    .filter(([, v]) => v.s === sector)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, v]) => el('option', { value: code }, `${code} — ${v.t || 'industry'}`));
  $('#bm-naics').replaceChildren(...opts);
}

async function runBenchmark() {
  const sector = $('#bm-sector').value;
  const naics = $('#bm-naics').value;
  const band = $('#bm-band').value;
  const hours = Number($('#bm-hours').value);
  const cases = Number($('#bm-cases').value);
  const employees = $('#bm-emp').value ? Number($('#bm-emp').value) : undefined;
  const out = $('#bm-result');

  if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(cases) || cases < 0) {
    out.replaceChildren(el('p', { class: 'empty' }, 'Enter a positive hours figure and a non-negative case count.'));
    return;
  }

  const rateResult = trir(
    { deaths: 0, daysAwayCases: 0, jobTransferCases: 0, otherRecordableCases: cases },
    { employeeHours: hours },
    employees === undefined ? {} : { employees },
  );
  const rate = rateResult.value;

  const sectorData = await load(`benchmarks/${sector}.json`).catch(() => ({}));
  let key = `${naics}|${band}`;
  let dist = sectorData[key];
  let fellBack = null;
  if (!dist) {
    for (const cand of [`${naics}|all`, `${naics.slice(0, 4)}|${band}`, `${naics.slice(0, 4)}|all`,
                        `${naics.slice(0, 3)}|all`, `${sector}|all`]) {
      if (sectorData[cand]) { dist = sectorData[cand]; fellBack = cand; break; }
    }
  }
  if (!dist) {
    out.replaceChildren(el('p', { class: 'empty' }, 'No peer group of at least 30 establishments exists for that combination.'));
    return;
  }

  const [dNaics, dBand] = (fellBack ?? key).split('|');
  const ranked = rankAgainst(rate, {
    naics: dNaics, sizeBand: dBand, n: dist.n, zeroRate: dist.zeroRate,
    percentiles: dist.trir, aggregate: dist.trir.aggregate,
  });
  const flags = checkPlausibility({ hours, employees, totalCases: cases });

  out.replaceChildren(el('div', { class: 'result-card' },
    el('div', { style: 'display:flex;gap:26px;align-items:baseline;flex-wrap:wrap' },
      el('div', {},
        el('div', { class: 'tile-label' }, 'Your TRIR'),
        el('div', { class: 'result-rank' }, rate.toFixed(2))),
      el('div', {},
        el('div', { class: 'tile-label' }, 'Percentile (lower is better)'),
        el('div', { class: 'result-rank' }, `p${Math.round(ranked.percentileRank)}`)),
      el('div', { style: 'flex:1;min-width:260px' },
        el('div', { class: 'tile-label' }, 'Peer group'),
        el('div', { class: 'tile-sub', style: 'font-size:13px' },
          `NAICS ${dNaics}${dBand === 'all' ? '' : ` · ${dBand} employees`} · ${fmt(dist.n)} establishments`),
        fellBack ? el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' },
          `Exact group had under 30 filers; widened to ${dNaics}${dBand === 'all' ? ' (all sizes)' : ''}.`) : null),
    ),
    el('p', { class: 'prose', style: 'margin-top:14px' }, ranked.interpretation),
    percentileStrip(dist.trir, rate, ranked.percentileRank),
    flags.length ? el('div', { class: 'callout warn' },
      el('h3', {}, 'Data-quality flags'),
      el('ul', { style: 'margin:6px 0 0;padding-left:18px' },
        flags.map((fl) => el('li', {}, `${fl.severity.toUpperCase()}: ${fl.message}`)))) : null,
    drill('Full percentile table for this peer group', () =>
      table(['Metric', ...['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'].map((p) => ({ label: p, num: true })), { label: 'Hours-weighted', num: true }], [
        ['TRIR', ...['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'].map((p) => num(dist.trir[p].toFixed(2))), num(dist.trir.aggregate.toFixed(2))],
        ['DART', ...['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'].map((p) => num(dist.dart[p].toFixed(2))), num(dist.dart.aggregate.toFixed(2))],
      ])),
  ));
}

/* ---------------- company search ---------------- */

let shardSet = null;
let topCompanies = null;

async function initCompany() {
  [shardSet, topCompanies] = await Promise.all([
    load('company-shards.json').then((a) => new Set(a)),
    load('top-companies.json'),
  ]);
  $('#company-count').textContent = `${fmt(228584)} resolved employers`;
  $('#co-top').replaceChildren(companyTable(topCompanies.slice(0, 40)));

  let timer;
  $('#co-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value;
    timer = setTimeout(() => runCompanySearch(q), 180);
  });
}

function shardFor(key) {
  const clean = key.replace(/[^A-Z0-9]/g, '');
  for (let d = Math.min(6, clean.length); d >= 2; d--) {
    const name = clean.slice(0, d).padEnd(d, '_');
    if (shardSet.has(name)) return name;
  }
  const two = (clean.slice(0, 2) || 'ZZ').padEnd(2, '_');
  return shardSet.has(two) ? two : null;
}

async function runCompanySearch(q) {
  const out = $('#co-results');
  if (!q || q.trim().length < 2) { out.replaceChildren(); return; }
  const { key } = normalizeName(q);
  if (!key) { out.replaceChildren(); return; }

  out.replaceChildren(el('p', { class: 'empty' }, 'Searching…'));
  const shard = shardFor(key);
  let pool = [];
  if (shard) {
    // 's' prefix mirrors the pipeline: Windows cannot write CON.json / AUX.json.
    try { pool = await load(`companies/s${shard}.json`); } catch { pool = []; }
  }
  // Notable employers are also matched on any token, so "pacific" finds
  // Georgia-Pacific even though the shard is keyed on the leading token.
  const extra = topCompanies.filter((c) => scoreMatch(q, c.n).score > 0);
  const seen = new Set();
  const merged = [...pool, ...extra].filter((c) => (seen.has(c.n) ? false : seen.add(c.n)));

  const results = merged
    .map((c) => ({ c, s: scoreMatch(q, c.n).score }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.c.h - a.c.h)
    .slice(0, 30)
    .map((r) => r.c);

  if (!results.length) {
    out.replaceChildren(el('p', { class: 'empty' },
      `No employer matched "${q}". Search matches from the start of the company name as filed.`));
    return;
  }
  out.replaceChildren(el('div', {}, results.map(companyCard)));
}

function companyCard(c) {
  const years = Object.keys(c.y).sort();
  const trend = years.map((y) => c.y[y].t);
  return el('div', { class: 'search-result' },
    el('div', { class: 'search-result-head' },
      el('div', {},
        el('div', { class: 'search-name' }, c.n),
        el('div', { style: 'margin-top:5px' },
          el('span', { class: 'pill' }, `${fmt(c.s)} site${c.s === 1 ? '' : 's'}`),
          el('span', { class: 'pill' }, `NAICS ${c.na}`),
          el('span', { class: 'pill' }, c.st.slice(0, 4).join(' ') + (c.st.length > 4 ? '…' : '')),
          el('span', { class: 'pill green' }, `TRIR ${c.t?.toFixed(2) ?? '—'}`),
          el('span', { class: 'pill' }, `DART ${c.d?.toFixed(2) ?? '—'}`))),
      el('div', { style: 'text-align:right' },
        spark(trend),
        el('div', { class: 'muted', style: 'font-size:10px' }, `${fmt(c.h)} hrs`))),
    drill('Year, state and industry breakdown', () => el('div', {},
      el('h3', { style: 'margin:10px 0 6px' }, 'By year'),
      table(['Year', { label: 'Sites', num: true }, { label: 'Hours', num: true }, { label: 'Recordables', num: true }, { label: 'TRIR', num: true }, { label: 'DART', num: true }],
        years.map((y) => [y, num(fmt(c.y[y].e)), num(fmt(c.y[y].h)), num(fmt(c.y[y].c)),
                          num(c.y[y].t?.toFixed(2) ?? '—'), num(c.y[y].d?.toFixed(2) ?? '—')])),
      c.bs?.length ? el('div', {},
        el('h3', { style: 'margin:16px 0 6px' }, `By state · ${c.bs.length}`),
        table(['State', { label: 'Sites', num: true }, { label: 'Hours', num: true }, { label: 'Recordables', num: true }, { label: 'TRIR', num: true }],
          c.bs.map((s) => [s.s, num(fmt(s.e)), num(fmt(s.h)), num(fmt(s.c)), num(s.t?.toFixed(2) ?? '—')]))) : null,
      c.bn?.length ? el('div', {},
        el('h3', { style: 'margin:16px 0 6px' }, 'By industry'),
        table(['NAICS', 'Industry', { label: 'Establishments', num: true }],
          c.bn.map((n) => [n.c, naicsCatalog?.[n.c]?.t ?? '—', num(fmt(n.e))]))) : null,
    )));
}

function companyTable(list) {
  return table(
    ['Employer', { label: 'Sites', num: true }, { label: 'Hours', num: true }, { label: 'TRIR', num: true }, { label: 'DART', num: true }],
    list.map((c) => [c.n, num(fmt(c.s)), num(fmt(c.h)), num(c.t?.toFixed(2) ?? '—'), num(c.d?.toFixed(2) ?? '—')]),
  );
}

/* ---------------- patterns ---------------- */

async function renderPatterns() {
  const o = await load('oiics.json');

  $('#pt-events').replaceChildren(
    hbar(o.eventDrill.map((e) => ({ label: e.t, value: e.n })), { fmtValue: (v) => fmt(v) }),
    el('div', {}, o.eventDrill.map((e) => drill(
      `${e.t} — ${fmt(e.n)} cases (${pct(e.share)})${e.meanDaysAway ? ` · mean ${e.meanDaysAway} days away` : ''}`,
      () => el('div', { class: 'form-grid' },
        el('div', {}, el('h3', { style: 'margin-bottom:6px' }, 'Body part'),
          table(['Part', { label: 'Cases', num: true }], e.parts.map((p) => [p.t, num(fmt(p.n))]))),
        el('div', {}, el('h3', { style: 'margin-bottom:6px' }, 'Nature of injury'),
          table(['Nature', { label: 'Cases', num: true }], e.natures.map((p) => [p.t, num(fmt(p.n))]))),
        el('div', {}, el('h3', { style: 'margin-bottom:6px' }, 'Sector'),
          table(['Sector', { label: 'Cases', num: true }], e.sectors.map((p) => [sectorLabel(p.t), num(fmt(p.n))]))),
      )))),
  );

  $('#pt-parts').replaceChildren(
    hbar(o.partDrill.map((p) => ({ label: p.t, value: p.n }))),
    el('div', {}, o.partDrill.map((p) => drill(
      `${p.t} — ${fmt(p.n)} cases${p.meanDaysAway ? ` · mean ${p.meanDaysAway} days away` : ''}`,
      () => table(['Event that caused it', { label: 'Cases', num: true }], p.events.map((e) => [e.t, num(fmt(e.n))]))))),
  );

  const peak = o.hourIntoShift.indexOf(Math.max(...o.hourIntoShift));
  $('#pt-shift').replaceChildren(
    columns(o.hourIntoShift, o.hourIntoShift.map((_, i) => `${i}`), { highlight: peak }),
    el('div', { class: 'legend' }, el('span', {}, `${fmt(o.withShiftTiming)} cases with usable start and incident times`)),
  );

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  $('#pt-month').replaceChildren(
    columns(o.month, MONTHS),
    el('div', { class: 'legend' }, el('span', {}, 'Cases by calendar month of incident')),
  );
}

/* ---------------- sectors ---------------- */

async function renderSectors() {
  const [sectors] = await Promise.all([load('sectors.json'), load('naics-catalog.json').then((c) => (naicsCatalog = c))]);
  const rows = Object.entries(sectors)
    .map(([code, d]) => {
      const years = Object.keys(d.years).sort();
      const latest = d.years[years[years.length - 1]];
      return { code, d, years, latest };
    })
    .sort((a, b) => (b.latest?.hours ?? 0) - (a.latest?.hours ?? 0));

  $('#sec-table').replaceChildren(el('div', {}, rows.map(({ code, d, years, latest }) => {
    const trend = years.map((y) => d.years[y].trir);
    return el('div', { class: 'search-result' },
      el('div', { class: 'search-result-head' },
        el('div', {},
          el('div', { class: 'search-name' }, sectorLabel(code)),
          el('div', { style: 'margin-top:5px' },
            el('span', { class: 'pill green' }, `TRIR ${latest.trir.toFixed(2)}`),
            el('span', { class: 'pill' }, `DART ${latest.dart.toFixed(2)}`),
            el('span', { class: 'pill' }, `${fmt(latest.est)} establishments`))),
        el('div', { style: 'text-align:right' }, spark(trend),
          el('div', { class: 'muted', style: 'font-size:10px' }, `${years[0]}–${years[years.length - 1]}`))),
      drill('Year trend and the industries inside this sector', () => el('div', {},
        el('h3', { style: 'margin:10px 0 6px' }, 'Trend'),
        d.hoursSwing >= 1.25 ? el('div', { class: 'callout warn' },
          el('p', { style: 'margin:0' },
            `Read this trend with care. Reported hours per establishment vary by ${d.hoursSwing}× across these ` +
            `years, so part of the rate movement reflects which employers filed rather than a change in safety ` +
            `performance. ITA filing populations are not a fixed panel.`)) : null,
        table(['Year', { label: 'Establishments', num: true }, { label: 'Hours', num: true }, { label: 'TRIR', num: true }, { label: 'DART', num: true }],
          years.map((y) => [y, num(fmt(d.years[y].est)), num(fmt(d.years[y].hours)), num(d.years[y].trir.toFixed(2)), num(d.years[y].dart.toFixed(2))])),
        d.subs?.length ? el('div', {},
          el('h3', { style: 'margin:16px 0 6px' }, `Industries within · top ${d.subs.length} by hours`),
          table(['NAICS', 'Industry', { label: 'Filers', num: true }, { label: 'TRIR', num: true }, { label: 'DART', num: true }],
            d.subs.map((s) => [s.c, s.t || '—', num(fmt(s.n)), num(s.trir.toFixed(2)), num(s.dart.toFixed(2))]))) : null,
      )));
  })));
}

/* ---------------- method ---------------- */

async function renderMethod() {
  const f = await load('findings.json');
  $('#method-body').replaceChildren(
    el('h3', {}, 'Source'),
    el('p', {}, `OSHA Injury Tracking Application establishment-specific 300A summary files for ${f.years.join(', ')}, ` +
      `plus the CY2024–2025 case detail file. ${fmt(f.totalRows)} establishment filings and ${fmt(f.caseRows)} coded cases. ` +
      `Built ${f.generated}.`),

    el('h3', {}, 'Rate definitions'),
    el('p', { html: 'All rates use the OSHA basis of 200,000 hours (100 full-time equivalents at 40 hours for 50 weeks). ' +
      '<strong>TRIR</strong> = (deaths + days-away + job-transfer + other recordable cases) × 200,000 ÷ hours worked. ' +
      '<strong>DART</strong> counts only days-away and job-transfer/restriction cases. Rates are not annualised on top of ' +
      'this basis — the denominator already carries the time normalisation.' }),

    el('h3', {}, 'Inclusion rule'),
    el('p', { html: `A filing is used only if hours worked is positive and, where an employee count is given, hours per ` +
      `employee falls between 100 and 4,000 per year. This excludes ${pct(f.excludedShare, 2)} of filings and ` +
      `${pct(f.hoursDiscardedShare)} of reported hours. The same rule is applied by the published library, so the ` +
      `calculator on this site and the benchmark tables cannot disagree.` }),

    el('h3', {}, 'Percentiles'),
    el('p', {}, 'Nearest-rank, computed on establishments with at least 10,000 hours in the most recent year, in peer ' +
      'groups of at least 30 filers. Interpolation is avoided because these distributions spike at zero and ' +
      'interpolating would invent rates no establishment reported.'),

    el('h3', {}, 'Corporate entity resolution'),
    el('p', {}, 'Establishments are grouped by EIN, but only where the names filed under that EIN agree — measured as ' +
      'the share sharing a modal leading token pair. One EIN in the file carries 9,320 unrelated employers; it is ' +
      'rejected and those records fall back to name-based grouping. Display names are the longest token prefix common ' +
      'to the group, which strips embedded store identifiers.'),

    el('h3', {}, 'Limitations — read these'),
    el('ul', {},
      el('li', {}, 'ITA covers establishments required to submit: generally 100+ employees, or 20–99 in designated ' +
        'higher-hazard industries. It is not a random sample of US workplaces, and its aggregate rate runs above the ' +
        'BLS national figure for that reason. Compare within a peer group, never against the site-wide total.'),
      el('li', {}, 'Everything is self-reported by employers and unaudited. Under-recording is a known and unmeasured ' +
        'problem; a low rate may reflect reporting culture rather than injury frequency.'),
      el('li', {}, 'A single year of establishment data is a small sample. At 200,000 hours one extra case moves TRIR ' +
        'by a full point. Treat any single-establishment rate as noisy.'),
      el('li', {}, 'OIICS codes in the case detail file are model-predicted by OSHA (the "_pred" columns), not ' +
        'human-assigned. They are reliable in aggregate and should not be trusted for any individual case.'),
      el('li', {}, 'Year-over-year comparisons are not a fixed panel. The set of establishments that file changes each ' +
        'year, and reported hours per establishment swing materially in some sectors. A sector trend therefore ' +
        'conflates real change with a change in who reported; sectors where this is largest are flagged in place.'),
      el('li', {}, 'The plausibility test catches unit and keying errors, not scope errors. An employer that files an ' +
        'entire system’s hours and headcount under one establishment passes the test and is counted as one very ' +
        'large site.'),
      el('li', {}, 'Company rollups reflect only establishments that filed. A company with unreported sites will show ' +
        'fewer sites and hours than it truly has.'),
      el('li', {}, 'Company search matches from the start of the name as filed; a firm filing under an unexpected legal ' +
        'name may not surface for its trading name.')),
  );
}

/* ==========================================================================
   Router and boot
   ========================================================================== */

const VIEWS = {
  findings: renderFindings,
  benchmark: initBenchmark,
  company: initCompany,
  patterns: renderPatterns,
  sectors: renderSectors,
  method: renderMethod,
};
const started = new Set();

async function show(name) {
  const view = VIEWS[name] ? name : 'findings';
  for (const s of document.querySelectorAll('section.view')) s.classList.remove('active');
  $(`#view-${view}`).classList.add('active');
  for (const a of document.querySelectorAll('nav.tabs a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (!started.has(view)) {
    started.add(view);
    try {
      await VIEWS[view]();
    } catch (err) {
      started.delete(view);
      $(`#view-${view}`).append(el('p', { class: 'empty' }, `Could not load this view: ${err.message}`));
    }
  }
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => show(location.hash.slice(1)));

(function boot() {
  const stored = localStorage.getItem('ehs-theme');
  if (stored) document.documentElement.dataset.theme = stored;
  $('#theme-toggle').addEventListener('click', () => {
    const now = document.documentElement.dataset.theme;
    const isDark = now ? now === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ehs-theme', next);
  });

  load('findings.json').then((f) => {
    $('#meta-strip').textContent =
      `${fmt(f.totalRows)} filings · ${fmt(f.caseRows)} coded cases · CY${f.years[0]}–CY${f.years[f.years.length - 1]} · built ${f.generated}`;
  }).catch(() => { $('#meta-strip').textContent = 'Data unavailable'; });

  show(location.hash.slice(1) || 'findings');
})();
