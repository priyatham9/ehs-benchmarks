/**
 * ehs-benchmarks — site controller.
 *
 * Imports the compiled ehs-metrics library directly, so the percentile a
 * visitor sees is produced by the same tested code that built the published
 * benchmark files.
 */
import { normalizeName, scoreMatch, rankAgainst, trir, checkPlausibility } from './lib/index.js';

const DATA = 'data';
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
};
const fmt = (n, d = 0) =>
  n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => (n == null ? '—' : `${Number(n).toFixed(d)}%`);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cache = new Map();

/**
 * Every data file is requested with the dataset's build stamp as a query
 * parameter. Without it, a browser holding a previously cached shard manifest
 * requests files that no longer exist after the dataset is rebuilt — the
 * shard layout changes whenever the underlying data does. findings.json is
 * fetched once with a live timestamp to obtain that stamp.
 */
let versionPromise = null;
function version() {
  // Memoise the in-flight promise, not just the resolved value. Callers race on
  // first paint — boot() and the initial view both call load() before any fetch
  // settles — and guarding on the result alone refetches findings.json once per
  // concurrent caller.
  if (versionPromise === null) {
    versionPromise = fetch(`${DATA}/findings.json?t=${Date.now()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`findings.json: ${r.status}`);
        return r.json();
      })
      .then((f) => {
        cache.set('findings.json', Promise.resolve(f));
        return f.generated;
      })
      .catch((err) => {
        versionPromise = null;          // let a later call retry rather than wedge the page
        throw err;
      });
  }
  return versionPromise;
}

async function load(path) {
  const v = await version();
  if (!cache.has(path)) {
    cache.set(path, fetch(`${DATA}/${path}?v=${encodeURIComponent(v)}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }).catch((err) => { cache.delete(path); throw err; }));
  }
  return cache.get(path);
}

/* 44/45 and 48/49 are one NAICS sector each, split across two codes. The
   labels say which half is which, so two rows never read "Retail trade". */
const SECTOR_NAMES = {
  11: 'Agriculture, forestry, fishing', 21: 'Mining, quarrying, oil & gas', 22: 'Utilities',
  23: 'Construction', 31: 'Manufacturing (food, textile)', 32: 'Manufacturing (wood, chemical, plastics)',
  33: 'Manufacturing (metal, machinery, transport)', 42: 'Wholesale trade',
  44: 'Retail trade (vehicles, building, food)', 45: 'Retail trade (general merchandise, other)',
  48: 'Transportation (air, truck, transit)', 49: 'Postal, couriers & warehousing',
  51: 'Information', 52: 'Finance & insurance', 53: 'Real estate', 54: 'Professional & technical',
  55: 'Management of companies', 56: 'Administrative & waste services', 61: 'Educational services',
  62: 'Health care & social assistance', 71: 'Arts, entertainment & recreation',
  72: 'Accommodation & food services', 81: 'Other services', 92: 'Public administration',
};
/* Official NAICS subsector titles. The filed descriptions in the catalog are
   the most common free text among filers, which for a rolled-up code is one
   child industry's wording (326 reads "Awnings, rigid plastics"). */
const SUBSECTORS = {
  111: 'Crop production', 112: 'Animal production and aquaculture', 113: 'Forestry and logging',
  115: 'Support activities for agriculture and forestry', 211: 'Oil and gas extraction',
  212: 'Mining (except oil and gas)', 213: 'Support activities for mining', 221: 'Utilities',
  236: 'Construction of buildings', 237: 'Heavy and civil engineering construction',
  238: 'Specialty trade contractors', 311: 'Food manufacturing', 312: 'Beverage and tobacco products',
  313: 'Textile mills', 314: 'Textile product mills', 315: 'Apparel manufacturing',
  316: 'Leather and allied products', 321: 'Wood product manufacturing', 322: 'Paper manufacturing',
  323: 'Printing and related support', 324: 'Petroleum and coal products', 325: 'Chemical manufacturing',
  326: 'Plastics and rubber products', 327: 'Nonmetallic mineral products', 331: 'Primary metal manufacturing',
  332: 'Fabricated metal products', 333: 'Machinery manufacturing', 334: 'Computer and electronic products',
  335: 'Electrical equipment, appliances, components', 336: 'Transportation equipment',
  337: 'Furniture and related products', 339: 'Miscellaneous manufacturing',
  423: 'Merchant wholesalers, durable goods', 424: 'Merchant wholesalers, nondurable goods',
  425: 'Wholesale agents and brokers', 441: 'Motor vehicle and parts dealers',
  442: 'Furniture and home furnishings stores', 443: 'Electronics and appliance stores',
  444: 'Building material and garden supply dealers', 445: 'Food and beverage retailers',
  446: 'Health and personal care stores', 447: 'Gasoline stations', 448: 'Clothing and accessories stores',
  449: 'Furniture, electronics and appliance retailers', 451: 'Sporting goods, hobby, music and book stores',
  452: 'General merchandise stores', 453: 'Miscellaneous store retailers', 454: 'Nonstore retailers',
  455: 'General merchandise retailers', 456: 'Health and personal care retailers',
  457: 'Gasoline stations and fuel dealers', 458: 'Clothing, shoe and jewelry retailers',
  459: 'Sporting goods, hobby, book and other retailers', 481: 'Air transportation', 483: 'Water transportation',
  484: 'Truck transportation', 485: 'Transit and ground passenger transportation', 486: 'Pipeline transportation',
  487: 'Scenic and sightseeing transportation', 488: 'Support activities for transportation',
  491: 'Postal service', 492: 'Couriers and messengers', 493: 'Warehousing and storage',
  511: 'Publishing industries', 512: 'Motion picture and sound recording', 515: 'Broadcasting',
  516: 'Internet publishing and broadcasting', 517: 'Telecommunications', 518: 'Data processing and hosting',
  519: 'Other information services', 522: 'Credit intermediation', 524: 'Insurance carriers and related',
  531: 'Real estate', 532: 'Rental and leasing services', 541: 'Professional, scientific and technical services',
  551: 'Management of companies and enterprises', 561: 'Administrative and support services',
  562: 'Waste management and remediation', 611: 'Educational services', 621: 'Ambulatory health care services',
  622: 'Hospitals', 623: 'Nursing and residential care facilities', 624: 'Social assistance',
  711: 'Performing arts and spectator sports', 712: 'Museums and historical sites',
  713: 'Amusement, gambling and recreation', 721: 'Accommodation', 722: 'Food services and drinking places',
  811: 'Repair and maintenance', 812: 'Personal and laundry services', 813: 'Religious, civic and professional organizations',
  921: 'General government support', 922: 'Justice, public order and safety', 923: 'Human resource programs',
  924: 'Environmental quality programs', 925: 'Housing and community development programs', 926: 'Economic programs',
};
const sectorName = (code) => SECTOR_NAMES[code] ?? 'Unclassified';
const sectorLabel = (code) => `${code} · ${sectorName(code)}`;
const BANDS = ['20-49', '50-99', '100-249', '250-499', '500-999', '1000+'];
const PKEYS = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'];
const rankClass = (r) => (r <= 50 ? 'good' : r <= 75 ? 'mid' : 'bad');

/* ==========================================================================
   Motion helpers — every one of them lands on the final state immediately
   when the visitor has asked for reduced motion.
   ========================================================================== */

/** Count a number up from 0 the first time it scrolls into view. */
function countUp(node, to, { decimals = 0, suffix = '', duration = 1100 } = {}) {
  const paint = (v) => { node.textContent = fmt(v, decimals) + suffix; };
  if (reduced() || !('IntersectionObserver' in window)) { paint(to); return node; }
  paint(0);
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      paint(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, { threshold: 0.6 });
  io.observe(node);
  return node;
}

/** Tween a displayed number between two values (toggles). */
function tweenText(node, from, to, decimals, duration = 650) {
  if (reduced()) { node.textContent = to.toFixed(decimals); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / duration);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    node.textContent = (from + (to - from) * e).toFixed(decimals);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Add .is-in to an element when it enters the viewport (CSS does the rest). */
function revealOnView(node) {
  if (reduced() || !('IntersectionObserver' in window)) { node.classList.add('is-in'); return node; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { node.classList.add('is-in'); io.disconnect(); }
  }, { threshold: 0.25 });
  io.observe(node);
  return node;
}

/** Render into a container at its real width, and again whenever that width changes. */
function responsive(container, draw) {
  let last = 0;
  const paint = () => {
    const w = Math.round(container.clientWidth);
    if (!w || w === last) return;
    last = w;
    container.replaceChildren(draw(w));
  };
  if ('ResizeObserver' in window) new ResizeObserver(paint).observe(container);
  else addEventListener('resize', paint);
  requestAnimationFrame(paint);
  return container;
}

/** A segmented toggle. `options`: [{value, label}]. Returns the element. */
function segmented(label, options, value, onChange) {
  const group = el('div', { class: 'chips', role: 'group', 'aria-label': label });
  const buttons = options.map((o) => el('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(o.value === value),
    onclick: () => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btnFor(o.value))));
      onChange(o.value);
    },
  }, o.label));
  const btnFor = (v) => buttons[options.findIndex((o) => o.value === v)];
  group.append(...buttons);
  return group;
}

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

/**
 * Vertical columns for a distribution over ordered bins, drawn at the
 * container's real width so type stays 11px on a phone. Hovering or tapping a
 * column shows its value; `bracket` draws a labelled span over a bin range.
 */
