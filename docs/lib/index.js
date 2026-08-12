/**
 * ehs-metrics — tested OSHA incident-rate calculations and open industry
 * benchmarks derived from OSHA's public Injury Tracking Application data.
 *
 * @see https://github.com/priyatham9/ehs-benchmarks
 */
export { OSHA_HOURS_BASIS, } from './types.js';
export { dart, dartCases, fatalityRate, ltir, nearMissRatio, severityRate, totalRecordableCases, trir, } from './rates.js';
export { MAX_HOURS_PER_EMPLOYEE, MIN_HOURS_PER_EMPLOYEE, MIN_MEANINGFUL_HOURS, checkPlausibility, isPublishable, } from './quality.js';
export { buildDistribution, percentile, rankAgainst, sizeBandFor, } from './benchmark.js';
export { normalizeName, scoreMatch, searchCompanies, } from './search.js';
//# sourceMappingURL=index.js.map