#!/usr/bin/env node
// @ts-check
// Build the codebase report: render every diagram light and dark, link each one
// into Diagrammo, and fill the fixed HTML template.
//
//   node build-report.mjs [repo-dir] [--no-links]
//
// Reads <repo-dir>/docs/codebase-report/report.json and the .dgmo files beside
// it; writes report.html there and prints its path. The agent writes only the
// diagrams and the prose — never HTML. A diagram that does not render stops the
// build with the CLI's error, so the report never ships with a hole in it.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The report's own directory, relative to the repo. */
export const OUTPUT_DIR = 'docs/codebase-report';

/** What the agent writes beside the .dgmo files: the title, the summary and each diagram's prose. */
export const MANIFEST = 'report.json';

export const REPORT_FILE = 'report.html';

/** The CLI, run with npx so the user installs nothing. */
export const DGMO_CLI = ['npx', '-y', '@diagrammo/dgmo-cli'];

/** The footer's calls to action. */
export const LINKS = {
  app: 'https://diagrammo.app/download/mac-arm64',
  cloud: 'https://online.diagrammo.app/',
  home: 'https://diagrammo.app',
};

export const LINK_NOTICE =
  'Note: each "Edit in Diagrammo" link carries its diagram\'s full source in the URL. Run with --no-links to leave them out.';

const TEMPLATE = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'templates', 'report.html');

/** More diagrams than this and the report gets a table of contents. */
const TOC_MIN = 4;

/**
 * @typedef {{ file: string, title: string, text: string }} DiagramEntry
 * @typedef {{ title: string, summary: string, diagrams: DiagramEntry[] }} Manifest
 * @typedef {{ light: string, dark: string, url: string | null, source: string | null }} Built
 * @typedef {{ links?: boolean, dgmo?: string[], now?: Date }} BuildOptions
 */

export class ReportError extends Error {}

/**
 * Read and check report.json against the .dgmo files in the report directory.
 * Every .dgmo there must be listed, and every listed file must exist.
 * @param {string} dir the report directory
 * @returns {Manifest}
 */
export function readManifest(dir) {
  const path = join(dir, MANIFEST);
  if (!existsSync(path)) throw new ReportError(`${OUTPUT_DIR}/${MANIFEST} is missing — write it before building.`);
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ReportError(`${MANIFEST} is not valid JSON: ${/** @type {Error} */ (err).message}`);
  }
  if (!isRecord(raw)) throw new ReportError(`${MANIFEST} must be an object.`);
  const title = requireText(raw['title'], 'title');
  const summary = requireText(raw['summary'], 'summary');
  const list = raw['diagrams'];
  if (!Array.isArray(list) || list.length === 0) throw new ReportError(`${MANIFEST}: "diagrams" must be a non-empty array.`);

  /** @type {DiagramEntry[]} */
  const diagrams = list.map((entry, i) => {
    if (!isRecord(entry)) throw new ReportError(`${MANIFEST}: diagrams[${i}] must be an object.`);
    const file = requireText(entry['file'], `diagrams[${i}].file`);
    if (!/^[^/\\]+\.dgmo$/.test(file) || file.startsWith('.')) {
      throw new ReportError(`${MANIFEST}: diagrams[${i}].file "${file}" must be a .dgmo file name in ${OUTPUT_DIR}, with no directory.`);
    }
    if (!existsSync(join(dir, file))) throw new ReportError(`${MANIFEST}: diagrams[${i}].file "${file}" does not exist in ${OUTPUT_DIR}.`);
    return {
      file,
      title: requireText(entry['title'], `diagrams[${i}].title`),
      text: requireText(entry['text'], `diagrams[${i}].text`),
    };
  });

  const listed = new Set();
  for (const { file } of diagrams) {
    if (listed.has(file)) throw new ReportError(`${MANIFEST}: "${file}" is listed twice.`);
    listed.add(file);
  }
  const unlisted = readdirSync(dir).filter((f) => f.endsWith('.dgmo') && !listed.has(f));
  if (unlisted.length > 0) {
    throw new ReportError(`${unlisted.join(', ')} ${unlisted.length === 1 ? 'is' : 'are'} in ${OUTPUT_DIR} but not in ${MANIFEST} — list or delete ${unlisted.length === 1 ? 'it' : 'them'}.`);
  }
  return { title, summary, diagrams };
}

/**
 * Build report.html for the repo at `repoDir`. Returns the report's path.
 * Writes nothing unless every diagram rendered.
 * @param {string} repoDir
 * @param {BuildOptions} [options]
 * @returns {string}
 */
