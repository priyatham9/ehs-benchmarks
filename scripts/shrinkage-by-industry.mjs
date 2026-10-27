/**
 * Fit the Gamma-Poisson prior per 2-digit NAICS sector from the committed
 * single-establishment records in docs/data/companies/, and write the fit to
 * outputs/shrinkage_by_naics2.csv. Uses only committed data.
 *
 * Usage:  npm run build && node scripts/shrinkage-by-industry.mjs [year=2024]
 *
 * Records with "s" = 1 are single establishments. TRIR cases are "c";
 * DART cases are recovered from the stored 2-decimal DART rate as
 * round(d x h / 200,000), exact while h < 20 million.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fitGammaPoissonPrior, OSHA_HOURS_BASIS } from '../dist/index.js';

const YEAR = process.argv[2] ?? '2024';
const MIN_SITES = 300;
const dir = resolve('docs/data/companies');
const groups = new Map();
for (const f of readdirSync(dir).sort()) {
  for (const rec of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (rec.s !== 1) continue;
    const y = rec.y?.[YEAR];
    if (!y || !(y.h > 0) || !rec.na) continue;
    const sector = String(rec.na).slice(0, 2);
    if (!groups.has(sector)) groups.set(sector, []);
    groups.get(sector).push({ hours: y.h, trir: y.c, dart: Math.round((y.d * y.h) / OSHA_HOURS_BASIS) });
  }
}

const rows = [['naics2', 'year', 'metric', 'sites', 'pooled_rate', 'dispersion', 'prior_shape', 'prior_weight_hours']];
for (const [sector, sites] of [...groups].sort()) {
  if (sites.length < MIN_SITES) continue;
  for (const metric of ['trir', 'dart']) {
    const p = fitGammaPoissonPrior(sites.map((s) => ({ cases: s[metric], hours: s.hours })));
    rows.push([
      sector, YEAR, metric, p.sites, p.mean.toFixed(2), p.dispersion.toFixed(3),
      Number.isFinite(p.shape) ? p.shape.toFixed(2) : 'inf',
      Number.isFinite(p.rate) ? Math.round(p.rate * OSHA_HOURS_BASIS) : 'inf',
    ]);
  }
}
mkdirSync('outputs', { recursive: true });
writeFileSync('outputs/shrinkage_by_naics2.csv', rows.map((r) => r.join(',')).join('\n') + '\n');
console.log(rows.map((r) => r.join('\t')).join('\n'));
