/**
 * Build the static JSON the site loads, from OSHA ITA raw CSVs.
 *
 * All aggregation happens here, at build time. The browser never sees a raw
 * record — it fetches small precomputed files. That is what lets a static
 * GitHub Pages site serve 1.1M establishment records with no database.
 *
 * Usage:  node scripts/build-benchmarks.mjs <rawDataDir>
 */
import { mkdirSync, writeFileSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCsv, clean } from './lib/csv.mjs';
import {
  buildDistribution,
  checkPlausibility,
  isPublishable,
  normalizeName,
  sizeBandFor,
  totalRecordableCases,
  dartCases,
} from '../dist/index.js';

const RAW = process.argv[2] ?? resolve('data/raw');
const OUT = resolve('docs/data');
const MIN_GROUP = 30;          // smallest peer group we will publish a distribution for
const YEARS = ['2023', '2024', '2025'];

const SUMMARY_FILES = {
  2023: 'sum2023/ITA 300A Summary Data 2023 through 12-31-2024_v2.csv',
  2024: 'sum2024/ITA_300A_Summary_Data_2024_through_12-31-2025_v2.csv',
  2025: 'ita2025.csv',
};
const CASE_FILE = 'case2024/ITA_Case_Detail_Data_2024_through_12-31-2025.csv';

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'companies'), { recursive: true });

const log = (...a) => console.log(...a);
const write = (name, obj) => {
  const p = join(OUT, name);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(obj));
  return statSync(p).size;
};
/** Round to keep JSON small; 2dp is beyond the precision the inputs justify. */
const r2 = (n) => Math.round(n * 100) / 100;

function bump(map, key, init) {
  if (!map.has(key)) map.set(key, init());
  return map.get(key);
}

// ---------------------------------------------------------------------------
// Stage 0 — corporate entity resolution
// ---------------------------------------------------------------------------
//
// Grouping establishments by reported company_name does not work: the field
// frequently embeds the site itself. "Dollar Tree Stores, Inc. DC3 JOLIET, IL"
// and "Dollar Tree Stores, Inc. DC11 COWPENS, SC" are the same company but
// produce distinct keys — 14,619 of them in CY2025 alone.
//
// EIN is a real corporate identifier and collapses those correctly (Dollar* goes
// from 14,619 name groups to 3 EINs). But EIN cannot be trusted blindly: one
// value in the CY2025 file carries 9,320 establishments with 9,320 completely
// unrelated names — a placeholder that would merge unrelated employers into a
// single fictitious "company".
//
// So an EIN is accepted only when the names filed under it AGREE. Coherence is
// measured as the share of establishments sharing the modal leading token pair.
// Lowe's passes (every name begins "LOWE S COMPANIES") despite 1,788 distinct
// name strings; the placeholder EIN fails and its records fall back to
// name-based grouping.

const EIN_COHERENCE_THRESHOLD = 0.5;
const validEin = (raw) => {
  const d = clean(raw).replace(/\D/g, '');
  if (d.length !== 9) return null;
  if (/^(\d)\1{8}$/.test(d)) return null;   // 000000000, 111111111, ...
  return d;
};
const leadKey = (name) => normalizeName(name).tokens.slice(0, 2).join(' ');

log('[entities] pass 1 — testing EIN coherence');
const einNames = new Map();       // ein -> Map(leadKey -> count)
const einDisplay = new Map();     // ein -> Map(fullName -> count)

for (const year of YEARS) {
  for await (const rec of readCsv(join(RAW, SUMMARY_FILES[year]))) {
    const ein = validEin(rec.get('ein'));
    if (!ein) continue;
    const name = rec.str('company_name') || rec.str('establishment_name');
    if (!name) continue;
    const lk = leadKey(name);
    if (!lk) continue;
    const m = bump(einNames, ein, () => new Map());
    m.set(lk, (m.get(lk) ?? 0) + 1);
    const d = bump(einDisplay, ein, () => new Map());
    d.set(name, (d.get(name) ?? 0) + 1);
  }
}