export function buildReport(repoDir, options = {}) {
  const { links = true, dgmo = DGMO_CLI, now = new Date() } = options;
  const dir = join(resolve(repoDir), OUTPUT_DIR);
  const manifest = readManifest(dir);

  const scratch = mkdtempSync(join(tmpdir(), 'dgmo-report-'));
  /** @type {Built[]} */
  let built;
  try {
    built = manifest.diagrams.map((d) => buildDiagram(dgmo, join(dir, d.file), scratch, links));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const html = fillTemplate(readFileSync(TEMPLATE, 'utf8'), {
    title: escapeHtml(manifest.title),
    stamp: stamp(resolve(repoDir), now),
    summary: escapeHtml(manifest.summary),
    toc: toc(manifest.diagrams),
    sections: manifest.diagrams.map((d, i) => section(d, /** @type {Built} */ (built[i]))).join('\n'),
    appLink: escapeHtml(LINKS.app),
    cloudLink: escapeHtml(LINKS.cloud),
    homeLink: escapeHtml(LINKS.home),
  });

  const out = join(dir, REPORT_FILE);
  const tmp = `${out}.tmp-${process.pid}`;
  writeFileSync(tmp, html);
  renameSync(tmp, out);
  return out;
}

/**
 * Render one diagram in both themes and get its edit link.
 * @param {string[]} dgmo
 * @param {string} file
 * @param {string} scratch
 * @param {boolean} links
 * @returns {Built}
 */
function buildDiagram(dgmo, file, scratch, links) {
  const name = basename(file, '.dgmo');
  /** @param {'light' | 'dark'} theme */
  const render = (theme) => {
    const out = join(scratch, `${name}.${theme}.svg`);
    // --json, because without it the CLI draws a diagram with errors as an
    // error card and still exits 0; with it, errors are success: false.
    const run = runDgmo(dgmo, [file, '-o', out, '--theme', theme, '--json']);
    const reply = parseJson(run.stdout);
    if (run.status !== 0 || !isRecord(reply) || reply['success'] !== true || !existsSync(out)) {
      const error = isRecord(reply) && typeof reply['error'] === 'string' ? reply['error'] : `${run.stderr}${run.stdout}`;
      throw new ReportError(`${basename(file)} did not render (${theme}):\n${error.trim()}`);
    }
    return readFileSync(out, 'utf8');
  };
  const light = render('light');
  const dark = render('dark');
  if (!links) return { light, dark, url: null, source: null };

  const share = runDgmo(dgmo, ['share', file, '--no-copy', '--json']);
  const reply = parseJson(share.stdout);
  if (share.status === 0 && isRecord(reply) && typeof reply['url'] === 'string') {
    return { light, dark, url: reply['url'], source: null };
  }
  const message = isRecord(reply) && typeof reply['error'] === 'string' ? reply['error'] : `${share.stderr}${share.stdout}`;
  // Past the URL limit there is no link, so the source goes in the report instead.
  if (/too large/i.test(message)) return { light, dark, url: null, source: readFileSync(file, 'utf8') };
  throw new ReportError(`dgmo share failed for ${basename(file)}:\n${message.trim()}`);
}

/**
 * @param {string[]} dgmo
 * @param {string[]} args
 */
function runDgmo(dgmo, args) {
  const [cmd, ...pre] = dgmo;
  if (!cmd) throw new ReportError('No dgmo command given.');
  const run = spawnSync(cmd, [...pre, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new ReportError(`Could not run ${dgmo.join(' ')}: ${run.error.message}`);
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/**
 * The header stamp: the build date, and the commit when the repo has one.
 * @param {string} repoDir
 * @param {Date} now
 */
function stamp(repoDir, now) {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
  const run = spawnSync('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  const sha = run.status === 0 ? run.stdout.trim() : '';
  return sha
    ? `Built <time datetime="${date}">${date}</time> at commit <code>${escapeHtml(sha)}</code>`
    : `Built <time datetime="${date}">${date}</time> — not a git repository, so no commit`;
}

/** @param {DiagramEntry[]} diagrams */
function toc(diagrams) {
  if (diagrams.length < TOC_MIN) return '';
  const items = diagrams.map((d) => `<li><a href="#${anchor(d.file)}">${escapeHtml(d.title)}</a></li>`).join('');
  return `<nav class="toc" aria-label="Contents"><h2>Contents</h2><ol>${items}</ol></nav>`;
}

/**
 * @param {DiagramEntry} d
 * @param {Built} b
 */
function section(d, b) {
  const title = escapeHtml(d.title);
  /** @param {string} svg @param {'light' | 'dark'} theme */
  const img = (svg, theme) =>
    `<img class="only-${theme}" alt="${title}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;
  let edit = '';
  if (b.url) {
    edit = `<p class="edit"><a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">Edit in Diagrammo ↗</a></p>`;
  } else if (b.source !== null) {
    edit = `<details class="source"><summary>Source — too large for a link; paste it into Diagrammo</summary><pre><code>${escapeHtml(b.source)}</code></pre></details>`;
  }
  return `<section id="${anchor(d.file)}">
<h2>${title}</h2>
<p class="text">${escapeHtml(d.text)}</p>
<figure class="diagram">${img(b.light, 'light')}${img(b.dark, 'dark')}</figure>
${edit}
</section>`;
}

/** @param {string} file */
function anchor(file) {
  return `d-${basename(file, '.dgmo').replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

/**
 * Replace each {{name}} in the template. A slot the template has but `values`
 * lacks is a bug in this script, so it throws rather than leaving it visible.
 * @param {string} template
 * @param {Record<string, string>} values
 */
export function fillTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined) throw new ReportError(`Template slot {{${key}}} has no value.`);
    return value;
  });
}

/** @param {string} s */
export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The CLI's --json reply, or null when stdout is not JSON (a crash); callers
 * then quote the raw output.
 * @param {string} stdout
 * @returns {unknown}
 */
function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @param {string} field
 */
function requireText(v, field) {
  if (typeof v !== 'string' || v.trim() === '') throw new ReportError(`${MANIFEST}: "${field}" must be a non-empty string.`);
  return v.trim();
}

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv the arguments after the script name
 * @param {BuildOptions} [options]
 */
export function main(argv, options = {}) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknown = flags.filter((f) => f !== '--no-links');
  const dirs = argv.filter((a) => !a.startsWith('--'));
  if (unknown.length > 0 || dirs.length > 1) {
    console.error('Usage: node build-report.mjs [repo-dir] [--no-links]');
    return 2;
  }
  const links = !flags.includes('--no-links');
  try {
    const out = buildReport(dirs[0] ?? '.', { ...options, links });
    if (links) console.error(LINK_NOTICE);
    console.log(out);
    return 0;
  } catch (err) {
    if (!(err instanceof ReportError)) throw err;
    console.error(`Error: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