function columnsInto(container, values, labels, {
  height = 240, highlight = [], fmtValue = (v) => fmt(v), unit = 'cases', bracket = null, dim = null,
  tipLabel = (i) => labels[i],
} = {}) {
  const wrap = el('div', { class: 'chart-wrap' });
  const tip = el('div', { class: 'chart-tip', 'aria-hidden': 'true' });
  const box = el('div');
  wrap.append(box, tip);
  container.replaceChildren(wrap);
  const hi = new Set(highlight);
  responsive(box, (width) => {
    const phone = width < 520;
    const padL = phone ? 40 : 52, padR = 6, padB = 28, padT = bracket ? 40 : 14;
    const max = Math.max(...values, 1);
    const plotW = width - padL - padR;
    const plotH = height - padB - padT;
    const bw = plotW / values.length;
    const root = svg('svg', {
      class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
      'aria-label': labels.map((l, i) => `${tipLabel(i)}: ${fmtValue(values[i])}`).join('; '),
    });
    for (let g = 0; g <= 4; g++) {
      const y = padT + (plotH * g) / 4;
      root.append(
        svg('line', { class: 'grid', x1: padL, y1: y, x2: width - padR, y2: y }),
        svg('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end' }, fmtCompact(Math.round((max * (4 - g)) / 4))),
      );
    }
    const every = bw < 22 ? 2 : 1;
    values.forEach((v, i) => {
      const bh = (v / max) * plotH;
      const x = padL + i * bw;
      const faded = (hi.size && !hi.has(i)) || (dim && dim(i));
      const r = svg('rect', {
        class: 'bar', x: x + 1.5, y: padT + plotH - bh, width: Math.max(1, bw - 3), height: Math.max(0, bh),
        opacity: faded ? 0.42 : 1, tabindex: '0', 'aria-label': `${tipLabel(i)}: ${fmtValue(v)} ${unit}`,
      }, svg('title', {}, `${tipLabel(i)}: ${fmtValue(v)} ${unit}`));
      const show = () => {
        tip.textContent = `${tipLabel(i)} · ${fmtValue(v)} ${unit}`;
        tip.style.left = `${x + bw / 2}px`;
        tip.style.top = `${padT + plotH - bh - 6}px`;
        tip.classList.add('on');
      };
      const hide = () => tip.classList.remove('on');
      r.addEventListener('pointerenter', show);
      r.addEventListener('pointerleave', hide);
      r.addEventListener('focus', show);
      r.addEventListener('blur', hide);
      root.append(r);
      if (i % every === 0) {
        root.append(svg('text', { x: x + bw / 2, y: height - 9, 'text-anchor': 'middle' }, labels[i]));
      }
    });
    if (bracket) {
      const [a, b, text] = bracket;
      const x1 = padL + a * bw + 2, x2 = padL + (b + 1) * bw - 2, y = padT - 14;
      root.append(
        svg('path', { class: 'bracket', d: `M${x1} ${y + 8} V${y} H${x2} V${y + 8}` }),
        svg('text', { class: 'note', x: (x1 + x2) / 2, y: y - 6, 'text-anchor': 'middle' }, text),
      );
    }
    root.append(svg('line', { class: 'axis', x1: padL, y1: padT + plotH, x2: width - padR, y2: padT + plotH }));
    return root;
  });
  return wrap;
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sci = (n) => { const [m, e] = n.toExponential(1).split('e+'); return `${m} × 10${[...e].map((d) => SUP[d]).join('')}`; };
const fmtCompact = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/**
 * Percentile strip: quartile bands with the visitor's rate marked. Labels that
 * would sit on top of each other (a zero-inflated group has p10 = p25 = 0) are
 * merged into one label.
 */
function percentileStrip(p, rate, rank, zeroRate) {
  const box = el('div', { class: 'strip' });
  responsive(box, (width) => {
    const phone = width < 520;
    const height = 104, padL = 8, padR = 8;
    const scaleMax = Math.max(p.p95, rate) * 1.08 || 1;
    const x = (v) => padL + (Math.min(v, scaleMax) / scaleMax) * (width - padL - padR);
    const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
      'aria-label': `Peer distribution: median ${p.p50.toFixed(2)}, p75 ${p.p75.toFixed(2)}, p90 ${p.p90.toFixed(2)}. Your rate ${rate.toFixed(2)} ranks p${Math.round(rank)}.` });
    const bandY = 36, bandH = 24;
    const bands = [[0, p.p25, 0.95], [p.p25, p.p50, 0.72], [p.p50, p.p75, 0.5], [p.p75, p.p90, 0.3], [p.p90, scaleMax, 0.14]];
    for (const [a, b, op] of bands) {
      root.append(svg('rect', { class: 'bar', x: x(a), y: bandY, width: Math.max(0, x(b) - x(a)), height: bandH, opacity: op }));
    }
    // group ticks that share a position
    const ticks = [];
    for (const [key, label] of [['p25', 'p25'], ['p50', 'median'], ['p75', 'p75'], ['p90', 'p90']]) {
      if (phone && key === 'p25') continue;
      const v = p[key];
      const prev = ticks[ticks.length - 1];
      if (prev && Math.abs(x(v) - x(prev.v)) < (phone ? 64 : 84)) prev.labels.push(label);
      else ticks.push({ v, labels: [label] });
    }
    for (const t of ticks) {
      const text = t.v === 0 && zeroRate ? `${t.labels.join(' = ')} = 0` : `${t.labels.join('/')} ${t.v.toFixed(2)}`;
      root.append(
        svg('line', { class: 'grid', x1: x(t.v), y1: bandY, x2: x(t.v), y2: bandY + bandH + 6 }),
        svg('text', {
          x: x(t.v), y: bandY + bandH + 20,
          'text-anchor': t.v === 0 || x(t.v) < 70 ? 'start' : x(t.v) > width - 70 ? 'end' : 'middle',
        }, text),
      );
    }
    const rx = x(rate);
    const anchor = rx > width - 90 ? 'end' : rx < 90 ? 'start' : 'middle';
    root.append(
      svg('line', { class: 'marker', x1: rx, y1: bandY - 12, x2: rx, y2: bandY + bandH + 2 }),
      svg('text', { x: rx, y: bandY - 18, 'text-anchor': anchor, class: 'label-strong' }, `you ${rate.toFixed(2)} · p${Math.round(rank)}`),
    );
    if (zeroRate) {
      root.append(svg('text', { x: padL, y: height - 4 }, `${Math.round(zeroRate * 100)}% of this group reported zero cases`));
    }
    return root;
  });
  return box;
}

/** Small multi-year sparkline for a sector row. */
function spark(values, { width = 64, height = 20 } = {}) {
  const clean = values.filter((v) => v != null);
  if (clean.length < 2) return document.createTextNode('—');
  const min = Math.min(...clean), max = Math.max(...clean);
  const span = max - min || 1;
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  const pts = clean.map((v, i) => `${(i / (clean.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / span) * (height - 8)}`);
  root.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 2 }));
  const [lx, ly] = pts[pts.length - 1].split(',');
  root.append(svg('circle', { cx: lx, cy: ly, r: 2.6, fill: 'var(--ink)' }));
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
    el('th', { class: h.num ? 'num' : null, scope: 'col' }, h.label ?? h))));
  const tbody = el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) =>
    el('td', { class: typeof c === 'object' && c?.num ? 'num' : null }, typeof c === 'object' && c !== null && !(c instanceof Node) ? c.v : c)))));
  return el('div', { class: 'scroll-x' }, el('table', {}, thead, tbody));
}
const num = (v) => ({ num: true, v });

/**
 * A table whose headers sort it. `cols`: [{label, num, key: (row) => sortValue,
 * cell: (row) => content}]. Sorting keeps the table element; only rows move.
 */
function sortableTable(cols, rows, { initial = 0, dir = 'desc' } = {}) {
  let sortIdx = initial, sortDir = dir;
  const ths = cols.map((c, i) => el('th', { class: c.num ? 'num' : null, scope: 'col' },
    el('button', { type: 'button', class: 'sort', onclick: () => {
      if (sortIdx === i) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortIdx = i; sortDir = c.num ? 'desc' : 'asc'; }
      paint();
    } }, c.label)));
  const tbody = el('tbody');
  const paint = () => {
    const k = cols[sortIdx].key;
    const sorted = [...rows].sort((a, b) => {
      const va = k(a), vb = k(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va ?? -Infinity) - (vb ?? -Infinity);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    ths.forEach((th, i) => {
      if (i === sortIdx) th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    tbody.replaceChildren(...sorted.map((r) => el('tr', {}, cols.map((c) =>
      el('td', { class: c.num ? 'num' : null }, c.cell(r))))));
  };
  paint();
  return el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, el('tr', {}, ths)), tbody));
}

/** A labelled horizontal bar row; with `body` it expands like a disclosure. */
function barRow({ label, value, max, valueText, subText, tone = '', body = null, title = null }) {
  const fill = el('span', { class: `bar-fill ${tone}`, style: `width:${Math.max(0.4, (value / max) * 100)}%` });
  const cells = [
    el('span', { class: 'bar-label', title }, label),
    el('span', { class: 'bar-track', 'aria-hidden': 'true' }, fill),
    el('span', { class: 'bar-val' }, valueText, subText ? el('small', {}, subText) : null),
  ];
  if (!body) return el('div', { class: 'barrow' }, el('div', { class: 'barrow-static' }, cells));
  const d = el('details', { class: 'barrow' }, el('summary', {}, cells));
  let built = false;
  d.addEventListener('toggle', () => {
    if (d.open && !built) { built = true; d.append(el('div', { class: 'barrow-body' }, body())); }
  });
  return d;
}

/* ==========================================================================
   Findings: the leader briefing
   ========================================================================== */

async function renderFindings() {
  const [f, oiics, chem] = await Promise.all([
    load('findings.json'), load('oiics.json'), load('benchmarks/32.json').catch(() => null),
  ]);
  const chemDist = chem?.['325|all'];
  const shift = oiics.hourIntoShift;
  const shiftTotal = shift.reduce((a, b) => a + b, 0);
  const firstFour = shift.slice(0, 4).reduce((a, b) => a + b, 0) / shiftTotal * 100;
  const lateShare = shift.slice(8).reduce((a, b) => a + b, 0) / shiftTotal * 100;
  const peak = shift.indexOf(Math.max(...shift));
  const days = daysAwayModel(oiics);

  const briefing = $('#briefing');
  briefing.classList.remove('loading-block');
  briefing.replaceChildren(
    summaryStrip(f, chemDist, firstFour, days),
    findingHours(f),
    findingZero(chemDist),
    findingShift(oiics, { firstFour, lateShare, peak }),
    findingDays(days),
    mondayQuestions(f, chemDist, firstFour, days),
    el('div', { class: 'section-head' }, el('h2', {}, 'Use the data')),
    doors(),
  );
}