const coherentEin = new Map();    // ein -> display name
let incoherent = 0;
for (const [ein, leads] of einNames) {
  let total = 0;
  let best = null;
  let bestN = 0;
  for (const [lk, n] of leads) {
    total += n;
    if (n > bestN) { bestN = n; best = lk; }
  }
  if (total > 0 && bestN / total >= EIN_COHERENCE_THRESHOLD) {
    // Derive the display name from the longest token prefix COMMON to the
    // group's names. Picking any single reported name keeps that filer's store
    // identifier ("Lowe's Companies, INC LOWE S OF KATY"); the shared prefix
    // strips it and leaves "Lowe's Companies, INC".
    const names = [...einDisplay.get(ein).entries()]
      .filter(([n]) => leadKey(n) === best)
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
    const tokenLists = names.map(([n]) => n.split(/\s+/).filter(Boolean));
    let common = tokenLists[0] ?? [];
    for (const list of tokenLists.slice(1, 400)) {
      let i = 0;
      while (i < common.length && i < list.length && common[i].toUpperCase() === list[i].toUpperCase()) i++;
      common = common.slice(0, i);
      if (common.length <= 1) break;
    }
    const prefixName = common.join(' ').replace(/[\s,\-–—]+$/, '');
    coherentEin.set(ein, prefixName.length >= 3 ? prefixName : (names[0]?.[0] ?? best));
  } else {
    incoherent++;
  }
}
log(`           ${coherentEin.size.toLocaleString()} coherent EINs, ${incoherent.toLocaleString()} rejected as shared/placeholder`);
einNames.clear();
einDisplay.clear();

// ---------------------------------------------------------------------------
// Stage 1 — establishments
// ---------------------------------------------------------------------------

/** naics -> sizeBand -> {trir:[], dart:[], cases, dartCasesTotal, hours} */
const groups = new Map();
/** normalized company key -> per-year rollup */
const companies = new Map();
/** year -> national totals */
const national = new Map();
/** 2-digit sector -> year -> totals */
const sectorTrend = new Map();
/** naics code -> most frequently reported industry description */
const naicsTitles = new Map();

const quality = {
  totalRows: 0,
  excludedZeroHours: 0,
  excludedImplausible: 0,
  includedRecords: 0,
  rawHoursAll: 0,
  rawHoursIncluded: 0,
  rawCasesAll: 0,
  rawCasesIncluded: 0,
  excludedBySector: new Map(),
  extremeRecords: [],
};

function addToGroup(naics, band, trirVal, dartVal, cases, dartC, hours) {
  const g = bump(groups, naics, () => new Map());
  for (const b of [band, 'all']) {
    const e = bump(g, b, () => ({ trir: [], dart: [], cases: 0, dartCases: 0, hours: 0 }));
    e.trir.push(trirVal);
    e.dart.push(dartVal);
    e.cases += cases;
    e.dartCases += dartC;
    e.hours += hours;
  }
}

