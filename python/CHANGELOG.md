# Changelog

## 0.3.0
- Added `power_two_rates` and `min_hours_to_distinguish` to `intervals` (ports of `powerTwoRates` and `minHoursToDistinguish`).
- Added shared vectors `test/fixtures/power-vectors.json`, run by both vitest and pytest.

## 0.2.0
- Added `intervals`: exact (Garwood) Poisson interval, `rate_interval`, `trir_interval`, `dart_interval`, `cases_for_precision`, `log_gamma`.
- Added `shrinkage`: Gamma-Poisson empirical-Bayes `fit_gamma_poisson_prior`, `gamma_quantile`, `shrink_rate`, `shrink_trir`, `shrink_dart`.
- Added shared vectors `test/fixtures/interval-vectors.json`, run by both vitest and pytest.

## 0.1.0
- Initial port of rates and data-quality checks.
