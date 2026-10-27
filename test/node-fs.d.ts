// Minimal ambient declaration so tests can read committed data files without adding @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
