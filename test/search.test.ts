import { describe, expect, it } from 'vitest';
import { normalizeName, scoreMatch, searchCompanies } from '../src/index.js';

describe('normalizeName', () => {
  it('uppercases and strips punctuation', () => {
    expect(normalizeName('Acme Chem., Inc.').key).toBe('ACME CHEM');
  });

  it('strips legal suffixes so variants unify', () => {
    expect(normalizeName('Acme LLC').key).toBe(normalizeName('Acme Incorporated').key);
  });

  it('keeps the original tokens when a name is only legal suffixes', () => {
    expect(normalizeName('The Company').tokens.length).toBeGreaterThan(0);
  });

  it('returns empty tokens for empty input', () => {
    expect(normalizeName('').tokens).toEqual([]);
  });

  it('collapses runs of separators', () => {
    expect(normalizeName('A   --  B').key).toBe('A B');
  });
});

describe('scoreMatch — false positives observed in the real CY2025 file', () => {
  it('does NOT match "DOW" inside "Preferred Window and Door"', () => {
    expect(scoreMatch('DOW', 'Preferred Window and Door').score).toBe(0);
  });

  it('does NOT match "OLIN" inside "Carolina Heating & Cooling"', () => {
    expect(scoreMatch('OLIN', 'Carolina Heating & Cooling').score).toBe(0);
  });

  it('still matches "DOW" against a real Dow establishment', () => {
    expect(scoreMatch('DOW', 'Dow Services Inc').score).toBeGreaterThan(0);
  });

  it('does not match a query that is a mid-word fragment', () => {
    expect(scoreMatch('EXI', 'Hexion Specialty Chemicals').score).toBe(0);
  });

  it('matches a genuine word-prefix', () => {
    expect(scoreMatch('HEXI', 'Hexion Specialty Chemicals').score).toBeGreaterThan(0);
  });
});

describe('scoreMatch — ranking', () => {
  it('scores an exact normalized match highest', () => {
    const exact = scoreMatch('Acme Chemical', 'ACME CHEMICAL').score;
    const partial = scoreMatch('Acme Chemical', 'Acme Chemical Regional Services').score;
    expect(exact).toBeGreaterThan(partial);
  });

  it('treats legal-suffix variants as exact matches', () => {
    expect(scoreMatch('Acme Chemical Inc', 'Acme Chemical LLC').reason).toBe('exact');
  });

  it('prefers a concise candidate over a padded one', () => {
    const concise = scoreMatch('ACME', 'Acme Corp').score;
    const padded = scoreMatch('ACME', 'Acme Regional Distribution Services Group').score;
    expect(concise).toBeGreaterThan(padded);
  });

  it('ranks full-query coverage above partial coverage', () => {
    const full = scoreMatch('ACME CHEMICAL', 'Acme Chemical').score;
    const partial = scoreMatch('ACME CHEMICAL', 'Acme Bakery').score;
    expect(full).toBeGreaterThan(partial);
  });

  it('returns none for an empty query', () => {
    expect(scoreMatch('', 'Acme').reason).toBe('none');
  });

  it('requires at least 3 characters for a prefix match', () => {
    expect(scoreMatch('AC', 'Acme Corp').score).toBe(0);
  });
});

describe('searchCompanies', () => {
  const companies = [
    { name: 'Acme Chemical Inc' },
    { name: 'Acme Bakery LLC' },
    { name: 'Preferred Window and Door' },
    { name: 'Carolina Heating' },
    { name: 'Dow Services Inc' },
  ];

  it('returns only genuine matches', () => {
    const results = searchCompanies('DOW', companies);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('Dow Services Inc');
  });

  it('ranks the best match first', () => {
    expect(searchCompanies('Acme Chemical', companies)[0]?.name).toBe('Acme Chemical Inc');
  });

  it('respects the limit', () => {
    expect(searchCompanies('Acme', companies, 1)).toHaveLength(1);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchCompanies('Zzzzz', companies)).toEqual([]);
  });

  it('exposes the match reason for UI display', () => {
    expect(searchCompanies('Acme Chemical', companies)[0]?.reason).toBe('exact');
  });
});
