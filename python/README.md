# ehs-metrics (Python port)

Python port of the JavaScript/TypeScript library in `../src`. Not published to PyPI (publishing is deferred);
install from a checkout with `pip install -e python`.

Names are snake_case.

| Module | Port of | Functions |
| --- | --- | --- |
| `rates` | `src/rates.ts` | `trir`, `dart`, `ltir`, `fatality_rate`, `severity_rate`, `near_miss_ratio`, `total_recordable_cases`, `dart_cases` |
| `quality` | `src/quality.ts` | `check_plausibility`, `is_publishable` |
| `intervals` | `src/intervals.ts` | `poisson_exact_interval`, `rate_interval`, `trir_interval`, `dart_interval`, `cases_for_precision`, `log_gamma`, `power_two_rates`, `min_hours_to_distinguish` |
| `shrinkage` | `src/shrinkage.ts` | `fit_gamma_poisson_prior`, `gamma_quantile`, `shrink_rate`, `shrink_trir`, `shrink_dart` |

`min_hours_to_distinguish` takes `power` and `alpha` as keyword arguments (the TypeScript options object `{ power, alpha }`).

Interval and shrinkage functions take `confidence` and `contractor_basis` as keyword arguments
(the TypeScript options object `{ confidence, contractorBasis }`). Invalid input raises `ValueError`
where TypeScript throws `RangeError`.

Not ported: `whereDoIRank`, and the benchmark/search modules.
The JS library has no Wilson interval, so none is provided here.

## Shared test vectors

JS and Python are checked against the same JSON files in `../test/fixtures/`:

- `rate-vectors.json`: rates, aggregation, near-miss (`test/rates-vectors.test.ts`, `python/tests/test_vectors.py`)
- `interval-vectors.json`: exact intervals, gamma quantiles, prior fit, shrinkage
  (`test/interval-vectors.test.ts`, `python/tests/test_interval_vectors.py`)
- `power-vectors.json`: exact two-rate power and minimum hours to distinguish
  (`test/power-vectors.test.ts`, `python/tests/test_power_vectors.py`)

Run `npm test` from the repository root and `pytest` from `python/`; both run in CI.
