/**
 * Core types for OSHA recordkeeping metrics.
 *
 * Terminology follows 29 CFR 1904. Where this library uses a shorter name than
 * the regulation (e.g. `daysAwayCases` for "cases with days away from work"),
 * the regulatory term is given in the doc comment.
 */
/**
 * The OSHA incident-rate basis: 100 full-time equivalent employees working
 * 40 hours/week for 50 weeks = 200,000 hours.
 *
 * Every rate in this library is "per 100 FTE per year" because of this constant.
 * It is exported so callers can see it rather than find it hard-coded.
 */
export const OSHA_HOURS_BASIS = 200_000;
//# sourceMappingURL=types.js.map