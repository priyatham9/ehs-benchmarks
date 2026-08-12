/**
 * Company-name matching for OSHA ITA establishment records.
 *
 * Self-reported establishment and company names are messy: inconsistent case,
 * punctuation, legal suffixes, and abbreviations. Naive substring matching is
 * badly wrong on this dataset in a way that is easy to miss — searching "DOW"
 * matches "Preferred WinDOW and Door", and "OLIN" matches "CarOLINa".
 * Both were observed in the real CY2025 file.
 *
 * This module normalizes names and scores matches on WORD boundaries, so those
 * false positives cannot occur.
 */
/**
 * Normalize a raw name to uppercase alphanumeric tokens.
 *
 * Returns both the joined string and the token list, since matching needs
 * tokens and display/grouping needs a stable key.
 */
export declare function normalizeName(raw: string): {
    key: string;
    tokens: string[];
};
export interface SearchScore {
    /** 0 = no match. Higher is better. */
    score: number;
    /** Why it matched, for UI display and debugging. */
    reason: 'exact' | 'all-terms-prefix' | 'all-terms-word' | 'partial' | 'none';
}
/**
 * Score a candidate company name against a user's query.
 *
 * Matching rules, strongest first:
 *   1. exact normalized equality
 *   2. every query token matches a candidate token exactly
 *   3. every query token is a PREFIX of some candidate token
 *   4. some but not all query tokens match
 *
 * A query token never matches the middle of a candidate token, which is what
 * eliminates the WinDOW / CarOLINa class of false positive.
 */
export declare function scoreMatch(query: string, candidate: string): SearchScore;
/** Rank candidates against a query, best first, dropping non-matches. */
export declare function searchCompanies<T extends {
    name: string;
}>(query: string, candidates: readonly T[], limit?: number): Array<T & {
    score: number;
    reason: SearchScore['reason'];
}>;
