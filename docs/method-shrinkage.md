# Method note: shrinking small-establishment rates toward industry rates

Independent open-source work. Not affiliated with OSHA or any employer. All numbers below are produced by code and data in this repository (`scripts/shrinkage-by-industry.mjs`, `outputs/shrinkage_by_naics2.csv`, `test/shrinkage.test.ts`).

## The problem

TRIR and DART are cases x 200,000 / hours. When hours are small, a single case moves the rate a lot, and zero cases gives exactly 0. Both are artifacts of small exposure, not evidence about the establishment.

Using the construction (NAICS 23) single-establishment fit for 2024 (24,194 establishments, pooled TRIR 1.70):

| Cases | Hours | Raw TRIR | Exact 95% interval (Garwood) | Shrunken TRIR | 95% credible interval |
|---|---|---|---|---|---|
| 0 | 20,000 | 0.00 | 0.00 to 36.89 | 1.46 | 0.04 to 5.32 |
| 1 | 20,000 | 10.00 | 0.25 to 55.72 | 2.88 | 0.36 to 7.98 |
| 2 | 100,000 | 4.00 | 0.48 to 14.45 | 2.74 | 0.57 to 6.58 |
| 5 | 1,000,000 | 1.00 | 0.32 to 2.33 | 1.08 | 0.40 to 2.09 |

Ranking establishments by raw rate puts small sites at both extremes of any list (the zeros and the spikes) purely because they are small. Shrinkage orders them by the best estimate of their true rate.

## The model

Each establishment has a true rate lambda drawn from a peer-group Gamma(shape a, rate b) distribution (mean mu = a/b, per 200,000 hours). Observed cases y over exposure e = hours / 200,000 are Poisson(lambda e). The posterior is Gamma(a + y, b + e), with mean

    (a + y) / (b + e) = w mu + (1 - w) (y / e),   w = b / (b + e)

so the estimate is a weighted average of the peer-group rate and the establishment's own rate, and b x 200,000 is the prior's weight in hours. In the construction fit, b x 200,000 is about 120,643 hours: an establishment with that many hours gives its own rate and the industry rate equal weight.

The prior is estimated from the peer group (empirical Bayes) by the method of moments: mu is pooled cases / pooled exposure, and the extra-Poisson variance of true rates phi satisfies Var(y) = mu e + phi mu^2 e^2, giving phi = sum[(y - mu e)^2 - mu e] / (mu^2 sum e^2) and a = 1 / phi. If phi is not positive, the data show no more variation than Poisson and the fit reports complete pooling (shape infinite).

## What it is and is not

- It estimates the true rate. The Garwood interval already in this library answers a different question: which rates the raw count alone cannot rule out. They sit side by side; neither replaces the other.
- The credible interval is narrower than the Garwood interval because it uses the peer group. It is only as good as the Gamma-Poisson assumption and the peer-group definition (here, 2-digit NAICS).
- The fitted dispersion absorbs everything that makes establishments differ, including reporting error, so it is an upper-side estimate of true rate heterogeneity.
- The committed fit uses single-establishment records only (`s` = 1) from `docs/data/companies/`, year 2024, so its pooled rate is not the published all-record aggregate in `docs/data/benchmarks/`. DART case counts are recovered from the stored 2-decimal DART rate as round(d x hours / 200,000).
- The method-of-moments estimate treats mu as known, so it is slightly biased in small groups; the script only fits sectors with at least 300 establishments.
- Shrinkage lowers average error across establishments; for any single establishment it can move the estimate away from the truth. It should not be used to excuse a real signal: with enough hours (last row above) the shrunken and raw rates agree.

## Verification

`test/shrinkage.test.ts` checks: Gamma quantiles against the independent Garwood reference limits already in `test/intervals.test.ts`, the closed-form shape-1 quantile and the chi-square median; hand-calculated prior fits and posterior means; the weighted-average identity; limits at zero and large exposure; and a seeded simulation (20,000 establishments, true shape 3, mean 3) in which the fit recovers the prior, shrunken rates have lower squared error than raw rates (below half the raw error for sites under 60,000 hours), and 95% credible intervals cover the true rate between 93% and 97% of the time.