for (const year of YEARS) {
  const file = join(RAW, SUMMARY_FILES[year]);
  log(`\n[summary ${year}] reading ${SUMMARY_FILES[year]}`);
  let n = 0;

  const natl = bump(national, year, () => ({
    establishments: 0, hours: 0, cases: 0, dartCases: 0, deaths: 0, excluded: 0,
  }));

  for await (const rec of readCsv(file)) {
    n++;
    quality.totalRows++;

    const hours = rec.num('total_hours_worked');
    const employees = rec.num('annual_average_employees');
    const naics = rec.str('naics_code');
    const counts = {
      deaths: rec.num('total_deaths') ?? 0,
      daysAwayCases: rec.num('total_dafw_cases') ?? 0,
      jobTransferCases: rec.num('total_djtr_cases') ?? 0,
      otherRecordableCases: rec.num('total_other_cases') ?? 0,
    };
    const cases = totalRecordableCases(counts);
    const dartC = dartCases(counts);

    if (hours !== null && hours > 0) { quality.rawHoursAll += hours; }
    quality.rawCasesAll += cases;

    // The library's own guard decides inclusion — the site and the package
    // therefore cannot disagree about what counts as a usable record.
    const flags = checkPlausibility({ hours: hours ?? 0, employees: employees ?? undefined, totalCases: cases });
    if (!isPublishable(flags)) {
      natl.excluded++;
      const zero = flags.some((f) => f.code === 'ZERO_HOURS');
      if (zero) quality.excludedZeroHours++;
      else quality.excludedImplausible++;

      // Drill-down for the data-quality finding: which sectors are worst, and
      // what do the extreme records actually look like? These are public
      // records published by OSHA, retained here as evidence for the claim.
      const exSector = bump(quality.excludedBySector, naics.slice(0, 2), () => ({ zero: 0, implausible: 0, hours: 0 }));
      if (zero) exSector.zero++; else { exSector.implausible++; exSector.hours += hours ?? 0; }

      if (!zero && employees && hours && hours / employees > 100_000) {
        quality.extremeRecords.push({
          name: rec.str('establishment_name').slice(0, 48),
          state: rec.str('state'),
          naics,
          year,
          hours,
          employees,
          perEmployee: Math.round(hours / employees),
        });
      }
      continue;
    }

    quality.includedRecords++;
    quality.rawHoursIncluded += hours;
    quality.rawCasesIncluded += cases;

    natl.establishments++;
    natl.hours += hours;
    natl.cases += cases;
    natl.dartCases += dartC;
    natl.deaths += counts.deaths;

    // Descriptions are filed against the full 6-digit code. Tally them at every
    // prefix level too, so a 3- or 4-digit peer group can still be labelled with
    // the description most common among its members.
    const desc = rec.str('industry_description');
    if (desc && naics) {
      for (const level of [naics.slice(0, 2), naics.slice(0, 3), naics.slice(0, 4), naics]) {
        if (level.length < 2) continue;
        const t = bump(naicsTitles, level, () => new Map());
        t.set(desc, (t.get(desc) ?? 0) + 1);
      }
    }

    const sector = naics.slice(0, 2);
    const st = bump(bump(sectorTrend, sector, () => new Map()), year, () => ({ hours: 0, cases: 0, dartCases: 0, est: 0 }));
    st.hours += hours; st.cases += cases; st.dartCases += dartC; st.est++;

    // Company rollup, across all years, keyed by resolved corporate entity.
    const rawName = rec.str('company_name') || rec.str('establishment_name');
    const ein = validEin(rec.get('ein'));
    const resolvedName = (ein && coherentEin.get(ein)) || rawName;
    // A coherent EIN keys the group directly; otherwise fall back to the
    // normalized name, which is the best available identifier for that record.
    const key = ein && coherentEin.has(ein) ? `E:${ein}` : normalizeName(rawName).key;
    if (key) {
      const c = bump(companies, key, () => ({
        name: clean(resolvedName), ein: ein && coherentEin.has(ein) ? ein : null,
        years: {}, states: new Map(), naics: new Map(),
      }));
      if (!c.years[year]) c.years[year] = { est: 0, hours: 0, cases: 0, dartCases: 0 };
      c.years[year].est++;
      c.years[year].hours += hours;
      c.years[year].cases += cases;
      c.years[year].dartCases += dartC;

      // Per-state rollup powers the company drill-down.
      const stCode = rec.str('state');
      if (stCode) {
        const s = bump(c.states, stCode, () => ({ est: 0, hours: 0, cases: 0, dartCases: 0 }));
        s.est++; s.hours += hours; s.cases += cases; s.dartCases += dartC;
      }
      c.naics.set(naics, (c.naics.get(naics) ?? 0) + 1);
    }

    // Benchmark groups are built from the most recent year only, so a lookup
    // compares an establishment against current peers rather than a 3-year blend.
    if (year === YEARS[YEARS.length - 1]) {
      const band = sizeBandFor(employees ?? 0);
      if (band && hours >= 10_000) {
        const t = (cases * 200_000) / hours;
        const d = (dartC * 200_000) / hours;
        for (const level of [naics.slice(0, 2), naics.slice(0, 3), naics.slice(0, 4), naics]) {
          if (level.length >= 2) addToGroup(level, band, t, d, cases, dartC, hours);
        }
      }
    }
  }
  log(`  rows=${n.toLocaleString()} excluded=${natl.excluded.toLocaleString()} included=${natl.establishments.toLocaleString()}`);
}