/** Share of all days away carried by each event, from counts and mean durations. */
function daysAwayModel(o) {
  const totalDays = o.outcomeDays.dafwCases * o.outcomeDays.meanDaysAway;
  const rows = o.eventDrill.map((e) => ({
    t: e.t, n: e.n, caseShare: e.share, mean: e.meanDaysAway,
    dayShare: ((e.daysCases || 0) * (e.meanDaysAway || 0)) / totalDays * 100,
  }));
  const byDays = [...rows].sort((a, b) => b.dayShare - a.dayShare);
  const top2 = byDays[0].dayShare + byDays[1].dayShare;
  const exposure = rows.find((r) => /harmful substances/i.test(r.t));
  return { rows, byDays, top2, exposure, totalDays };
}

function summaryStrip(f, chemDist, firstFour, days) {
  const card = (href, n, claim, tone = '') => el('a', { class: `brief-card ${tone}`, href },
    el('span', { class: 'brief-n' }, n), el('span', { class: 'brief-claim' }, claim));
  return el('section', { class: 'brief-strip', 'aria-label': 'The briefing in 60 seconds' },
    el('p', { class: 'brief-strip-k' }, 'In 60 seconds'),
    el('div', { class: 'brief-cards' },
      card('#f-hours', `${f.errorFactor}×`, 'how much better the raw OSHA file makes every injury rate look', 'bad'),
      card('#f-zero', chemDist ? pct(chemDist.zeroRate * 100, 0) : '—', 'of chemical plants report zero recordables: zero is the most common result, not a trophy'),
      card('#f-shift', pct(firstFour, 0), 'of injuries happen in the first four hours of a shift, not at the tired end'),
      card('#f-days', pct(days.top2, 0), 'of all days away come from just two kinds of event'),
    ));
}

/** The frame every finding shares: headline, a big number, a visual, and the leader's takeaway. */
function finding({ id, no, headline, lede, stat, visual, meaning, ask, extra = [] }) {
  return revealOnView(el('article', { class: 'finding', id, 'aria-labelledby': `${id}-h` },
    el('div', { class: 'finding-top' },
      el('p', { class: 'finding-k' }, `Finding ${no} of 4`),
      el('h2', { id: `${id}-h` }, headline),
      el('p', { class: 'finding-lede' }, lede)),
    el('div', { class: 'finding-body' },
      el('div', { class: 'finding-stat' }, stat),
      el('div', { class: 'finding-visual' }, visual)),
    el('div', { class: 'so-what' },
      el('div', {}, el('span', { class: 'so-k' }, 'What it means for a leader'), el('p', {}, meaning)),
      el('div', {}, el('span', { class: 'so-k' }, 'Ask your team'), el('p', { class: 'ask' }, ask))),
    extra,
  ));
}

function bigStat(numberNode, caption, tone = '') {
  return el('div', { class: `big-stat ${tone}` }, numberNode, el('span', { class: 'big-cap' }, caption));
}

function findingHours(f) {
  const worst = f.extremeRecords[0];
  const rateNode = el('span', { class: 'gauge-n' }, f.correctedTrir.toFixed(2));
  const needle = el('i', { class: 'gauge-needle' });
  const note = el('p', { class: 'gauge-note' });
  const maxScale = 4;
  let mode = 'clean';
  const setMode = (m) => {
    const from = mode === 'clean' ? f.correctedTrir : f.naiveTrir;
    const to = m === 'clean' ? f.correctedTrir : f.naiveTrir;
    mode = m;
    tweenText(rateNode, from, to, 2);
    needle.style.left = `${(to / maxScale) * 100}%`;
    gauge.classList.toggle('is-raw', m === 'raw');
    note.textContent = m === 'raw'
      ? `Summed straight from the file, the U.S. national rate reads ${f.naiveTrir.toFixed(2)}: a workforce that looks ${f.errorFactor}× safer than it is.`
      : `With the ${fmt(f.excludedImplausible + f.excludedZeroHours)} impossible filings removed, the rate is ${f.correctedTrir.toFixed(2)} recordables per 100 full-time workers.`;
  };
  const gauge = el('div', { class: 'gauge' },
    el('div', { class: 'gauge-head' },
      el('span', { class: 'gauge-k' }, 'National TRIR, CY2023–CY2025'),
      segmented('Which file', [{ value: 'raw', label: 'As published' }, { value: 'clean', label: 'Cleaned' }], 'clean', setMode)),
    rateNode,
    el('div', { class: 'gauge-track', 'aria-hidden': 'true' },
      el('i', { class: 'gauge-tick', style: `left:${(f.naiveTrir / maxScale) * 100}%` }),
      el('i', { class: 'gauge-tick', style: `left:${(f.correctedTrir / maxScale) * 100}%` }),
      needle),
    el('div', { class: 'gauge-scale', 'aria-hidden': 'true' }, el('span', {}, '0'), el('span', {}, '1'), el('span', {}, '2'), el('span', {}, '3'), el('span', {}, '4')),
    note);
  setMode('clean');

  const split = el('div', { class: 'split' },
    el('div', { class: 'split-row' },
      el('span', { class: 'split-label' }, 'Share of filings'),
      el('div', { class: 'split-bar' },
        el('span', { class: 'bad grow', style: `--w:${Math.max(f.excludedShare, 3)}%` }, ''),
        el('span', { class: 'ok' }, `${pct(f.excludedShare, 2)} fail the test`))),
    el('div', { class: 'split-row' },
      el('span', { class: 'split-label' }, 'Share of hours'),
      el('div', { class: 'split-bar' },
        el('span', { class: 'bad grow', style: `--w:${f.hoursDiscardedShare}%` }, `${pct(f.hoursDiscardedShare)} of all hours`),
        el('span', { class: 'ok' }, ''))));

  const sectorRows = f.excludedBySector.map((s) => [
    sectorLabel(s.s), num(fmt(s.implausible)), num(fmt(s.zero)), num(fmt(Math.round(s.hours / 1e9)) + 'B'),
  ]);
  const extremeRows = f.extremeRecords.map((r) => [
    r.name, r.state, r.naics, num(r.year),
    num(r.hours.toExponential(2)), num(fmt(r.employees)), num(fmt(r.perEmployee)),
  ]);

  return finding({
    id: 'f-hours', no: 1,
    headline: `The raw file makes every rate look ${f.errorFactor}× too good`,
    lede: `A rate is injuries divided by hours worked. A few employers typed their hours wrong by factors of millions, ` +
      `and those few filings swamp the denominator for everyone. One site in ${worst.state} reported ` +
      `${sci(worst.hours)} hours for ${fmt(worst.employees)} employees: more hours than the entire U.S. workforce works in a year.`,
    stat: bigStat(countUp(el('span', { class: 'big-n' }), f.errorFactor, { decimals: 2, suffix: '×' }),
      'how far off a national benchmark is when the hours column is summed as published', 'bad'),
    visual: el('div', {}, gauge, split,
      el('p', { class: 'fig-note' }, `Only ${pct(f.excludedShare, 2)} of filings fail a simple test (100 to 4,000 hours per employee per year), yet they carry ${pct(f.hoursDiscardedShare)} of every hour reported.`)),
    meaning: 'Any benchmark, vendor dashboard or board slide built on the raw OSHA file tells you your rate is excellent when it may be average. The error always flatters, so nobody complains about it.',
    ask: '"Where does our comparison number come from, and was the hours column screened before it was averaged?"',
    extra: [
      drill(`Which sectors the excluded records come from · ${f.excludedBySector.length} sectors`, () =>
        table(['Sector', { label: 'Implausible hrs/emp', num: true }, { label: 'Zero hours', num: true }, { label: 'Hours excluded', num: true }], sectorRows)),
      drill('The ten most extreme filings · public record', () =>
        el('div', {},
          el('p', { class: 'muted', style: 'font-size:12px;margin:8px 0' },
            'These are unedited public filings. The right-hand column is hours per employee per year; a full-time worker is about 2,000.'),
          table(['Establishment', 'State', 'NAICS', { label: 'Year', num: true }, { label: 'Hours filed', num: true }, { label: 'Employees', num: true }, { label: 'Hrs/employee', num: true }], extremeRows))),
    ],
  });
}

function findingZero(chemDist) {
  if (!chemDist) return el('p', { class: 'error-note' }, 'Chemical-sector distribution unavailable.');
  const zeros = Math.round(chemDist.zeroRate * 100);
  const d = { percentiles: chemDist.trir, zeroRate: chemDist.zeroRate };
  // 100 establishments, one square each, placed at their percentile's rate
  const waffle = el('div', { class: 'waffle', role: 'img',
    'aria-label': `100 squares, one per percentile of NAICS 325 establishments. ${zeros} reported zero recordable cases.` });
  const rateAt = (q) => {
    if (q <= zeros) return 0;
    const pts = [[chemDist.zeroRate * 100, 0], ...PKEYS.map((k) => [Number(k.slice(1)), d.percentiles[k]]).filter(([p, v]) => v > 0 && p > zeros)];
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, v0] = pts[i], [p1, v1] = pts[i + 1];
      if (q >= p0 && q <= p1) return v0 + ((q - p0) / (p1 - p0)) * (v1 - v0);
    }
    return pts[pts.length - 1][1];
  };
  for (let q = 1; q <= 100; q++) {
    const v = rateAt(q - 0.5);
    const tone = v === 0 ? 'z' : v < chemDist.trir.p50 ? 'lo' : v < chemDist.trir.p90 ? 'mid' : 'hi';
    waffle.append(el('i', { class: tone, style: `--i:${q}`, title: v === 0 ? 'Reported zero' : `About ${v.toFixed(1)}` }));
  }
  const legend = el('div', { class: 'legend' },
    el('span', {}, el('i', { class: 'lg z' }), 'reported zero'),
    el('span', {}, el('i', { class: 'lg lo' }), `above zero, under median ${chemDist.trir.p50.toFixed(2)}`),
    el('span', {}, el('i', { class: 'lg mid' }), 'median to p90'),
    el('span', {}, el('i', { class: 'lg hi' }), `worst tenth, above ${chemDist.trir.p90.toFixed(2)}`));

  const ladder = el('div', { class: 'bars compact' },
    PKEYS.map((k) => barRow({
      label: k === 'p50' ? 'p50 (median)' : k,
      value: chemDist.trir[k], max: chemDist.trir.p99,
      valueText: chemDist.trir[k] === 0 ? '0 (zero)' : chemDist.trir[k].toFixed(2),
      tone: chemDist.trir[k] >= chemDist.trir.p90 ? 'bad' : '',
    })));

  return finding({
    id: 'f-zero', no: 2,
    headline: 'Zero is the most common result, not the best one',
    lede: `Injury rates do not form a bell curve. In chemical manufacturing (NAICS 325), ${zeros} establishments in every hundred ` +
      `reported no recordable case at all, while the worst tenth sit above ${chemDist.trir.p90.toFixed(2)}. At a 50-person site, ` +
      'one injury moves the rate by about two points, so a clean year is often a small site having an ordinary year.',
    stat: bigStat(countUp(el('span', { class: 'big-n' }), zeros, { suffix: '%' }),
      `of ${fmt(chemDist.n)} chemical plants reported zero recordables`),
    visual: el('div', {}, waffle, legend,
      drill('The percentile ladder behind the squares', () => ladder)),
    meaning: 'A zero on a scorecard mostly measures how few hours were worked. Averages hide this entirely: the mean is pulled up by the worst tenth, and "we had zero" sits beside plants that had one bad month.',
    ask: '"Which of our zero-injury sites are small enough that one case would put them in the bottom quartile?"',
  });
}

