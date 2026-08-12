/**
 * ehs-metrics — tested OSHA incident-rate calculations and open industry
 * benchmarks derived from OSHA's public Injury Tracking Application data.
 *
 * @see https://github.com/priyatham9/ehs-benchmarks
 */
export { OSHA_HOURS_BASIS, type BenchmarkDistribution, type BenchmarkResult, type CaseCounts, type ContractorBasis, type DataQualityCode, type DataQualityFlag, type HoursWorked, type PercentileKey, type RateResult, type SizeBand, } from './types.js';
export { dart, dartCases, fatalityRate, ltir, nearMissRatio, severityRate, totalRecordableCases, trir, type RateOptions, } from './rates.js';
export { MAX_HOURS_PER_EMPLOYEE, MIN_HOURS_PER_EMPLOYEE, MIN_MEANINGFUL_HOURS, checkPlausibility, isPublishable, type PlausibilityInput, } from './quality.js';
export { buildDistribution, percentile, rankAgainst, sizeBandFor, } from './benchmark.js';
export { normalizeName, scoreMatch, searchCompanies, type SearchScore, } from './search.js';