// ---------------------------------------------------------------------------
// Stage 2 — benchmark distributions
// ---------------------------------------------------------------------------

// Benchmarks are sharded by 2-digit sector. The lookup tool asks for one sector
// at a time, so shipping all 3,842 peer groups on first paint would be waste.
const benchmarksBySector = new Map();
const naicsCatalog = {};
let published = 0;
for (const [naics, bands] of groups) {
  const benchmarks = bump(benchmarksBySector, naics.slice(0, 2), () => ({}));
  for (const [band, e] of bands) {
    if (e.trir.length < MIN_GROUP) continue;
    const t = buildDistribution(e.trir, { naics, sizeBand: band, totalCases: e.cases, totalHours: e.hours });
    const d = buildDistribution(e.dart, { naics, sizeBand: band, totalCases: e.dartCases, totalHours: e.hours });
    benchmarks[`${naics}|${band}`] = {
      n: t.n,
      zeroRate: r2(t.zeroRate),
      trir: {
        p10: r2(t.percentiles.p10), p25: r2(t.percentiles.p25), p50: r2(t.percentiles.p50),
        p75: r2(t.percentiles.p75), p90: r2(t.percentiles.p90), p95: r2(t.percentiles.p95),
        p99: r2(t.percentiles.p99), aggregate: r2(t.aggregate),
      },
      dart: {
        p10: r2(d.percentiles.p10), p25: r2(d.percentiles.p25), p50: r2(d.percentiles.p50),
        p75: r2(d.percentiles.p75), p90: r2(d.percentiles.p90), p95: r2(d.percentiles.p95),
        p99: r2(d.percentiles.p99), aggregate: r2(d.aggregate),
      },
    };
    published++;
    if (!naicsCatalog[naics]) {
      const titles = naicsTitles.get(naics);
      const best = titles ? [...titles.entries()].sort((a, b) => b[1] - a[1])[0][0] : '';
      naicsCatalog[naics] = { t: best.slice(0, 70), s: naics.slice(0, 2) };
    }
  }
}
log(`\n[benchmarks] ${published.toLocaleString()} peer groups across ${benchmarksBySector.size} sectors (min n=${MIN_GROUP})`);

// ---------------------------------------------------------------------------
// Stage 3 — company index, sharded by name prefix
// ---------------------------------------------------------------------------

const shards = new Map();
const companyList = [];

for (const [key, c] of companies) {
  const totals = { est: 0, hours: 0, cases: 0, dartCases: 0 };
  const years = {};
  for (const y of YEARS) {
    const v = c.years[y];
    if (!v) continue;
    years[y] = {
      e: v.est, h: Math.round(v.hours), c: v.cases,
      t: v.hours > 0 ? r2((v.cases * 200_000) / v.hours) : null,
      d: v.hours > 0 ? r2((v.dartCases * 200_000) / v.hours) : null,
    };
    totals.est = Math.max(totals.est, v.est);
    totals.hours += v.hours; totals.cases += v.cases; totals.dartCases += v.dartCases;
  }
  if (totals.hours <= 0) continue;

  const topNaics = [...c.naics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  // The normalized key is NOT stored: the client re-derives it from `n` using
  // the same normalizeName() this pipeline used. Storing both would inflate the
  // index by roughly a quarter for no information gain.
  // Drill-down: per-state and per-industry breakdown, biggest first.
  const byState = [...c.states.entries()]
    .sort((a, b) => b[1].hours - a[1].hours)
    .slice(0, 60)
    .map(([code, v]) => ({
      s: code, e: v.est, h: Math.round(v.hours), c: v.cases,
      t: v.hours > 0 ? r2((v.cases * 200_000) / v.hours) : null,
    }));
  const byNaics = [...c.naics.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code, n]) => ({ c: code, e: n }));

  const entry = {
    n: c.name,
    s: totals.est,
    st: [...c.states.keys()].slice(0, 6),
    na: topNaics,
    y: years,
    t: r2((totals.cases * 200_000) / totals.hours),
    d: r2((totals.dartCases * 200_000) / totals.hours),
    h: Math.round(totals.hours),
  };
  // Drill-down only where there is something to drill into. For a single-site
  // employer the top-level figures already say everything the breakdown would.
  if (totals.est > 1) {
    entry.bs = byState;
    entry.bn = byNaics;
  }

  // Shard on the DISPLAY name, not the entity key: the client searches by name
  // and must be able to resolve the right shard without knowing the EIN.
  Object.defineProperty(entry, '__key', {
    value: normalizeName(c.name).key || key,
    enumerable: false,
  });
  companyList.push(entry);
}

