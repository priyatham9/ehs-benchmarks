import { OSHA_HOURS_BASIS, type BenchmarkDistribution, type SizeBand } from './types.js';
import { poissonExactInterval } from './intervals.js';
import { rankAgainst, sizeBandFor } from './benchmark.js';
import { shrinkRate, type GammaPoissonPrior } from './shrinkage.js';

/**
 * "Where do I rank?": shrunken TRIR and its percentile in a committed peer
 * distribution, with an uncertainty range and a plain-language caveat.
 *
 * Pure functions only. The CLI (scripts/where-do-i-rank.mjs) reads the committed
 * files and calls these.
 */

/** One peer group as stored in docs/data/benchmarks/<sector>.json (TRIR part). */
export interface StoredPeerGroup {
  n: number;
  zeroRate: number;
  trir: { p10: number; p25: number; p50: number; p75: number; p90: number; p95: number; p99: number; aggregate: number };
}

export interface PeerGroupChoice {
  key: string;
  naics: string;
  sizeBand: SizeBand | 'all';
  distribution: BenchmarkDistribution;
  /** Plain-language note when the match is coarser than asked, else null. */
  note: string | null;
}

function toDistribution(naics: string, band: SizeBand | 'all', g: StoredPeerGroup): BenchmarkDistribution {
  const { aggregate, ...percentiles } = g.trir;
  return { naics, sizeBand: band, n: g.n, percentiles, zeroRate: g.zeroRate, aggregate };
}

/**
 * Choose the most specific committed peer group for a NAICS code.
 *
 * Tries the full code, then 4, 3 and 2 digits. If `employees` is given, the
 * size band is matched first at every NAICS level; only when no level has that
 * band does it fall back to all sizes. Returns null when nothing matches.
 * `groups` is the merged content of the benchmark file(s) for the code's sector.
 */
export function selectPeerGroup(
  groups: Readonly<Record<string, StoredPeerGroup>>,
  naics: string,
  employees?: number,
): PeerGroupChoice | null {
  if (!/^\d{2,6}$/.test(naics)) throw new RangeError(`NAICS must be 2 to 6 digits (received "${naics}").`);
  const levels = [...new Set([naics, naics.slice(0, 4), naics.slice(0, 3), naics.slice(0, 2)])].filter(
    (l) => l.length >= 2 && l.length <= naics.length,
  );
  const band = employees === undefined ? null : sizeBandFor(employees);
  const bands: Array<SizeBand | 'all'> = band ? [band, 'all'] : ['all'];
  for (const b of bands) {
    for (const level of levels) {
      const g = groups[`${level}|${b}`];
      if (!g) continue;
      const notes: string[] = [];
      if (level !== naics) notes.push(`no peer group for NAICS ${naics}, used NAICS ${level}`);
      if (employees !== undefined && b === 'all') {
        notes.push(
          band
            ? `no peer group at ${band} employees, used all sizes`
            : 'fewer than 20 employees is outside the published size bands, used all sizes',
        );
      }
      return { key: `${level}|${b}`, naics: level, sizeBand: b, distribution: toDistribution(level, b, g), note: notes.length ? notes.join('; ') : null };
    }
  }
  return null;
}

/**
 * Read the prior for one 2-digit sector from outputs/shrinkage_by_naics2.csv
 * (columns naics2, year, metric, sites, pooled_rate, dispersion, prior_shape,
 * prior_weight_hours). Mean and shape come from the rounded columns pooled_rate
 * and prior_shape; rate = shape / mean. Returns null if the sector has no row
 * (fewer than 300 establishments).
 */