function findingShift(o, { firstFour, lateShare, peak }) {
  const box = el('div');
  const labels = o.hourIntoShift.map((_, i) => `${i}`);
  let view = 'real';
  const draw = () => columnsInto(box, o.hourIntoShift, labels, {
    tipLabel: (i) => `hour ${i}`,
    highlight: view === 'real' ? [0, 1, 2, 3] : [8, 9, 10, 11, 12, 13, 14, 15],
    bracket: view === 'real' ? [0, 3, `first four hours: ${pct(firstFour)}`] : [8, 15, `hours 8+: ${pct(lateShare)}`],
  });
  draw();
  const note = el('p', { class: 'fig-note' });
  const setNote = () => {
    note.textContent = view === 'real'
      ? `${fmt(o.withShiftTiming)} cases record both the shift start and the incident time. Columns show full hours since the shift began.`
      : `Hours eight onward, where fatigue programmes usually aim, hold ${pct(lateShare)} of injuries, partly because fewer people are still on shift by then.`;
  };
  setNote();
  const toggle = segmented('Which hours to highlight', [
    { value: 'real', label: 'Where injuries happen' }, { value: 'late', label: 'Where programmes aim' },
  ], 'real', (v) => { view = v; draw(); setNote(); });

  return finding({
    id: 'f-shift', no: 3,
    headline: `Injuries peak in hour ${peak} of the shift, not at the tired end`,
    lede: 'Prevention effort tends to follow a fatigue story: the long shift, the last hour. The case file points the other way. ' +
      'Injuries climb from the first hour, peak early and fall steadily after the midpoint.',
    stat: bigStat(countUp(el('span', { class: 'big-n' }), firstFour, { decimals: 1, suffix: '%' }),
      'of timed injuries occur in the first four hours of the shift'),
    visual: el('div', {}, el('div', { class: 'visual-head' }, toggle), box, note),
    meaning: 'Start-up is the risky part of the day: set-up, first lifts, changeovers, people arriving to a job already moving. Pre-shift briefings and the first hour of supervision probably buy more than end-of-shift fatigue rules.',
    ask: '"What does the first hour of a shift look like on our floor, and who is watching it?"',
  });
}

function findingDays(days) {
  const top = days.byDays.slice(0, 6);
  const exp = days.exposure;
  const short = (t) => t.replace(/ while moving or manipulating external object\(s\)/i, ' (lifting, carrying)')
    .replace(/Slip, trip, stumble or fall on same level/i, 'Slips, trips, same-level falls')
    .replace(/Contact with non-running objects or equipment/i, 'Struck against objects')
    .replace(/Struck by propelled, falling, or suspended object/i, 'Struck by falling objects')
    .replace(/Exposure to harmful substances/i, 'Harmful substances');
  const rows = [...new Set([...top, exp].filter(Boolean))];
  const box = el('div', { class: 'slope' });
  responsive(box, (width) => {
    const phone = width < 560;
    if (phone) {
      // a slope chart needs width for its labels; on a phone each event gets a pair of bars
      const maxV = Math.max(...rows.map((r) => Math.max(r.caseShare, r.dayShare)));
      return el('div', { class: 'pairs' },
        el('div', { class: 'pairs-key' }, el('span', {}, el('i', { class: 'pc' }), 'cases'), el('span', {}, el('i', { class: 'pd' }), 'days away')),
        [...rows].sort((a, b) => b.dayShare - a.dayShare).map((r) => el('div', { class: 'pair' },
          el('span', { class: 'pair-t' }, short(r.t)),
          el('span', { class: 'pair-bar pc', style: `width:${(r.caseShare / maxV) * 78}%` }, pct(r.caseShare, 0)),
          el('span', { class: `pair-bar pd ${r.dayShare > r.caseShare ? 'up' : ''}`, style: `width:${(r.dayShare / maxV) * 78}%` }, pct(r.dayShare, 0)))));
    }
    const H = 40 + rows.length * 44;
    const x1 = phone ? 54 : 250, x2 = width - (phone ? 54 : 250);
    const maxV = Math.max(...rows.map((r) => Math.max(r.caseShare, r.dayShare)));
    const yOf = (() => {
      // rank order on each side, so lines cross where priorities change
      const byCase = [...rows].sort((a, b) => b.caseShare - a.caseShare);
      const byDay = [...rows].sort((a, b) => b.dayShare - a.dayShare);
      return (r, side) => 44 + (side === 'c' ? byCase : byDay).indexOf(r) * 44;
    })();
    const root = svg('svg', { class: 'chart slope-svg', viewBox: `0 0 ${width} ${H}`, width, height: H, role: 'img',
      'aria-label': rows.map((r) => `${short(r.t)}: ${pct(r.caseShare)} of cases, ${pct(r.dayShare)} of days away`).join('; ') });
    root.append(
      svg('text', { x: x1, y: 18, 'text-anchor': 'middle', class: 'note' }, 'share of cases'),
      svg('text', { x: x2, y: 18, 'text-anchor': 'middle', class: 'note' }, 'share of days away'));
    rows.forEach((r) => {
      const ya = yOf(r, 'c'), yb = yOf(r, 'd');
      const up = r.dayShare > r.caseShare;
      const tone = r === exp ? 'var(--ink-3)' : up ? 'var(--bad)' : 'var(--green)';
      const w = 2 + (r.dayShare / maxV) * 6;
      root.append(
        svg('line', { x1: x1 + 26, y1: ya, x2: x2 - 26, y2: yb, stroke: tone, 'stroke-width': w, 'stroke-linecap': 'round', opacity: 0.85, class: 'slope-line' }),
        svg('text', { x: x1, y: ya + 4, 'text-anchor': 'middle', class: 'label-strong' }, pct(r.caseShare, 0)),
        svg('text', { x: x2, y: yb + 4, 'text-anchor': 'middle', class: 'label-strong' }, pct(r.dayShare, 0)));
      if (!phone) {
        root.append(
          svg('text', { x: x1 - 30, y: ya + 4, 'text-anchor': 'end' }, short(r.t).slice(0, 34)),
          svg('text', { x: x2 + 30, y: yb + 4, 'text-anchor': 'start' }, short(r.t).slice(0, 34)));
      } else {
        root.append(svg('text', { x: width / 2, y: (ya + yb) / 2 - 8, 'text-anchor': 'middle', class: 'slope-lab' }, short(r.t).slice(0, 30)));
      }
    });
    return root;
  });

  return finding({
    id: 'f-days', no: 4,
    headline: 'Two kinds of event cause nearly half the time lost',
    lede: `Count cases and the priorities look spread out. Weight each case by the days away it cost and two events dominate: ` +
      `overexertion while lifting or carrying, and slips and trips on the same level. Harmful-substance exposures run the other way: ` +
      `${exp ? pct(exp.caseShare, 0) : 'many'} of cases, only ${exp ? pct(exp.dayShare, 1) : 'a sliver'} of days away.`,
    stat: bigStat(countUp(el('span', { class: 'big-n' }), days.top2, { decimals: 0, suffix: '%' }),
      `of ${fmtCompact(Math.round(days.totalDays))} days away come from these two events`, 'bad'),
    visual: el('div', {}, box,
      el('p', { class: 'fig-note' }, 'Each event\'s share of all coded cases against its share of all days away from work. Red marks an event that costs more time than its case count suggests; green, less. On wide screens, line width follows days lost.')),
    meaning: 'A top-ten list ranked by case count tells you what happens most, not what costs most. Manual handling and walking surfaces are unglamorous, and they are where the lost time is.',
    ask: '"If we ranked our injuries by days lost instead of by count, what would move to the top?"',
  });
}

function mondayQuestions(f, chemDist, firstFour, days) {
  const q = [
    ['Check the denominator', `Before trusting any benchmark, confirm the hours were screened. Unscreened, the U.S. rate reads ${f.naiveTrir.toFixed(2)} instead of ${f.correctedTrir.toFixed(2)}.`],
    ['Fix the peer group first', 'Rank each site against its own industry and size band, and write the n beside every percentile. The same plant can rank p72 or p93 depending on the band.'],
    ['Stop celebrating small zeros', `${chemDist ? pct(chemDist.zeroRate * 100, 0) : 'Many'} of chemical plants reported zero. Report hours alongside every zero.`],
    ['Move effort to the start of the shift and to lost time', `${pct(firstFour, 0)} of injuries fall in the first four hours; ${pct(days.top2, 0)} of days away come from handling and same-level falls.`],
  ];
  return revealOnView(el('section', { class: 'monday', 'aria-labelledby': 'monday-h' },
    el('p', { class: 'finding-k' }, 'What to do on Monday'),
    el('h2', { id: 'monday-h' }, 'Four changes to your next safety review'),
    el('ol', {}, q.map(([t, d]) => el('li', {}, el('b', {}, t), el('span', {}, d)))),
    el('div', { class: 'cta-row' },
      el('a', { class: 'btn btn-primary', href: '#benchmark' }, 'Benchmark one of your sites →'),
      el('a', { class: 'btn', href: 'story.html' }, 'The peer-group story, step by step'))));
}