/**
 * Adaptive sharding.
 *
 * A fixed 2-character prefix leaves pathological shards — DO.json measured
 * 2.9 MB — which would stall a search on a common prefix. Any oversized shard
 * is split one character deeper. The manifest records which depths exist so the
 * client resolves the correct file in a single request.
 */
const SHARD_SPLIT_BYTES = 400 * 1024;
const MAX_SHARD_DEPTH = 6;
/** Guards against Windows reserved device filenames — see the write loop below. */
const SHARD_PREFIX = 's';
const shardKey = (key, depth) =>
  (key.replace(/[^A-Z0-9]/g, '').slice(0, depth) || 'Z'.repeat(depth)).padEnd(depth, '_');

for (const entry of companyList) {
  bump(shards, shardKey(entry.__key, 2), () => []).push(entry);
}

// Split repeatedly, not once: a single pass left a 2.1 MB shard because some
// 3-character prefixes are themselves very common ("DOL", "AME").
for (let depth = 3; depth <= MAX_SHARD_DEPTH; depth++) {
  let splitAny = false;
  for (const [name, entries] of [...shards]) {
    if (name.length !== depth - 1) continue;
    if (JSON.stringify(entries).length <= SHARD_SPLIT_BYTES) continue;
    // A shard whose members all share the same key cannot be split further.
    const deeper = new Set(entries.map((e) => shardKey(e.__key, depth)));
    if (deeper.size < 2) continue;
    shards.delete(name);
    splitAny = true;
    for (const entry of entries) bump(shards, shardKey(entry.__key, depth), () => []).push(entry);
  }
  if (!splitAny) break;
}

let shardBytes = 0;
let maxShard = 0;
for (const [shard, entries] of shards) {
  entries.sort((a, b) => b.h - a.h);
  // Shard files are prefixed because Windows reserves CON, PRN, AUX, NUL,
  // COM1-9 and LPT1-9 as device names — "CON.json" cannot be created at all,
  // and the write fails silently, leaving every "Con..." company unsearchable.
  const bytes = write(`companies/${SHARD_PREFIX}${shard}.json`, entries);
  shardBytes += bytes;
  maxShard = Math.max(maxShard, bytes);
}
log(`[companies] ${companyList.length.toLocaleString()} companies across ${shards.size} shards`);
log(`            total ${(shardBytes / 1e6).toFixed(1)} MB on disk, largest shard ${(maxShard / 1024).toFixed(0)} KB`);

// Largest employers by qualified hours — the site's default view, so no search
// is needed to see something meaningful on first load.
const topCompanies = [...companyList]
  .filter((c) => c.s >= 5 && c.h >= 1_000_000)
  .sort((a, b) => b.h - a.h)
  .slice(0, 150);

// ---------------------------------------------------------------------------
// Stage 4 — case detail (OIICS)
// ---------------------------------------------------------------------------

const oiics = {
  event: new Map(), part: new Map(), nature: new Map(), source: new Map(),
  bySector: new Map(),
  /** event title -> drill-down detail (body parts, natures, severity, sectors) */
  eventDetail: new Map(),
  /** body part title -> which events cause it */
  partDetail: new Map(),
  hourIntoShift: new Array(16).fill(0),
  month: new Array(12).fill(0),
  outcomeDays: { dafwTotal: 0, dafwCases: 0, djtrTotal: 0, djtrCases: 0 },
  totalCases: 0,
  withShiftTiming: 0,
};

function toMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