export function priorFromCsv(csv: string, sector: string, metric: 'trir' | 'dart' = 'trir'): (GammaPoissonPrior & { year: string }) | null {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0]?.split(',') ?? [];
  const col = (name: string) => head.indexOf(name);
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    if (f[col('naics2')] !== sector || f[col('metric')] !== metric) continue;
    const mean = Number(f[col('pooled_rate')]);
    const shapeText = f[col('prior_shape')];
    const shape = shapeText === 'inf' ? Infinity : Number(shapeText);
    const sites = Number(f[col('sites')]);
    const dispersion = Number(f[col('dispersion')]);
    return {
      mean, shape, rate: shape === Infinity ? Infinity : shape / mean, dispersion, sites,
      totalCases: NaN, totalHours: NaN, year: f[col('year')] ?? '',
    };
  }
  return null;
}

export interface RankInput {
  /** Total recordable cases in the period. */
  cases: number;
  /** Employee hours worked in the same period. */
  hours: number;
  prior: GammaPoissonPrior;
  distribution: BenchmarkDistribution;
  /** Level for both intervals, default 0.95. */
  confidence?: number;
}

export interface RankResult {
  raw: number;
  shrunk: number;
  /** Weight on the peer-group mean: near 1 means the establishment's own rate says little. */
  weight: number;
  /** Credible interval for the true TRIR (uses the peer-group prior). */
  credible: [number, number];
  /** Exact Garwood interval for the observed rate (uses only this establishment's count). */
  garwood: [number, number];
  /** Percentile of the shrunken TRIR: share of peers with a lower rate, so low is good. */
  percentile: number;
  /** Percentile of the credible interval's ends. */
  percentileRange: [number, number];
  /** Percentile of the raw rate, for comparison. */
  rawPercentile: number;
  /** Percentile of the Garwood interval's ends: the model-free range. */
  garwoodPercentileRange: [number, number];
  confidence: number;
  peerSites: number;
  caveat: string;
}

/** Shrunken TRIR, its percentile among peers, uncertainty ranges and a caveat. */
export function whereDoIRank(input: RankInput): RankResult {
  const confidence = input.confidence ?? 0.95;
  const s = shrinkRate(input.cases, input.hours, input.prior, confidence);
  const [gLo, gHi] = poissonExactInterval(input.cases, confidence);
  const scale = OSHA_HOURS_BASIS / input.hours;
  const garwood: [number, number] = [gLo * scale, gHi * scale];
  const pct = (r: number) => rankAgainst(r, input.distribution).percentileRank;
  const d = input.distribution;
  const pctText = (x: number) => Math.round(x).toString();
  const cl = Math.round(confidence * 100);
  const percentileRange: [number, number] = [pct(s.lower), pct(s.upper)];
  const caveat =
    `Lower is better: ${pctText(pct(s.shrunk))} means about ${pctText(pct(s.shrunk))}% of ${d.n.toLocaleString()} peers ` +
    `(NAICS ${d.naics}, ${d.sizeBand === 'all' ? 'all sizes' : d.sizeBand + ' employees'}) have a lower TRIR. ` +
    `One year of ${input.cases} case${input.cases === 1 ? '' : 's'} in ${Math.round(input.hours).toLocaleString()} hours is a noisy measurement: ` +
    `the ${cl}% range for the true percentile is ${pctText(percentileRange[0])} to ${pctText(percentileRange[1])}. ` +
    `The rate is pulled ${Math.round(s.weight * 100)}% of the way toward the industry average, and it is placed against peers' raw, unshrunken rates, ` +
    `so a small establishment sits nearer the middle than its raw rate would put it. ` +
    `Peers are self-reported OSHA filings, and the industry average is fitted separately from the peer file (see docs/method-shrinkage.md). This is a screening aid, not a safety rating.`;
  return {
    raw: s.raw,
    shrunk: s.shrunk,
    weight: s.weight,
    credible: [s.lower, s.upper],
    garwood,
    percentile: pct(s.shrunk),
    percentileRange,
    rawPercentile: pct(s.raw),
    garwoodPercentileRange: [pct(garwood[0]), pct(garwood[1])],
    confidence,
    peerSites: d.n,
    caveat,
  };
}
