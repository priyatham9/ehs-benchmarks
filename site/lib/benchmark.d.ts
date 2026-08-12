import type { BenchmarkDistribution, BenchmarkResult, SizeBand } from './types.js';
/** Assign an establishment to an ITA size band by annual average employees. */
export declare function sizeBandFor(employees: number): SizeBand | null;
/**
 * Nearest-rank percentile on an ascending sorted array.
 *
 * Uses nearest-rank rather than linear interpolation because injury-rate
 * distributions are heavily zero-inflated (42.1% of NAICS 325 establishments
 * report zero recordables in CY2025). Interpolating across that spike invents
 * values that no establishment actually reported.
 */
export declare function percentile(sortedAsc: readonly number[], p: number): number;
/** Build a distribution from raw establishment rates. Input need not be sorted. */
export declare function buildDistribution(rates: readonly number[], meta: {
    naics: string;
    sizeBand: SizeBand | 'all';
    totalCases: number;
    totalHours: number;
}): BenchmarkDistribution;
/**
 * Locate a rate within a peer distribution.
 *
 * IMPORTANT: for injury rates, a LOW percentile rank is GOOD. A rank of 20
 * means only 20% of peers performed better (had a lower rate).
 *
 * Rank is interpolated piecewise-linearly between the stored breakpoints, with
 * the zero-inflation spike handled explicitly: any rate of exactly zero is
 * reported at the midpoint of the zero mass, because every establishment in
 * that mass is genuinely tied.
 */
export declare function rankAgainst(rate: number, dist: BenchmarkDistribution): BenchmarkResult;