const casePath = join(RAW, CASE_FILE);
log(`\n[cases] reading ${CASE_FILE} (this file is ~500 MB)`);
let caseRows = 0;
for await (const rec of readCsv(casePath)) {
  caseRows++;
  oiics.totalCases++;

  const tally = (map, code, title) => {
    const c = clean(code); const t = clean(title);
    if (!c || !t) return;
    const e = bump(map, c, () => ({ title: t, n: 0 }));
    e.n++;
  };
  tally(oiics.event, rec.str('event_code_pred'), rec.str('event_title_pred'));
  tally(oiics.part, rec.str('part_code_pred'), rec.str('part_title_pred'));
  tally(oiics.nature, rec.str('nature_code_pred'), rec.str('nature_title_pred'));
  tally(oiics.source, rec.str('source_code_pred'), rec.str('source_title_pred'));

  const sector = rec.str('naics_code').slice(0, 2);
  const ev = clean(rec.str('event_title_pred'));
  const pt = clean(rec.str('part_title_pred'));
  const nt = clean(rec.str('nature_title_pred'));
  const daysAway = rec.num('dafw_num_away') ?? 0;

  if (sector && ev) {
    const s = bump(oiics.bySector, sector, () => new Map());
    s.set(ev, (s.get(ev) ?? 0) + 1);
  }

  // Cross-tabs. Each key drills one level deeper than the headline count:
  // "Falls" -> which body parts, what injury, how many days lost, which sectors.
  if (ev) {
    const e = bump(oiics.eventDetail, ev, () => ({
      n: 0, parts: new Map(), natures: new Map(), sectors: new Map(),
      daysTotal: 0, daysCases: 0,
    }));
    e.n++;
    if (pt) e.parts.set(pt, (e.parts.get(pt) ?? 0) + 1);
    if (nt) e.natures.set(nt, (e.natures.get(nt) ?? 0) + 1);
    if (sector) e.sectors.set(sector, (e.sectors.get(sector) ?? 0) + 1);
    if (daysAway > 0) { e.daysTotal += daysAway; e.daysCases++; }
  }
  if (pt) {
    const p = bump(oiics.partDetail, pt, () => ({ n: 0, events: new Map(), daysTotal: 0, daysCases: 0 }));
    p.n++;
    if (ev) p.events.set(ev, (p.events.get(ev) ?? 0) + 1);
    if (daysAway > 0) { p.daysTotal += daysAway; p.daysCases++; }
  }

  // Hours into shift: how long had the worker been on shift when hurt?
  const start = toMinutes(rec.str('time_started_work'));
  const inc = toMinutes(rec.str('time_of_incident'));
  if (start !== null && inc !== null && rec.str('time_unknown') !== '1') {
    let delta = (inc - start) / 60;
    if (delta < 0) delta += 24;          // shift crossed midnight
    if (delta >= 0 && delta < 16) {
      oiics.hourIntoShift[Math.floor(delta)]++;
      oiics.withShiftTiming++;
    }
  }

  const d = rec.str('date_of_incident');       // e.g. 16JAN2024
  const mm = MONTHS[d.slice(2, 5).toUpperCase()];
  if (mm !== undefined) oiics.month[mm]++;

  const dafw = rec.num('dafw_num_away');
  const djtr = rec.num('djtr_num_tr');
  if (dafw !== null && dafw > 0) { oiics.outcomeDays.dafwTotal += dafw; oiics.outcomeDays.dafwCases++; }
  if (djtr !== null && djtr > 0) { oiics.outcomeDays.djtrTotal += djtr; oiics.outcomeDays.djtrCases++; }
}
log(`  case rows=${caseRows.toLocaleString()}  with usable shift timing=${oiics.withShiftTiming.toLocaleString()}`);

