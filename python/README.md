# ehs-metrics (Python port)

Python port of the rate and data-quality functions in `../src/rates.ts` and `../src/quality.ts`.
Not published to PyPI; install from a checkout with `pip install -e python`.

Names are snake_case: `trir`, `dart`, `ltir`, `fatality_rate`, `severity_rate`, `near_miss_ratio`,
`total_recordable_cases`, `dart_cases`, `check_plausibility`, `is_publishable`.
The shared test vectors live in `../test/fixtures/rate-vectors.json` and are run by both
`npm test` (vitest) and `pytest` (from `python/`).
