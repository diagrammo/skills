#!/usr/bin/env node
// @ts-check
// A stand-in for the dgmo CLI in the build-report tests: same arguments, same
// exit codes and output shapes, no npx and no network.
//
//   node fake-dgmo.mjs <call-log> <file> -o <out.svg> --theme <light|dark> [--json]
//   node fake-dgmo.mjs <call-log> share <file> --no-copy --json
//
// Each call is appended to <call-log>. A source containing RENDER-ERROR has
// errors; one containing TOO-LARGE is refused by share, as the real CLI
// refuses a diagram past its URL limit.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [log, ...args] = process.argv.slice(2);
if (!log) process.exit(2);
appendFileSync(log, `${args.join(' ')}\n`);

if (args[0] === 'share') {
  const file = args[1] ?? '';
  const source = readFileSync(file, 'utf8');
  if (source.includes('TOO-LARGE')) {
    const error = 'Error: Diagram too large for URL sharing (9000 bytes, limit 8192 bytes)';
    process.stdout.write(`${JSON.stringify({ success: false, error }, null, 2)}\n`);
    process.exit(1);
  }
  if (source.includes('SHARE-CRASH')) {
    process.stderr.write('Error: something else went wrong\n');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ success: true, url: `https://diagrammo.app/#fake-${basename(file)}` }, null, 2)}\n`);
  process.exit(0);
}

// Like the real CLI, a diagram with errors still gets an SVG (an error card)
// and exit 0 — unless --json is given, which reports success: false, exit 1.
const [file = '', , out = '', , theme = ''] = args;
const json = args.includes('--json');
const source = readFileSync(file, 'utf8');
if (source.includes('RENDER-ERROR')) {
  const error = 'Line 2: Unknown chart type "nonsense"';
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" data-error-card="true"><text>${error}</text></svg>`);
  if (json) {
    process.stdout.write(`${JSON.stringify({ success: false, error, line: 2 }, null, 2)}\n`);
    process.exit(1);
  }
  process.stderr.write(`✖ ${error}\nWrote ${out}\n`);
  process.exit(0);
}
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" data-theme="${theme}" data-file="${basename(file)}"><text>${theme}</text></svg>`);
if (json) process.stdout.write(`${JSON.stringify({ success: true, output: out, chartType: 'pie' }, null, 2)}\n`);
