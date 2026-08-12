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

/** Legal suffixes stripped before matching so "Acme Inc" and "Acme LLC" unify. */
const LEGAL_SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'LLC', 'LLP', 'LP', 'LTD', 'LIMITED', 'CORP',
  'CORPORATION', 'CO', 'COMPANY', 'PLC', 'GMBH', 'SA', 'NV', 'AG', 'PTY',
  'HOLDINGS', 'GROUP', 'THE',
]);

/**
 * Normalize a raw name to uppercase alphanumeric tokens.
 *
 * Returns both the joined string and the token list, since matching needs
 * tokens and display/grouping needs a stable key.
 */
export function normalizeName(raw: string): { key: string; tokens: string[] } {
  const tokens = (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const meaningful = tokens.filter((t) => !LEGAL_SUFFIXES.has(t));
  // If a name is *only* legal suffixes, keep the originals rather than nothing.
  const finalTokens = meaningful.length > 0 ? meaningful : tokens;
  return { key: finalTokens.join(' '), tokens: finalTokens };
}

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
export function scoreMatch(query: string, candidate: string): SearchScore {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (q.tokens.length === 0 || c.tokens.length === 0) {
    return { score: 0, reason: 'none' };
  }
  if (q.key === c.key) return { score: 1000, reason: 'exact' };

  const candidateSet = new Set(c.tokens);
  let exactTokenHits = 0;
  let prefixHits = 0;

  for (const t of q.tokens) {
    if (candidateSet.has(t)) {
      exactTokenHits++;
    } else if (c.tokens.some((ct) => ct.startsWith(t) && t.length >= 3)) {
      prefixHits++;
    }
  }

  const matched = exactTokenHits + prefixHits;
  if (matched === 0) return { score: 0, reason: 'none' };

  // Reward covering the whole query; penalize candidates padded with extra words
  // so "ACME" ranks above "ACME REGIONAL DISTRIBUTION SERVICES" for query "ACME".
  const coverage = matched / q.tokens.length;
  const concision = q.tokens.length / c.tokens.length;

  if (coverage === 1) {
    const base = exactTokenHits === q.tokens.length ? 500 : 300;
    return {
      score: base + concision * 100,
      reason: exactTokenHits === q.tokens.length ? 'all-terms-word' : 'all-terms-prefix',
    };
  }
  return { score: coverage * 100 + concision * 10, reason: 'partial' };
}

/** Rank candidates against a query, best first, dropping non-matches. */
export function searchCompanies<T extends { name: string }>(
  query: string,
  candidates: readonly T[],
  limit = 25,
): Array<T & { score: number; reason: SearchScore['reason'] }> {
  const scored: Array<T & { score: number; reason: SearchScore['reason'] }> = [];
  for (const candidate of candidates) {
    const { score, reason } = scoreMatch(query, candidate.name);
    if (score > 0) scored.push({ ...candidate, score, reason });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}
