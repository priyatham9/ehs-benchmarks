import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Split one CSV line, honouring quoted fields that contain commas or escaped
 * quotes. The OSHA files contain both, plus tab-padded name fields.
 */
export function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { quoted = false; }
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** OSHA pads several text columns with tabs and long whitespace runs. */
export const clean = (s) => (s ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Stream a CSV, yielding a field-accessor for each row.
 *
 * Rows whose field count does not match the header are skipped and counted;
 * silently coercing them would corrupt every downstream aggregate.
 */
export async function* readCsv(path) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let header = null;
  let index = null;
  let malformed = 0;
  let row = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = splitCsv(line).map((h) => clean(h));
      index = new Map(header.map((h, i) => [h, i]));
      continue;
    }
    const fields = splitCsv(line);
    if (fields.length !== header.length) { malformed++; continue; }
    row++;
    yield {
      row,
      get: (name) => fields[index.get(name)],
      str: (name) => clean(fields[index.get(name)]),
      num: (name) => {
        const v = Number(clean(fields[index.get(name)]));
        return Number.isFinite(v) ? v : null;
      },
    };
  }
  readCsv.lastMalformed = malformed;
}
