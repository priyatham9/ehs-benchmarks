import type {
  BenchmarkDistribution,
  BenchmarkResult,
  PercentileKey,
  SizeBand,
} from './types.js';

const PERCENTILE_KEYS: readonly PercentileKey[] = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'];
const PERCENTILE_VALUES: Record<PercentileKey, number> = {
  p10: 10, p25: 25, p50: 50, p75: 75, p90: 90, p95: 95, p99: 99,
};

/** Assign an establishment to an ITA size band by annual average employees. */
export function sizeBandFor(employees: number): SizeBand | null {
  if (!Number.isFinite(employees) || employees < 20) return null;
  if (employees < 50) return '20-49';
  if (employees < 100) return '50-99';
  if (employees < 250) return '100-249';
  if (employees < 500) return '250-499';
  if (employees < 1000) return '500-999';
  return '1000+';
}

/**
 * Nearest-rank percentile on an ascending sorted array.
 *
 * Uses nearest-rank rather than linear interpolation because injury-rate
 * distributions are heavily zero-inflated (42.1% of NAICS 325 establishments
 * report zero recordables in CY2025). Interpolating across that spike invents
 * values that no establishment actually reported.
 */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) throw new RangeError('Cannot take a percentile of an empty array.');
  if (p < 0 || p > 100) throw new RangeError(`Percentile must be 0-100 (received ${p}).`);
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index] as number;
}

/** Build a distribution from raw establishment rates. Input need not be sorted. */
export function buildDistribution(
  rates: readonly number[],
  meta: { naics: string; sizeBand: SizeBand | 'all'; totalCases: number; totalHours: number },
): BenchmarkDistribution {
  if (rates.length === 0) {
    throw new RangeError(`No rates supplied for NAICS ${meta.naics} / ${meta.sizeBand}.`);
  }
  const sorted = [...rates].sort((a, b) => a - b);
  const percentiles = {} as Record<PercentileKey, number>;
  for (const key of PERCENTILE_KEYS) {
    percentiles[key] = percentile(sorted, PERCENTILE_VALUES[key]);
  }
  return {
    naics: meta.naics,
    sizeBand: meta.sizeBand,
    n: sorted.length,
    percentiles,
    zeroRate: sorted.filter((r) => r === 0).length / sorted.length,
    aggregate: meta.totalHours > 0 ? (meta.totalCases * 200_000) / meta.totalHours : 0,
  };
}

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
export function rankAgainst(rate: number, dist: BenchmarkDistribution): BenchmarkResult {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new RangeError(`Rate must be a non-negative finite number (received ${rate}).`);
  }

  let percentileRank: number;

  if (rate === 0 && dist.zeroRate > 0) {
    percentileRank = (dist.zeroRate * 100) / 2;
  } else {
    // Breakpoints whose VALUE is zero sit inside the zero mass. Keeping them
    // would make the point list non-monotonic in percentile (e.g. NAICS 325 has
    // zeroRate 42.1% but p10 = p25 = 0), which silently corrupts interpolation.
    // The zero mass is represented by a single anchor at its upper edge.
    const points: Array<[value: number, pct: number]> = [
      [0, dist.zeroRate * 100],
      ...PERCENTILE_KEYS.map((k) => [dist.percentiles[k], PERCENTILE_VALUES[k]] as [number, number]).filter(
        ([value, pct]) => value > 0 && pct > dist.zeroRate * 100,
      ),
    ];

    if (rate >= (dist.percentiles.p99 ?? 0)) {
      percentileRank = 99;
    } else {
      percentileRank = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const [v0, p0] = points[i] as [number, number];
        const [v1, p1] = points[i + 1] as [number, number];
        if (rate >= v0 && rate <= v1) {
          // Guard the tie case where consecutive breakpoints share a value.
          percentileRank = v1 === v0 ? p1 : p0 + ((rate - v0) / (v1 - v0)) * (p1 - p0);
          break;
        }
        if (rate > v1) percentileRank = p1;
      }
    }
  }

  percentileRank = Math.max(0, Math.min(100, percentileRank));

  return {
    rate,
    percentileRank,
    distribution: dist,
    interpretation: interpret(rate, percentileRank, dist),
  };
}

function interpret(rate: number, rank: number, dist: BenchmarkDistribution): string {
  const better = Math.round(100 - rank);
  const peer = `${dist.n.toLocaleString()} establishments in NAICS ${dist.naics}` +
    (dist.sizeBand === 'all' ? '' : ` at ${dist.sizeBand} employees`);

  if (rate === 0) {
    return `A rate of 0.00 ties with the ${(dist.zeroRate * 100).toFixed(1)}% of ${peer} that also ` +
      `reported no recordable cases. Zero is common at this scale and is not by itself evidence ` +
      `of a strong safety program.`;
  }
  if (rank <= 25) {
    return `${rate.toFixed(2)} places in the best quartile — better than roughly ${better}% of ${peer}.`;
  }
  if (rank <= 50) {
    return `${rate.toFixed(2)} is better than about ${better}% of ${peer}, just inside the top half.`;
  }
  if (rank <= 75) {
    return `${rate.toFixed(2)} is worse than the median for ${peer}; about ${better}% perform better.`;
  }
  return `${rate.toFixed(2)} falls in the worst quartile for ${peer} — only about ${better}% perform better.`;
}