function doors() {
  const door = (href, k, t, d) => el('a', { class: 'door', href },
    el('span', { class: 'door-k' }, k), el('span', { class: 'door-t' }, t), el('span', { class: 'door-d' }, d));
  return el('div', { class: 'doors' },
    door('#benchmark', 'Tool', 'Benchmark my site', 'Your rate against the same industry and size band, with the n beside it.'),
    door('#company', 'Search', 'Look up an employer', '228,584 employers rolled up across their establishments.'),
    door('#patterns', 'Explore', 'How people get hurt', 'Event, body part and timing for 688,367 coded cases.'));
}

/* ==========================================================================
   Benchmark my site
   ========================================================================== */

let naicsCatalog = null;
let industries = [];
const bm = { naics: '3252', band: '250-499', hours: 625000, cases: 10, dart: '', emp: '' };
const BM_DEFAULT = { ...bm };

function industryEntry(code, v) {
  const lvl = code.length;
  let title, sub;
  if (lvl === 2) { title = `All of ${SECTOR_NAMES[code] ?? `sector ${code}`}`; sub = 'Whole sector'; }
  else if (lvl === 3) { title = SUBSECTORS[code] ?? v.t; sub = `Subsector in ${sectorLabel(code.slice(0, 2))}`; }
  else {
    title = v.t.length >= 70 ? `${v.t.replace(/[\s,(]+\S*$/, '')}…` : v.t;
    const parent = SUBSECTORS[code.slice(0, 3)];
    sub = `${lvl === 4 ? 'Industry group' : 'Industry'} in ${code.slice(0, 3)}${parent ? ` ${parent}` : ''}`;
  }
  const level = { 2: 'sector', 3: 'subsector', 4: 'group', 6: 'industry' }[lvl] ?? '';
  return { code, sector: v.s, title, sub, level, hay: `${code} ${title} ${sub}`.toLowerCase() };
}

async function initBenchmark() {
  naicsCatalog = await load('naics-catalog.json');
  industries = Object.entries(naicsCatalog).map(([c, v]) => industryEntry(c, v))
    .sort((a, b) => a.code.localeCompare(b.code));
  Object.assign(bm, readParams());
  setupCombo();
  $('#bm-naics-note').textContent = `${fmt(industries.length)} industries across ${Object.keys(SECTOR_NAMES).length} sectors. Broader codes pool more establishments.`;
  for (const id of ['bm-hours', 'bm-cases', 'bm-dart', 'bm-emp']) {
    const input = $(`#${id}`);
    const key = id.slice(3);
    if (bm[key] !== '' && bm[key] != null) input.value = bm[key];
    input.addEventListener('input', () => { bm[key] = input.value; scheduleRun(); });
  }
  $('#bm-form').addEventListener('submit', (e) => { e.preventDefault(); runBenchmark(); });
  $('#bm-est').addEventListener('click', () => {
    const emp = Number($('#bm-emp').value);
    if (!(emp > 0)) { $('#bm-emp').focus(); $('#bm-emp').setAttribute('aria-invalid', 'true'); return; }
    $('#bm-emp').removeAttribute('aria-invalid');
    $('#bm-hours').value = bm.hours = emp * 2000;
    runBenchmark();
  });
  await selectIndustry(bm.naics, { keepBand: true });
}

function readParams() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const out = {};
  for (const k of ['naics', 'band', 'hours', 'cases', 'dart', 'emp']) if (q.has(k)) out[k] = q.get(k);
  if (out.naics && !naicsCatalog[out.naics]) delete out.naics;
  return out;
}

function writeParams() {
  const q = new URLSearchParams();
  for (const k of ['naics', 'band', 'hours', 'cases', 'dart', 'emp']) if (bm[k] !== '' && bm[k] != null) q.set(k, bm[k]);
  history.replaceState(null, '', `#benchmark?${q}`);
}

let runTimer;
function scheduleRun() { clearTimeout(runTimer); runTimer = setTimeout(runBenchmark, 220); }

/* ---- the industry combobox ---- */

function setupCombo() {
  const input = $('#bm-naics-q');
  const list = $('#bm-naics-list');
  let active = -1, shown = [];

  const close = () => { document.body.classList.remove('combo-open'); list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const open = () => { document.body.classList.add('combo-open'); list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const mark = (text, terms) => {
    if (!terms.length) return [text];
    const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'ig');
    return text.split(re).map((part, i) => (i % 2 ? el('mark', {}, part) : part));
  };
  const paint = () => {
    const raw = input.value.trim().toLowerCase();
    const terms = raw.split(/\s+/).filter(Boolean);
    if (!terms.length) shown = industries.filter((i) => i.code.length <= 2);
    else {
      shown = industries
        .map((i) => {
          if (!terms.every((t) => i.hay.includes(t))) return null;
          let s = 0;
          if (/^\d+$/.test(raw)) s += i.code === raw ? 100 : i.code.startsWith(raw) ? 60 - i.code.length : 0;
          if (i.title.toLowerCase().startsWith(terms[0])) s += 20;
          if (i.title.toLowerCase().includes(raw)) s += 10;
          s -= i.code.length;                   // broader codes first among equals
          return { i, s };
        })
        .filter(Boolean).sort((a, b) => b.s - a.s).slice(0, 60).map((r) => r.i);
    }
    active = shown.length ? 0 : -1;
    list.replaceChildren(...(shown.length ? shown.map((i, k) => el('li', {
      id: `naics-opt-${i.code}`, role: 'option', 'aria-selected': String(k === active),
      onmousedown: (e) => { e.preventDefault(); choose(i); },
    },
    el('span', { class: 'c-code' }, i.code),
    el('span', { class: 'c-t' }, mark(i.title, terms)),
    el('span', { class: 'c-lvl' }, i.level),
    el('span', { class: 'c-sub' }, i.sub))) : [el('li', { class: 'c-empty', role: 'option', 'aria-disabled': 'true' }, 'No industry matches. Try a broader word or the first digits of the code.')]));
    if (active >= 0) input.setAttribute('aria-activedescendant', `naics-opt-${shown[active].code}`);
    open();
  };
  const move = (d) => {
    if (!shown.length) return;
    active = (active + d + shown.length) % shown.length;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === active)));
    const li = list.children[active];
    li.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', li.id);
  };
  const choose = (i) => { close(); selectIndustry(i.code); };

  input.addEventListener('focus', () => { input.select(); paint(); });
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) paint(); else move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!list.hidden && active >= 0) choose(shown[active]); }
    else if (e.key === 'Escape') { close(); input.value = labelFor(bm.naics); }
  });
  input.addEventListener('blur', () => setTimeout(() => { close(); input.value = labelFor(bm.naics); }, 120));
}

const labelFor = (code) => {
  const i = industries.find((x) => x.code === code);
  return i ? `${i.code} · ${i.title}` : code;
};

let sectorData = {};
async function selectIndustry(code, { keepBand = false } = {}) {
  bm.naics = code;
  $('#bm-naics-q').value = labelFor(code);
  const entry = industries.find((x) => x.code === code);
  sectorData = await load(`benchmarks/${entry.sector}.json`).catch(() => ({}));
  const available = (b) => sectorData[`${code}|${b}`];
  if (!keepBand || !available(bm.band)) bm.band = available(bm.band) ? bm.band : 'all';
  const chips = $('#bm-band');
  const opts = ['all', ...BANDS];
  chips.replaceChildren(...opts.map((b) => {
    const d = available(b);
    return el('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(b === bm.band),
      tabindex: b === bm.band ? '0' : '-1', disabled: !d, 'data-band': b,
      title: d ? `${fmt(d.n)} establishments` : 'Fewer than 30 filers: no published percentiles',
      onclick: () => setBand(b),
    }, b === 'all' ? 'All sizes' : b, el('small', {}, d ? `n ${fmt(d.n)}` : 'n<30'));
  }));
  // arrow keys move within the radio group, as a native radio set would
  chips.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const enabled = [...chips.querySelectorAll('.chip:not(:disabled)')];
    const i = enabled.indexOf(document.activeElement);
    const next = enabled[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length];
    next.focus(); setBand(next.dataset.band);
  };
  runBenchmark();
}

function setBand(b) {
  bm.band = b;
  for (const c of $('#bm-band').children) {
    const on = c.dataset.band === b;
    c.setAttribute('aria-checked', String(on));
    c.tabIndex = on ? 0 : -1;
  }
  runBenchmark();
}

/** Find the published distribution, widening one step at a time if needed. */
function findDist(naics, band) {
  const key = `${naics}|${band}`;
  if (sectorData[key]) return { dist: sectorData[key], naics, band, widened: false };
  const cands = [[naics, 'all'], [naics.slice(0, 4), band], [naics.slice(0, 4), 'all'], [naics.slice(0, 3), band],
    [naics.slice(0, 3), 'all'], [naics.slice(0, 2), band], [naics.slice(0, 2), 'all']];
  for (const [n, b] of cands) if (sectorData[`${n}|${b}`]) return { dist: sectorData[`${n}|${b}`], naics: n, band: b, widened: true };
  return null;
}

