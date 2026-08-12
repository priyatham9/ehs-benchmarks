# ehs-benchmarks

**Open OSHA injury-rate benchmarks, built from 1.18 million public establishment filings.**

📊 **[priyatham9.github.io/ehs-benchmarks](https://priyatham9.github.io/ehs-benchmarks)** — percentile lookup, company search, and injury-pattern analysis.

Two things live here:

1. **`ehs-metrics`** — a tested TypeScript library for OSHA incident-rate calculation (TRIR, DART, LTIR, severity rate) with the data-quality guards these calculations actually need.
2. **A published benchmark dataset** — TRIR and DART percentiles for 3,842 NAICS × size-band peer groups, derived from OSHA's Injury Tracking Application, plus a static site that makes them usable.

MIT licensed. No API keys, no server, no database.

---

## Why this exists

Every EHS leader eventually asks *"is our TRIR any good?"* The honest answer requires comparing against establishments of similar size in the same industry. That data is public — OSHA publishes establishment-level 300A filings every year — and it is close to unusable straight out of the download.

Here is what we found processing CY2023–CY2025.

### Finding 1 — 1.53% of records hold 87% of the hours

Employers self-report hours worked, and a small number of filings are wrong by many orders of magnitude. One establishment reported **1.2 × 10¹¹ hours for 60 employees** — more labour than the entire US economy performs in a year.

Only **2.24%** of filings fail a basic plausibility test. Those filings carry **86.9% of every hour reported to OSHA**.

| | Aggregate TRIR |
|---|---|
| Sum the hours column as published | **0.45** |
| Exclude implausible records | **3.41** |

**A 7.58× error**, and it silently makes every organisation look excellent. Any benchmark built on the raw file is wrong by roughly that factor.

The test this library applies: hours worked ÷ average employees must fall between 100 and 4,000 per year. Below that, hours were filed in the wrong unit; above it, a keying error. Bounds were derived from the observed distribution, not chosen by taste — the real p1–p99 range is 163 to 3,716.

### Finding 2 — zero is not excellence

Injury-rate distributions are not bell curves; they spike at zero. In chemical manufacturing (NAICS 325), **38% of establishments report no recordable case at all** while the 90th percentile sits at 5.54. Reporting a mean against a distribution shaped like that is meaningless, and "we had zero" says as much about establishment size as about safety performance.

This is why `rankAgainst()` reports a zero rate at the *midpoint of the zero mass* rather than as best-in-class, and why percentiles use nearest-rank instead of interpolation — interpolating across a 38% spike invents rates nobody reported.

### Finding 3 — injuries cluster early in the shift

688,367 cases carry OIICS coding; 546,590 record both shift start and incident time. Injuries peak in **hour 2** of the shift, and **47.8% occur in the first four hours** — not at the fatigued end of the day, where fatigue-management programmes usually aim.

---

## The library

```bash
npm install ehs-metrics
```

```ts
import { trir, dart, rankAgainst, checkPlausibility } from 'ehs-metrics';

const cases = {
  deaths: 0,
  daysAwayCases: 3,
  jobTransferCases: 2,
  otherRecordableCases: 7,
};

trir(cases, { employeeHours: 480_000 }).value;  // 5.0
dart(cases, { employeeHours: 480_000 }).value;  // 2.083…
```

### Contractor hours are the classic trap

Two organisations quoting "TRIR 4.0" may not be quoting the same metric. OSHA requires supervised contractors on the host's log (29 CFR 1904.31), and whether their hours land in the denominator moves the number substantially:

```ts
const hours = { employeeHours: 500_000, contractorHours: 500_000 };

trir(c, hours).value;                                    // 4.0  (employee-only, default)
trir(c, hours, { contractorBasis: 'combined' }).value;   // 2.0  (exactly half)
```

### Partial periods are not annualised

A common double-count. The 200,000-hour basis *already* normalises for time, because the denominator shrinks with the period. Multiplying a six-month rate by two is wrong:

```ts
trir(c, hours, { monthsCovered: 6 }).value;   // identical to the 12-month value
// …and returns a PARTIAL_PERIOD flag noting the rate is volatile, not that it needs scaling
```

### Undefined is not zero

A site that reported no hours has *no* rate. Returning `0` would render it as a perfect safety record:

```ts
trir(c, { employeeHours: 0 }).value;   // null, plus a ZERO_HOURS error flag
nearMissRatio(50, 0);                  // null — not Infinity
```

### Data-quality screening

```ts
checkPlausibility({ hours: 1.2e11, employees: 60 });
// [{ code: 'IMPLAUSIBLE_HOURS_PER_EMPLOYEE', severity: 'error', message: '…' }]

checkPlausibility({ hours: 5_000, employees: 3 });
// [{ code: 'LOW_HOUR_BASE', severity: 'warn',
//    message: 'Only 5,000 hours worked. A single recordable case would produce a rate of 40.0…' }]
```

`isPublishable(flags)` is false when any flag is an `error` — that single call is what the pipeline uses to decide inclusion, so the website's calculator and the published benchmark tables cannot disagree about what counts as a usable record.

### API

| Function | Returns |
|---|---|
| `trir(cases, hours, opts?)` | Total recordable incident rate |
| `dart(cases, hours, opts?)` | Days away, restricted, or transferred |
| `ltir(cases, hours, opts?)` | Days-away cases only |
| `fatalityRate(cases, hours, opts?)` | Deaths per 100 FTE |
| `severityRate(cases, hours, opts?)` | Lost **days**, not cases |
| `nearMissRatio(nearMisses, recordables)` | Leading indicator, `null` if no recordables |
| `checkPlausibility(input)` / `isPublishable(flags)` | Data-quality screening |
| `buildDistribution(rates, meta)` / `rankAgainst(rate, dist)` | Percentile construction and lookup |
| `sizeBandFor(employees)` / `percentile(sorted, p)` | Peer-group helpers |
| `normalizeName(raw)` / `scoreMatch(q, candidate)` / `searchCompanies(q, list)` | Company-name matching |

---

## Reproducing the dataset

```bash
npm install
npm test          # 104 tests
npm run build
node scripts/build-benchmarks.mjs <rawDataDir>
```

`<rawDataDir>` should contain the OSHA files listed in `SUMMARY_FILES` / `CASE_FILE` at the top of the script, downloaded from [OSHA's establishment-specific data page](https://www.osha.gov/Establishment-Specific-Injury-and-Illness-Data). They are not committed here — they are ~700 MB and freely redistributable from the source.

The pipeline emits everything under `site/data/`.

### Two problems worth knowing about if you use this data

**Company name is not a company identifier.** The field frequently embeds the site: `Dollar Tree Stores, Inc. DC3 JOLIET, IL` and `Dollar Tree Stores, Inc. DC11 COWPENS, SC` are one company under two keys — 14,619 of them in CY2025 alone. Grouping by EIN fixes that, but EIN cannot be trusted blindly: one value in the CY2025 file carries **9,320 establishments with 9,320 unrelated names**, a placeholder that would fuse unrelated employers into a fictitious conglomerate.

So an EIN is accepted only when the names filed under it *agree*, measured as the share sharing a modal leading token pair. Lowe's passes despite 1,788 distinct name strings (all begin `Lowe's Companies, INC`); the placeholder fails and its records fall back to name grouping. Display names are the longest token prefix common to the group, which strips the embedded store identifier.

**Naive substring search is wrong on this data.** Searching `DOW` matches "Preferred Win**dow** and Door"; `OLIN` matches "Car**olin**a Heating". Both are real CY2025 records. `scoreMatch()` scores on word boundaries, so neither can happen.

---

## How a static site serves 1.18M records

All aggregation happens at build time. The browser never sees a raw record.

| Payload | Size | When |
|---|---|---|
| Initial page load | 340 KB raw / ~70 KB gzipped | on open |
| Benchmark tables | 884 KB across 28 sector files | one sector on demand |
| Company index | 48.9 MB across 1,880 shards | **one ~50 KB shard per search** |

Company shards split recursively by name prefix until each is under 400 KB, so a common prefix cannot produce a slow search. No database, no serverless functions — it is a folder of JSON on GitHub Pages.

---

## Limitations

Read these before quoting any number from this project.

- **ITA is not a random sample.** It covers establishments required to submit: generally 100+ employees, or 20–99 in designated higher-hazard industries. Its aggregate rate runs above the BLS national figure for exactly that reason. Compare within a peer group, never against the site-wide total.
- **Everything is self-reported and unaudited.** Under-recording is a known, unmeasured problem. A low rate may reflect reporting culture rather than injury frequency.
- **The plausibility test catches unit errors, not scope errors.** An employer filing an entire system's hours under one establishment passes the test and is counted as one very large site.
- **Year-over-year is not a fixed panel.** Which establishments file changes annually; in some sectors reported hours per establishment swing by ~2×. Sector trends conflate real change with changes in who reported, and the site flags the sectors where this is largest.
- **OIICS codes are model-predicted by OSHA** (the `_pred` columns), not human-assigned. Reliable in aggregate; not for any individual case.
- **Single-establishment rates are noisy.** At 200,000 hours, one extra case moves TRIR by a full point.

---

## Data source and licence

Data: U.S. OSHA Injury Tracking Application, establishment-specific 300A summary and case detail files, CY2023–CY2025, retrieved from osha.gov. US Government public domain.

Code: MIT — see [LICENSE](LICENSE).

Not affiliated with or endorsed by OSHA.
