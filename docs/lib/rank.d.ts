import { type BenchmarkDistribution, type SizeBand } from './types.js';
import { type GammaPoissonPrior } from './shrinkage.js';
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
    trir: {
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        p95: number;
        p99: number;
        aggregate: number;
    };
}
export interface PeerGroupChoice {
    key: string;
    naics: string;
    sizeBand: SizeBand | 'all';
    distribution: BenchmarkDistribution;
    /** Plain-language note when the match is coarser than asked, else null. */
    note: string | null;
}
/**
 * Choose the most specific committed peer group for a NAICS code.
 *
 * Tries the full code, then 4, 3 and 2 digits. If `employees` is given, the
 * size band is matched first at every NAICS level; only when no level has that
 * band does it fall back to all sizes. Returns null when nothing matches.
 * `groups` is the merged content of the benchmark file(s) for the code's sector.
 */
export declare function selectPeerGroup(groups: Readonly<Record<string, StoredPeerGroup>>, naics: string, employees?: number): PeerGroupChoice | null;
/**
 * Read the prior for one 2-digit sector from outputs/shrinkage_by_naics2.csv
 * (columns naics2, year, metric, sites, pooled_rate, dispersion, prior_shape,
 * prior_weight_hours). Mean and shape come from the rounded columns pooled_rate
 * and prior_shape; rate = shape / mean. Returns null if the sector has no row
 * (fewer than 300 establishments).
 */
export declare function priorFromCsv(csv: string, sector: string, metric?: 'trir' | 'dart'): (GammaPoissonPrior & {
    year: string;
}) | null;
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
export declare function whereDoIRank(input: RankInput): RankResult;