function runBenchmark() {
  const out = $('#bm-result');
  const hoursIn = $('#bm-hours'), casesIn = $('#bm-cases');
  const hours = Number(hoursIn.value);
  const cases = Number(casesIn.value);
  const dartIn = $('#bm-dart').value, empIn = $('#bm-emp').value;
  const dartCases = dartIn === '' ? null : Number(dartIn);
  const employees = empIn === '' ? undefined : Number(empIn);
  bm.hours = hoursIn.value; bm.cases = casesIn.value; bm.dart = dartIn; bm.emp = empIn;
  if (location.hash.startsWith('#benchmark')) writeParams();

  const badHours = !(Number.isFinite(hours) && hours > 0);
  const badCases = !(Number.isFinite(cases) && cases >= 0 && Number.isInteger(cases));
  const badDart = dartCases != null && !(Number.isInteger(dartCases) && dartCases >= 0 && dartCases <= cases);
  hoursIn.setAttribute('aria-invalid', String(badHours));
  casesIn.setAttribute('aria-invalid', String(badCases));
  $('#bm-dart').setAttribute('aria-invalid', String(badDart));
  if (badHours || badCases) {
    out.replaceChildren(el('p', { class: 'error-note' }, 'Enter hours worked above zero and a whole number of recordable cases.'));
    return;
  }

  const rate = trir(
    { deaths: 0, daysAwayCases: 0, jobTransferCases: 0, otherRecordableCases: cases },
    { employeeHours: hours },
    employees === undefined ? {} : { employees },
  ).value;

  const found = findDist(bm.naics, bm.band);
  if (!found) {
    out.replaceChildren(el('p', { class: 'error-note' }, 'No peer group of at least 30 establishments exists for this industry or any broader code in its sector.'));
    return;
  }
  const { dist, naics: dNaics, band: dBand, widened } = found;
  const toDist = (d, n, b, metric = 'trir') => ({
    naics: n, sizeBand: b, n: d.n, zeroRate: d.zeroRate, percentiles: d[metric], aggregate: d[metric].aggregate,
  });
  const ranked = rankAgainst(rate, toDist(dist, dNaics, dBand));
  const r = Math.round(ranked.percentileRank);
  const flags = checkPlausibility({ hours, employees, totalCases: cases });
  const peerName = `NAICS ${dNaics} · ${dBand === 'all' ? 'all sizes' : `${dBand} employees`}`;
  const oneCase = 200000 / hours;
  const casesFor = (target) => Math.max(0, Math.floor((target * hours) / 200000 + 1e-9));
  const casesTxt = (n) => `${fmt(n)} case${n === 1 ? '' : 's'}`;

  // rank of the same rate in every published band of the chosen code
  const bandRows = ['all', ...BANDS].map((b) => {
    const d = sectorData[`${dNaics}|${b}`];
    if (!d) return { b, d: null };
    return { b, d, rank: rankAgainst(rate, toDist(d, dNaics, b)).percentileRank };
  });
  const ranks = bandRows.filter((x) => x.d).map((x) => x.rank);
  const spread = ranks.length > 1 ? Math.round(Math.max(...ranks)) - Math.round(Math.min(...ranks)) : 0;

  let dartBlock = null;
  if (dartCases != null && !badDart && dist.dart) {
    const dRate = (dartCases * 200000) / hours;
    const dRank = rankAgainst(dRate, toDist(dist, dNaics, dBand, 'dart')).percentileRank;
    dartBlock = el('div', { class: 'moves' },
      el('div', {}, el('span', {}, 'DART rate'), el('b', {}, dRate.toFixed(2)), el('span', {}, 'days away + restricted, per 100 FTE')),
      el('div', {}, el('span', {}, 'DART percentile'), el('b', { class: `result-rank-inline ${rankClass(dRank)}` }, `p${Math.round(dRank)}`), el('span', {}, `peer median ${dist.dart.p50.toFixed(2)}`)));
  }

  const copyBtn = el('button', { type: 'button', class: 'btn', onclick: async () => {
    writeParams();
    try { await navigator.clipboard.writeText(location.href); copyBtn.textContent = 'Link copied'; }
    catch { copyBtn.textContent = 'Copy the address bar'; }
    setTimeout(() => { copyBtn.textContent = 'Copy link to this result'; }, 1800);
  } }, 'Copy link to this result');

  out.replaceChildren(el('div', { class: 'result-card' },
    el('div', { class: 'result-top' },
      el('div', {},
        el('div', { class: 'tile-label' }, 'Your TRIR'),
        el('div', { class: 'result-rank plain' }, rate.toFixed(2))),
      el('div', {},
        el('div', { class: 'tile-label' }, 'Percentile · lower is better'),
        el('div', { class: `result-rank ${rankClass(r)}` }, `p${r}`)),
      el('div', {},
        el('div', { class: 'tile-label' }, 'Peer group'),
        el('div', { class: 'tile-sub', style: 'font-size:13px;color:var(--ink)' }, peerName),
        el('div', { class: 'tile-sub' }, `${fmt(dist.n)} establishments · ${pct(dist.zeroRate * 100, 0)} reported zero · median ${dist.trir.p50.toFixed(2)}`),
        widened ? el('p', { class: 'caveat' }, `The exact group had under 30 filers, so it was widened to ${peerName}.`) : null,
        dist.n < 50 ? el('p', { class: 'caveat' }, `Small group: quote this rank only with "n = ${dist.n}" beside it.`) : null)),
    el('p', { class: 'result-lede' }, ranked.interpretation),
    percentileStrip(dist.trir, rate, ranked.percentileRank, dist.zeroRate),

    el('h3', { class: 'subhead' }, 'What would change the verdict', el('span', {}, `at ${fmt(hours)} hours`)),
    el('div', { class: 'moves' },
      el('div', {}, el('span', {}, 'One case moves your rate by'), el('b', {}, oneCase.toFixed(2)), el('span', {}, oneCase > 1 ? 'at this size, a single case is noise' : 'points of TRIR')),
      el('div', {}, el('span', {}, 'To reach the peer median'), el('b', {}, `≤ ${casesTxt(casesFor(dist.trir.p50))}`), el('span', {}, `median ${dist.trir.p50.toFixed(2)}`)),
      el('div', {}, el('span', {}, 'To leave the worst quartile'), el('b', {}, `≤ ${casesTxt(casesFor(dist.trir.p75))}`), el('span', {}, `p75 ${dist.trir.p75.toFixed(2)}`)),
      el('div', {}, el('span', {}, 'Into the worst tenth at'), el('b', {}, `${fmt(casesFor(dist.trir.p90) + 1)}+ cases`), el('span', {}, `above p90 ${dist.trir.p90.toFixed(2)}`))),

    ranks.length > 1 ? el('div', {},
      el('h3', { class: 'subhead' }, 'Same site, every size band',
        el('span', {}, spread >= 10 ? `the band alone moves the rank ${spread} points` : `rank moves ${spread} points across bands`)),
      el('div', { class: 'bandrank' }, bandRows.map((x) => {
        const cur = x.b === dBand;
        if (!x.d) {
          return el('div', { class: 'bandrank-row is-off' },
            el('span', { class: 'bandrank-lab' }, x.b === 'all' ? 'All sizes' : x.b), el('span', { class: 'muted', style: 'font-size:11px' }, 'fewer than 30 filers'), el('span'));
        }
        return el('div', { class: `bandrank-row ${rankClass(x.rank)} ${cur ? 'is-cur' : ''}` },
          el('span', { class: 'bandrank-lab' }, x.b === 'all' ? 'All sizes' : x.b, ' ', el('small', {}, `n ${fmt(x.d.n)}`)),
          el('span', { class: 'bandrank-track' }, el('i', { style: `width:${x.rank}%` }), el('b')),
          el('span', { class: 'bandrank-val' }, `p${Math.round(x.rank)}`));
      })),
      el('p', { class: 'field-note' }, 'Choose the band the site genuinely belongs to before looking at the rank. The centre line is the median.')) : null,

    dartBlock ? el('div', {}, el('h3', { class: 'subhead' }, 'Severity: DART'), dartBlock) : null,

    flags.length ? el('div', { class: 'callout warn' },
      el('h3', {}, 'Data-quality flags'),
      el('ul', { style: 'margin:6px 0 0;padding-left:18px' },
        flags.map((fl) => el('li', {}, `${fl.severity.toUpperCase()}: ${fl.message}`)))) : null,
    badDart ? el('p', { class: 'caveat' }, 'DART cases must be a whole number no larger than the recordable cases.') : null,

    drill('Full percentile table for this peer group', () =>
      table(['Metric', ...PKEYS.map((p) => ({ label: p, num: true })), { label: 'Hours-weighted', num: true }], [
        ['TRIR', ...PKEYS.map((p) => num(dist.trir[p].toFixed(2))), num(dist.trir.aggregate.toFixed(2))],
        ['DART', ...PKEYS.map((p) => num(dist.dart[p].toFixed(2))), num(dist.dart.aggregate.toFixed(2))],
      ])),
    el('div', { class: 'result-actions' },
      copyBtn,
      el('button', { type: 'button', class: 'btn', onclick: () => {
        Object.assign(bm, BM_DEFAULT);
        $('#bm-hours').value = bm.hours; $('#bm-cases').value = bm.cases; $('#bm-dart').value = ''; $('#bm-emp').value = '';
        selectIndustry(bm.naics, { keepBand: true });
      } }, 'Reset to the story example'),
      el('a', { class: 'btn', href: 'story.html' }, 'Why the peer group matters')),
  ));
}

/* ==========================================================================
   Company search
   ========================================================================== */

let shardSet = null;
let topCompanies = null;

async function initCompany() {
  [shardSet, topCompanies] = await Promise.all([
    load('company-shards.json').then((a) => new Set(a)),
    load('top-companies.json'),
    load('naics-catalog.json').then((c) => (naicsCatalog = c)),
  ]);
  $('#company-count').textContent = `${fmt(228584)} resolved employers`;
  const top = $('#co-top');
  top.classList.remove('loading-block');
  top.replaceChildren(companyTable(topCompanies.slice(0, 40)));

  const input = $('#co-q');
  let timer;
  input.addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value;
    timer = setTimeout(() => runCompanySearch(q), 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; runCompanySearch(''); }
  });
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q');
  if (q) { input.value = q; runCompanySearch(q); }
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