const topN = (map, n = 15) =>
  [...map.entries()]
    .map(([code, v]) => ({ code, title: v.title, n: v.n, share: r2((v.n / oiics.totalCases) * 100) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, n);

// ---------------------------------------------------------------------------
// Stage 5 — write outputs
// ---------------------------------------------------------------------------

const nationalOut = {};
for (const [y, v] of national) {
  nationalOut[y] = {
    establishments: v.establishments,
    hours: Math.round(v.hours),
    cases: v.cases,
    deaths: v.deaths,
    excluded: v.excluded,
    trir: r2((v.cases * 200_000) / v.hours),
    dart: r2((v.dartCases * 200_000) / v.hours),
  };
}

const sectorsOut = {};
for (const [sector, byYear] of sectorTrend) {
  const row = {};
  for (const [y, v] of byYear) {
    if (v.est < MIN_GROUP) continue;
    row[y] = { est: v.est, trir: r2((v.cases * 200_000) / v.hours), dart: r2((v.dartCases * 200_000) / v.hours), hours: Math.round(v.hours) };
  }
  if (!Object.keys(row).length) continue;

  // Year-over-year comparability: the set of establishments that file changes
  // between years, so a rate move is partly composition and partly real. Expose
  // the hours swing so the site can say so rather than imply a clean trend.
  const yrs = Object.keys(row).sort();
  const hoursPerEst = yrs.map((y) => row[y].hours / row[y].est);
  const swing = Math.max(...hoursPerEst) / Math.min(...hoursPerEst);

  // Drill-down: the sub-industries inside this sector, ranked by hours, so a
  // sector rate can be decomposed into the industries that produced it.
  const subs = [];
  for (const [naics, bands] of groups) {
    if (naics.length !== 4 || naics.slice(0, 2) !== sector) continue;
    const all = bands.get('all');
    if (!all || all.trir.length < MIN_GROUP) continue;
    subs.push({
      c: naics,
      t: naicsCatalog[naics]?.t ?? '',
      n: all.trir.length,
      trir: r2((all.cases * 200_000) / all.hours),
      dart: r2((all.dartCases * 200_000) / all.hours),
      h: Math.round(all.hours),
    });
  }
  subs.sort((a, b) => b.h - a.h);

  sectorsOut[sector] = { years: row, subs: subs.slice(0, 20), hoursSwing: r2(swing) };
}

// The headline data-quality finding, computed rather than asserted.
const naiveTrir = r2((quality.rawCasesAll * 200_000) / quality.rawHoursAll);
const correctedTrir = r2((quality.rawCasesIncluded * 200_000) / quality.rawHoursIncluded);
const findings = {
  generated: new Date().toISOString().slice(0, 10),
  years: YEARS,
  totalRows: quality.totalRows,
  includedRecords: quality.includedRecords,
  excludedZeroHours: quality.excludedZeroHours,
  excludedImplausible: quality.excludedImplausible,
  excludedShare: r2(((quality.totalRows - quality.includedRecords) / quality.totalRows) * 100),
  hoursDiscardedShare: r2((1 - quality.rawHoursIncluded / quality.rawHoursAll) * 100),
  naiveTrir,
  correctedTrir,
  errorFactor: r2(correctedTrir / naiveTrir),
  caseRows: oiics.totalCases,
  withShiftTiming: oiics.withShiftTiming,
  meanDaysAway: r2(oiics.outcomeDays.dafwTotal / Math.max(1, oiics.outcomeDays.dafwCases)),
  meanDaysRestricted: r2(oiics.outcomeDays.djtrTotal / Math.max(1, oiics.outcomeDays.djtrCases)),

  // Drill-down beneath the headline exclusion number.
  excludedBySector: [...quality.excludedBySector.entries()]
    .map(([s, v]) => ({ s, zero: v.zero, implausible: v.implausible, hours: Math.round(v.hours) }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 15),
  extremeRecords: quality.extremeRecords
    .sort((a, b) => b.perEmployee - a.perEmployee)
    .slice(0, 10)
    .map((r) => ({ ...r, hours: Math.round(r.hours) })),
  extremeRecordCount: quality.extremeRecords.length,
};

const sizes = {};
let benchBytes = 0;
for (const [sector, obj] of benchmarksBySector) {
  benchBytes += write(`benchmarks/${sector}.json`, obj);
}
sizes['naics-catalog.json'] = write('naics-catalog.json', naicsCatalog);
sizes['national.json'] = write('national.json', nationalOut);
sizes['sectors.json'] = write('sectors.json', sectorsOut);
sizes['findings.json'] = write('findings.json', findings);
sizes['top-companies.json'] = write('top-companies.json', topCompanies);
const topMap = (m, n) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t, c]) => ({ t, n: c }));