let searchSeq = 0;
async function runCompanySearch(q, { open = false } = {}) {
  const out = $('#co-results');
  const status = $('#co-status');
  const seq = ++searchSeq;
  const query = (q || '').trim();
  history.replaceState(null, '', query ? `#company?q=${encodeURIComponent(query)}` : '#company');
  if (query.length < 2) {
    out.replaceChildren();
    status.replaceChildren('Type at least two letters. Press ', el('kbd', {}, '/'), ' to jump here.');
    return;
  }
  const { key } = normalizeName(query);
  if (!key) { out.replaceChildren(); return; }

  status.textContent = 'Searching…';
  const shard = shardFor(key);
  let pool = [];
  if (shard) {
    // 's' prefix mirrors the pipeline: Windows cannot write CON.json / AUX.json.
    try { pool = await load(`companies/s${shard}.json`); } catch { pool = []; }
  }
  if (seq !== searchSeq) return;          // a newer keystroke already owns the results
  // Notable employers are also matched on any token, so "pacific" finds
  // Georgia-Pacific even though the shard is keyed on the leading token.
  const extra = topCompanies.filter((c) => scoreMatch(query, c.n).score > 0);
  const seen = new Set();
  const merged = [...pool, ...extra].filter((c) => (seen.has(c.n) ? false : seen.add(c.n)));

  const all = merged
    .map((c) => ({ c, s: scoreMatch(query, c.n).score }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || b.c.h - a.c.h);
  const results = all.slice(0, 30).map((r) => r.c);

  if (!results.length) {
    status.textContent = `No employer matched "${query}". Search matches from the start of the company name as filed; try the legal name.`;
    out.replaceChildren();
    return;
  }
  status.textContent = all.length > results.length
    ? `Showing the 30 best of ${fmt(all.length)} matches, largest first among equals.`
    : `${fmt(results.length)} match${results.length === 1 ? '' : 'es'}.`;
  const terms = query.split(/\s+/).filter((t) => t.length > 1);
  const cards = results.map((c) => companyCard(c, terms));
  out.replaceChildren(el('div', {}, cards));
  if (open && cards[0]) {
    const d = $('details', cards[0]);
    if (d) d.open = true;
    cards[0].classList.add('flash');
    cards[0].scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  }
}

function highlight(text, terms) {
  if (!terms.length) return [text];
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'ig');
  return text.split(re).map((part, i) => (i % 2 ? el('mark', {}, part) : part));
}

function companyCard(c, terms = []) {
  const years = Object.keys(c.y).sort();
  const trend = years.map((y) => c.y[y].t);
  return el('div', { class: 'search-result' },
    el('div', { class: 'search-result-head' },
      el('div', {},
        el('div', { class: 'search-name' }, highlight(c.n, terms)),
        el('div', { style: 'margin-top:5px' },
          el('span', { class: 'pill' }, `${fmt(c.s)} site${c.s === 1 ? '' : 's'}`),
          el('span', { class: 'pill', title: naicsCatalog?.[c.na]?.t ?? '' }, `NAICS ${c.na}`),
          el('span', { class: 'pill' }, c.st.slice(0, 4).join(' ') + (c.st.length > 4 ? '…' : '')),
          el('span', { class: 'pill green' }, `TRIR ${c.t?.toFixed(2) ?? '—'}`),
          el('span', { class: 'pill' }, `DART ${c.d?.toFixed(2) ?? '—'}`))),
      el('div', { style: 'text-align:right' },
        spark(trend, { width: 90, height: 22 }),
        el('div', { class: 'muted', style: 'font-size:10px' }, `${years[0]}–${years[years.length - 1]} · ${fmtCompact(c.h)} hrs`))),
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
      el('p', { class: 'field-note' }, 'A rate far below its industry with very large hours per site can mean hours were filed for more than the sites listed. See Method, limitations.'),
    )));
}

function companyTable(list) {
  const openCompany = (c) => {
    const input = $('#co-q');
    input.value = c.n;
    runCompanySearch(c.n, { open: true });
  };
  return sortableTable([
    { label: 'Employer', key: (c) => c.n, cell: (c) => el('button', { type: 'button', class: 'linkbtn', onclick: () => openCompany(c) }, c.n) },
    { label: 'Sites', num: true, key: (c) => c.s, cell: (c) => fmt(c.s) },
    { label: 'Hours', num: true, key: (c) => c.h, cell: (c) => fmt(c.h) },
    { label: 'TRIR', num: true, key: (c) => c.t, cell: (c) => c.t?.toFixed(2) ?? '—' },
    { label: 'DART', num: true, key: (c) => c.d, cell: (c) => c.d?.toFixed(2) ?? '—' },
    { label: 'Trend', key: (c) => { const y = Object.keys(c.y).sort(); return (c.y[y[y.length - 1]]?.t ?? 0) - (c.y[y[0]]?.t ?? 0); },
      cell: (c) => spark(Object.keys(c.y).sort().map((y) => c.y[y].t)), num: true },
  ], list, { initial: 2, dir: 'desc' });
}

/* ==========================================================================
   Injury patterns
   ========================================================================== */

async function renderPatterns() {
  const o = await load('oiics.json');
  const days = daysAwayModel(o);
  const dayShare = new Map(days.rows.map((r) => [r.t, r.dayShare]));
  const events = $('#pt-events');
  events.classList.remove('loading-block');
  const maxE = Math.max(...o.eventDrill.map((e) => e.n));
  events.replaceChildren(el('div', { class: 'bars' }, o.eventDrill.map((e) => barRow({
    label: e.t, value: e.n, max: maxE,
    valueText: fmt(e.n), subText: `${pct(e.share)} · ${e.meanDaysAway ? `${Math.round(e.meanDaysAway)}d avg` : ''}`,
    body: () => el('div', {},
      el('div', { class: 'stat-line' },
        el('span', {}, el('b', {}, pct(e.share)), ' of all coded cases'),
        dayShare.has(e.t) ? el('span', {}, el('b', {}, pct(dayShare.get(e.t))), ' of all days away') : null,
        e.meanDaysAway ? el('span', {}, 'mean ', el('b', {}, e.meanDaysAway), ' days away per days-away case') : null),
      el('div', { class: 'mini-grid' },
        el('div', {}, el('h3', {}, 'Body part'),
          table(['Part', { label: 'Cases', num: true }], e.parts.map((p) => [p.t, num(fmt(p.n))]))),
        el('div', {}, el('h3', {}, 'Nature of injury'),
          table(['Nature', { label: 'Cases', num: true }], e.natures.map((p) => [p.t, num(fmt(p.n))]))),
        el('div', {}, el('h3', {}, 'Sector'),
          table(['Sector', { label: 'Cases', num: true }], e.sectors.map((p) => [sectorLabel(p.t), num(fmt(p.n))]))))),
  }))));

  const maxP = Math.max(...o.partDrill.map((p) => p.n));
  $('#pt-parts').replaceChildren(el('div', { class: 'bars' }, o.partDrill.map((p) => barRow({
    label: p.t, value: p.n, max: maxP,
    valueText: fmt(p.n), subText: `${pct(p.share)} · ${p.meanDaysAway ? `${Math.round(p.meanDaysAway)}d avg` : ''}`,
    body: () => table(['Event that caused it', { label: 'Cases', num: true }], p.events.map((e) => [e.t, num(fmt(e.n))])),
  }))));

  const shiftTotal = o.hourIntoShift.reduce((a, b) => a + b, 0);
  const firstFour = o.hourIntoShift.slice(0, 4).reduce((a, b) => a + b, 0) / shiftTotal * 100;
  const peak = o.hourIntoShift.indexOf(Math.max(...o.hourIntoShift));
  const shiftBox = el('div');
  columnsInto(shiftBox, o.hourIntoShift, o.hourIntoShift.map((_, i) => `${i}`), {
    tipLabel: (i) => `hour ${i}`,
    highlight: [peak], bracket: [0, 3, `first four hours: ${pct(firstFour)}`],
  });
  $('#pt-shift').replaceChildren(shiftBox,
    el('div', { class: 'legend' }, el('span', {}, `X: full hours since shift start · ${fmt(o.withShiftTiming)} cases with usable start and incident times`)));

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hiM = o.month.indexOf(Math.max(...o.month));
  const loM = o.month.indexOf(Math.min(...o.month));
  const monthBox = el('div');
  columnsInto(monthBox, o.month, MONTHS, { highlight: [hiM, loM], height: 220 });
  $('#pt-month').replaceChildren(monthBox,
    el('p', { class: 'fig-note' }, `${MONTHS[hiM]} is the heaviest month and ${MONTHS[loM]} the lightest: ` +
      `${pct((o.month[hiM] / o.month[loM] - 1) * 100, 0)} more cases. Months differ in working days and staffing, so read this as a seasonal pattern, not a rate.`));
}

/* ==========================================================================
   Sectors
   ========================================================================== */

async function renderSectors() {
  const [sectors, national] = await Promise.all([
    load('sectors.json'), load('national.json'), load('naics-catalog.json').then((c) => (naicsCatalog = c)),
  ]);
  const natYears = Object.keys(national).sort();
  const nat = national[natYears[natYears.length - 1]];
  const rows = Object.entries(sectors)
    .map(([code, d]) => {
      const years = Object.keys(d.years).sort();
      const latest = d.years[years[years.length - 1]];
      const first = d.years[years[0]];
      return { code, d, years, latest, change: years.length > 1 && first?.trir ? (latest.trir / first.trir - 1) * 100 : null };
    })
    .filter((r) => r.latest);
  const maxT = Math.max(...rows.map((r) => r.latest.trir), nat.trir);
  let sortBy = 'hours';
  const list = el('div', { class: 'sec-list' });
  const paint = () => {
    const sorted = [...rows].sort((a, b) => {
      if (sortBy === 'name') return sectorName(a.code).localeCompare(sectorName(b.code));
      if (sortBy === 'change') return (b.change ?? -1e9) - (a.change ?? -1e9);
      return (b.latest[sortBy] ?? 0) - (a.latest[sortBy] ?? 0);
    });
    list.replaceChildren(...sorted.map(sectorRow));
  };
  const sectorRow = ({ code, d, years, latest, change }) => {
    const tone = latest.trir > nat.trir * 1.25 ? 'bad' : latest.trir > nat.trir ? 'warn' : '';
    const det = el('details', { class: 'sec-row' },
      el('summary', {},
        el('span', { class: 'sec-name' }, el('b', {}, code), sectorName(code)),
        el('span', { class: 'sec-bar' },
          el('span', { class: 'bar-track', style: 'display:block' },
            el('span', { class: `bar-fill ${tone}`, style: `width:${(latest.trir / maxT) * 100}%` }),
            el('i', { class: 'avg-mark', style: `left:${(nat.trir / maxT) * 100}%`, title: `All filers ${nat.trir.toFixed(2)}` }))),
        el('span', { class: 'num sec-trir' }, latest.trir.toFixed(2)),
        el('span', { class: 'num sec-dart' }, latest.dart.toFixed(2)),
        el('span', { class: 'sec-trend' },
          spark(years.map((y) => d.years[y].trir)),
          change == null ? '' : el('span', {
            class: `${change > 0 ? 'up' : 'down'} ${d.hoursSwing >= 1.25 ? 'shaky' : ''}`,
            title: d.hoursSwing >= 1.25 ? `Filer mix changed: hours per establishment swung ${d.hoursSwing}× over these years` : null,
          }, `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(0)}%${d.hoursSwing >= 1.25 ? '*' : ''}`))),
    );
    let built = false;
    det.addEventListener('toggle', () => {
      if (!det.open || built) return;
      built = true;
      const maxSub = Math.max(...(d.subs ?? []).map((s) => s.trir), latest.trir);
      det.append(el('div', { class: 'sec-body' },
        el('div', { class: 'stat-line' },
          el('span', {}, el('b', {}, fmt(latest.est)), ' establishments'),
          el('span', {}, el('b', {}, fmtCompact(latest.hours)), ' hours in the latest year'),
          el('span', {}, 'DART ', el('b', {}, latest.dart.toFixed(2)))),
        d.hoursSwing >= 1.25 ? el('div', { class: 'callout warn' },
          el('p', { style: 'margin:0' },
            `Read this trend with care. Reported hours per establishment vary by ${d.hoursSwing}× across these ` +
            'years, so part of the rate movement reflects which employers filed rather than a change in safety ' +
            'performance. ITA filing populations are not a fixed panel.')) : null,
        d.subs?.length ? el('div', {},
          el('h3', { class: 'subhead' }, `Industries within · top ${d.subs.length} by hours`, el('span', {}, 'line = sector rate')),
          el('div', { class: 'bars compact' }, d.subs.map((s) => {
            const row = barRow({
              label: `${s.c} · ${s.t || '—'}`, value: s.trir, max: maxSub,
              valueText: s.trir.toFixed(2), subText: `n ${fmt(s.n)} · DART ${s.dart.toFixed(2)}`,
              tone: s.trir > latest.trir * 1.25 ? 'bad' : '',
            });
            $('.bar-track', row).append(el('i', { class: 'avg-mark', style: `left:${(latest.trir / maxSub) * 100}%` }));
            return row;
          }))) : null,
        table(['Year', { label: 'Establishments', num: true }, { label: 'Hours', num: true }, { label: 'TRIR', num: true }, { label: 'DART', num: true }],
          years.map((y) => [y, num(fmt(d.years[y].est)), num(fmt(d.years[y].hours)), num(d.years[y].trir.toFixed(2)), num(d.years[y].dart.toFixed(2))])),
        el('p', { class: 'field-note' }, el('a', { href: `#benchmark?naics=${code}&band=all` }, `Benchmark a site in sector ${code} →`)),
      ));
    });
    return det;
  };

  const tools = $('#sec-tools');
  tools.replaceChildren(
    el('span', { class: 'field-label' }, 'Sort by'),
    segmented('Sort sectors by', [
      { value: 'hours', label: 'Hours' }, { value: 'trir', label: 'TRIR' }, { value: 'dart', label: 'DART' },
      { value: 'change', label: '3-yr change' }, { value: 'name', label: 'Name' },
    ], sortBy, (v) => { sortBy = v; paint(); }),
    el('span', { class: 'legend', style: 'margin:0' },
      el('span', {}, el('i', { style: 'background:var(--ink);width:2px' }), `all filers ${nat.trir.toFixed(2)}`),
      el('span', {}, el('i', { style: 'background:var(--warn)' }), 'above all filers'),
      el('span', {}, el('i', { style: 'background:var(--bad)' }), '25%+ above'),
      el('span', {}, '* trend mixes in a change of filers')));

  const tableBox = $('#sec-table');
  tableBox.classList.remove('loading-block');
  tableBox.replaceChildren(
    el('div', { class: 'sec-head', 'aria-hidden': 'true' },
      el('span', {}, 'Sector'), el('span', {}, 'TRIR, CY' + natYears[natYears.length - 1]), el('span', { class: 'num' }, 'TRIR'),
      el('span', { class: 'num' }, 'DART'), el('span', { class: 'num' }, 'Trend')),
    list);
  paint();
}

/* ==========================================================================
   Method
   ========================================================================== */

async function renderMethod() {
  const f = await load('findings.json');
  const file = (path, what) => el('li', {}, el('a', { href: `${DATA}/${path}` }, path), el('span', {}, what));
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

    el('h3', {}, 'Days away by event'),
    el('p', {}, 'Finding 4 weights each OIICS event by its days-away cases times their mean days away, and divides by all ' +
      'days-away cases times the overall mean. It is a share of total days lost, not a rate, and it inherits the ' +
      'limitations of model-coded events below.'),

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
        'name may not surface for its trading name.'),
      el('li', {}, 'Industry names for rolled-up NAICS codes (4-digit groups) are the description most filers in that ' +
        'group wrote, not the official title; 2- and 3-digit codes use official NAICS titles.')),

    el('h3', {}, 'Data files'),
    el('p', {}, 'Every figure on this site is read from these static files. They are public and can be fetched directly.'),
    el('ul', { class: 'data-files' },
      file('findings.json', 'Headline figures, exclusions, extreme filings'),
      file('national.json', 'All-filer totals and rates by year'),
      file('sectors.json', 'Sector rates by year, top industries within'),
      file('benchmarks/32.json', 'Peer-group percentiles, one file per sector'),
      file('oiics.json', 'Case detail: event, body part, shift hour, month'),
      file('naics-catalog.json', 'Industry codes and filed descriptions'),
      file('top-companies.json', 'The largest employers, rolled up')),
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
let current = null;

/** A link such as #benchmark?naics=33 arriving while the view is already built. */
function applyParams(view) {
  if (view === 'benchmark' && naicsCatalog && industries.length) {
    Object.assign(bm, readParams());
    for (const k of ['hours', 'cases', 'dart', 'emp']) $(`#bm-${k}`).value = bm[k] ?? '';
    selectIndustry(bm.naics, { keepBand: true });
  } else if (view === 'company' && topCompanies) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
    if ($('#co-q').value !== q) { $('#co-q').value = q; runCompanySearch(q); }
  }
}

// Other sites in the programme link to #view-method and #view-benchmark (the section ids); accept both forms
const parseHash = () => {
  const [raw] = location.hash.slice(1).split('?');
  const name = raw.replace(/^view-/, '');
  return VIEWS[name] ? name : null;
};

async function show(name, { initial = false } = {}) {
  const view = VIEWS[name] ? name : 'findings';
  const changed = view !== current;
  current = view;
  for (const s of document.querySelectorAll('section.view')) s.classList.toggle('active', s.id === `view-${view}`);
  for (const a of document.querySelectorAll('nav.tabs a')) {
    if (a.dataset.view === view) {
      a.setAttribute('aria-current', 'page');
      // keep the active tab visible when the tab strip scrolls sideways on a phone
      a.parentElement.scrollLeft = Math.max(0, a.offsetLeft - 16);
    } else a.removeAttribute('aria-current');
  }
  document.title = `${$(`#view-${view} h2`)?.textContent ?? 'EHS Benchmarks'} · EHS Benchmarks`;
  // Switching tabs lands at the top of the new view, not the top of the page:
  // the masthead has already been read. Only when the tabs have scrolled away.
  if (changed && !initial) {
    const tabs = $('#tabs');
    const top = tabs.getBoundingClientRect().top + scrollY;
    if (scrollY > top) scrollTo({ top });
  }
  if (started.has(view) && location.hash.includes('?')) applyParams(view);
  if (!started.has(view)) {
    started.add(view);
    try {
      await VIEWS[view]();
    } catch (err) {
      started.delete(view);
      $(`#view-${view}`).append(el('p', { class: 'error-note' }, `Could not load this view: ${err.message}. `,
        el('button', { type: 'button', class: 'linkbtn', onclick: (e) => { e.target.parentElement.remove(); show(view); } }, 'Try again')));
    }
  }
}

window.addEventListener('hashchange', () => {
  const name = parseHash();
  if (name) show(name);
  else if (location.hash.length > 1) {
    // an in-page anchor (#f-hours, #main): make sure its view is showing, then let the browser scroll
    const target = document.getElementById(location.hash.slice(1));
    const view = target?.closest('section.view');
    if (view && !view.classList.contains('active')) show(view.id.replace('view-', ''));
  }
});

// Anchors to findings live inside the findings view; route them without leaving it
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href').slice(1);
  if (id === 'main') { e.preventDefault(); $('#main').focus(); return; }
  const target = document.getElementById(id);
  if (target && !VIEWS[id.split('?')[0].replace(/^view-/, '')]) {
    e.preventDefault();
    target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault();
  if (current !== 'company') location.hash = '#company';
  setTimeout(() => $('#co-q').focus(), 30);
});

(function boot() {
  const stored = localStorage.getItem('ehs-theme');
  if (stored) document.documentElement.dataset.theme = stored;

  const toggle = $('#theme-toggle');
  const isDark = () => {
    const set = document.documentElement.dataset.theme;
    return set ? set === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  // The icon shows the destination, so the label must say the action too —
  // "Theme" tells a screen-reader user nothing about what the button does.
  const labelToggle = () => {
    const to = isDark() ? 'light' : 'dark';
    toggle.setAttribute('aria-label', `Switch to ${to} mode`);
    toggle.setAttribute('title', `Switch to ${to} mode`);
  };
  labelToggle();
  toggle.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ehs-theme', next);
    labelToggle();
  });
  // Follow the system if the visitor has never made an explicit choice.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) labelToggle();
  });

  // the programme bar scrolls sideways on a phone: start it at this project
  const cur = $('.pgm .cur');
  if (cur) cur.parentElement.scrollLeft = Math.max(0, cur.offsetLeft - 60);

  load('findings.json').then((f) => {
    $('#meta-strip').textContent =
      `${fmt(f.totalRows)} filings · ${fmt(f.caseRows)} coded cases · CY${f.years[0]}–CY${f.years[f.years.length - 1]} · built ${f.generated}`;
  }).catch(() => { $('#meta-strip').textContent = 'Data unavailable'; });

  show(parseHash() || 'findings', { initial: true });
})();