// Drill-down payloads: one extra level under each headline OIICS category.
const eventDrill = [...oiics.eventDetail.entries()]
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, 14)
  .map(([title, d]) => ({
    t: title,
    n: d.n,
    share: r2((d.n / oiics.totalCases) * 100),
    meanDaysAway: d.daysCases ? r2(d.daysTotal / d.daysCases) : null,
    daysCases: d.daysCases,
    parts: topMap(d.parts, 6),
    natures: topMap(d.natures, 6),
    sectors: topMap(d.sectors, 6),
  }));

const partDrill = [...oiics.partDetail.entries()]
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, 12)
  .map(([title, d]) => ({
    t: title,
    n: d.n,
    share: r2((d.n / oiics.totalCases) * 100),
    meanDaysAway: d.daysCases ? r2(d.daysTotal / d.daysCases) : null,
    events: topMap(d.events, 6),
  }));

sizes['oiics.json'] = write('oiics.json', {
  totalCases: oiics.totalCases,
  event: topN(oiics.event, 20),
  part: topN(oiics.part, 20),
  nature: topN(oiics.nature, 20),
  source: topN(oiics.source, 20),
  eventDrill,
  partDrill,
  hourIntoShift: oiics.hourIntoShift,
  withShiftTiming: oiics.withShiftTiming,
  month: oiics.month,
  outcomeDays: {
    meanDaysAway: findings.meanDaysAway,
    meanDaysRestricted: findings.meanDaysRestricted,
    dafwCases: oiics.outcomeDays.dafwCases,
    djtrCases: oiics.outcomeDays.djtrCases,
  },
  bySector: Object.fromEntries(
    [...oiics.bySector.entries()]
      .filter(([, m]) => [...m.values()].reduce((a, b) => a + b, 0) >= 500)
      .map(([s, m]) => [s, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => ({ t, n }))]),
  ),
});
sizes['company-shards.json'] = write('company-shards.json', [...shards.keys()].sort());

// The site imports the compiled library itself rather than reimplementing the
// rate maths in browser JavaScript. If they ever disagreed, the published
// benchmark and the on-page calculator would silently diverge.
const LIB_OUT = resolve('docs/lib');
mkdirSync(LIB_OUT, { recursive: true });
let copied = 0;
for (const f of readdirSync(resolve('dist'))) {
  if (f.endsWith('.js') || f.endsWith('.d.ts')) {
    copyFileSync(resolve('dist', f), join(LIB_OUT, f));
    copied++;
  }
}
log(`\n[site] copied ${copied} compiled library files into docs/lib/`);

log('\n--- OUTPUT SIZES ---');
for (const [f, b] of Object.entries(sizes)) log(`  ${f.padEnd(26)} ${(b / 1024).toFixed(0).padStart(7)} KB`);
log(`  ${'benchmarks/*.json'.padEnd(26)} ${(benchBytes / 1024).toFixed(0).padStart(7)} KB (${benchmarksBySector.size} sectors, lazy)`);
log(`  ${'companies/*.json'.padEnd(26)} ${(shardBytes / 1024).toFixed(0).padStart(7)} KB (${shards.size} shards, lazy)`);
const eager = sizes['national.json'] + sizes['sectors.json'] + sizes['findings.json']
  + sizes['oiics.json'] + sizes['top-companies.json'] + sizes['naics-catalog.json']
  + sizes['company-shards.json'];
log(`  ${'>> INITIAL PAGE LOAD'.padEnd(26)} ${(eager / 1024).toFixed(0).padStart(7)} KB uncompressed`);

log('\n--- HEADLINE FINDINGS ---');
log(`  rows processed        ${findings.totalRows.toLocaleString()}`);
log(`  excluded              ${(findings.totalRows - findings.includedRecords).toLocaleString()} (${findings.excludedShare}%)`);
log(`  hours discarded       ${findings.hoursDiscardedShare}%`);
log(`  naive TRIR            ${findings.naiveTrir}`);
log(`  corrected TRIR        ${findings.correctedTrir}   (${findings.errorFactor}x)`);
log(`  case records          ${findings.caseRows.toLocaleString()}`);
log(`  mean days away/case   ${findings.meanDaysAway}`);
