import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LINK_NOTICE,
  LINKS,
  OUTPUT_DIR,
  buildReport,
  fillTemplate,
  main,
} from '../skills/dgmo-codebase-report/scripts/build-report.mjs';
import { git, materializeFixture } from './helpers/fixture-repo.js';

const FAKE_DGMO = join(import.meta.dirname, 'helpers', 'fake-dgmo.mjs');
const NOW = new Date(2026, 9, 9, 12, 0, 0);

let calls: string;
let dgmo: string[];

beforeEach(() => {
  calls = join(mkdtempSync(join(tmpdir(), 'skills-fake-dgmo-')), 'calls.log');
  writeFileSync(calls, '');
  dgmo = [process.execPath, FAKE_DGMO, calls];
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Entry {
  file: string;
  title: string;
  text: string;
}

/** A fixture repo with a report directory holding these diagrams and a manifest listing them. */
function reportRepo(
  diagrams: Record<string, string>,
  manifest?: { title?: string; summary?: string; diagrams?: Entry[] },
  fixture: 'typescript' | 'no-git' = 'typescript',
): { repo: string; dir: string } {
  const repo = materializeFixture(fixture);
  const dir = join(repo, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  for (const [file, source] of Object.entries(diagrams)) writeFileSync(join(dir, file), source);
  const entries = Object.keys(diagrams).map((file) => ({ file, title: `Title of ${file}`, text: `Text about ${file}.` }));
  writeFileSync(
    join(dir, 'report.json'),
    JSON.stringify({ title: 'Fixture report', summary: 'One paragraph.', diagrams: entries, ...manifest }),
  );
  return { repo, dir };
}

/** The decoded SVG of every image in the report, in order. */
function images(html: string): string[] {
  return [...html.matchAll(/src="data:image\/svg\+xml;base64,([^"]+)"/g)].map((m) =>
    Buffer.from(m[1] ?? '', 'base64').toString('utf8'),
  );
}

function callLog(): string[] {
  return readFileSync(calls, 'utf8').split('\n').filter(Boolean);
}

describe('buildReport', () => {
  it('renders every diagram light and dark, in manifest order, with its prose and an edit link', () => {
    const { repo, dir } = reportRepo({ 'stack.dgmo': 'boxes-and-lines\n', 'sizes.dgmo': 'treemap\n' });
    const out = buildReport(repo, { dgmo, now: NOW });

    expect(out).toBe(join(dir, 'report.html'));
    const html = readFileSync(out, 'utf8');
    expect(images(html)).toEqual([
      expect.stringMatching(/data-theme="light" data-file="stack.dgmo"/),
      expect.stringMatching(/data-theme="dark" data-file="stack.dgmo"/),
      expect.stringMatching(/data-theme="light" data-file="sizes.dgmo"/),
      expect.stringMatching(/data-theme="dark" data-file="sizes.dgmo"/),
    ]);
    expect(html).toMatch(/<img class="only-light" alt="Title of stack.dgmo"/);
    expect(html).toMatch(/<img class="only-dark" alt="Title of stack.dgmo"/);
    expect(html).toContain('<h1>Fixture report</h1>');
    expect(html).toContain('<p class="summary">One paragraph.</p>');
    expect(html).toContain('<p class="text">Text about sizes.dgmo.</p>');
    expect(html).toContain('href="https://diagrammo.app/#fake-stack.dgmo"');
    expect(html).toContain('href="https://diagrammo.app/#fake-sizes.dgmo"');
    expect(html.indexOf('Title of stack.dgmo')).toBeLessThan(html.indexOf('Title of sizes.dgmo'));
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });

  it('stamps the header with the build date and the commit', () => {
    const { repo } = reportRepo({ 'a.dgmo': 'pie\n' });
    const sha = git(repo, 'rev-parse', '--short', 'HEAD');
    const html = readFileSync(buildReport(repo, { dgmo, now: NOW }), 'utf8');
    expect(html).toContain(`Built <time datetime="2026-10-09">2026-10-09</time> at commit <code>${sha}</code>`);
  });

  it('says there is no commit when the repo has no git', () => {
    const { repo } = reportRepo({ 'a.dgmo': 'pie\n' }, {}, 'no-git');
    const html = readFileSync(buildReport(repo, { dgmo, now: NOW }), 'utf8');
    expect(html).toContain('not a git repository, so no commit');
    expect(html).not.toContain('at commit');
  });

  it('carries the footer calls to action', () => {
    const { repo } = reportRepo({ 'a.dgmo': 'pie\n' });
    const html = readFileSync(buildReport(repo, { dgmo, now: NOW }), 'utf8');
    expect(html).toContain(`href="${LINKS.app}"`);
    expect(html).toContain(`href="${LINKS.cloud}"`);
  });

  it('puts the source in the report when the diagram is too large for a link', () => {
    const { repo } = reportRepo({ 'big.dgmo': 'flowchart\n// TOO-LARGE <a & b>\n', 'small.dgmo': 'pie\n' });
    const html = readFileSync(buildReport(repo, { dgmo, now: NOW }), 'utf8');
    expect(html).toContain('<pre><code>flowchart\n// TOO-LARGE &#60;a &#38; b&#62;\n</code></pre>');
    expect(html).not.toContain('#fake-big.dgmo');
    expect(html).toContain('#fake-small.dgmo');
  });

  it('stops on a share failure that is not the size limit', () => {
    const { repo } = reportRepo({ 'a.dgmo': 'pie\n// SHARE-CRASH\n' });
    expect(() => buildReport(repo, { dgmo, now: NOW })).toThrow(/dgmo share failed for a.dgmo:\nError: something else went wrong/);
  });

  it('with links off, never calls share and shows neither a link nor the source', () => {
    const { repo } = reportRepo({ 'a.dgmo': 'pie\n', 'big.dgmo': 'flowchart\n// TOO-LARGE\n' });
    const html = readFileSync(buildReport(repo, { dgmo, now: NOW, links: false }), 'utf8');
    expect(callLog().filter((c) => c.startsWith('share'))).toEqual([]);
    expect(html).not.toContain('Edit in Diagrammo');
    expect(html).not.toContain('<details class="source">');
    expect(images(html)).toHaveLength(4);
  });

  it('stops on a diagram that does not render, quoting the CLI, and leaves the old report alone', () => {
    const { repo, dir } = reportRepo({ 'ok.dgmo': 'pie\n', 'bad.dgmo': 'nonsense\n// RENDER-ERROR\n' });
    writeFileSync(join(dir, 'report.html'), 'the previous report');
    expect(() => buildReport(repo, { dgmo, now: NOW })).toThrow(/bad.dgmo did not render \(light\):\nLine 2: Unknown chart type "nonsense"/);
    expect(readFileSync(join(dir, 'report.html'), 'utf8')).toBe('the previous report');
  });

  it('escapes the prose, so the agent cannot put HTML in the report', () => {
    const { repo } = reportRepo(
      { 'a.dgmo': 'pie\n' },
      { title: 'A <b>bold</b> title', summary: '<script>alert(1)</script>', diagrams: [{ file: 'a.dgmo', title: '"quoted"', text: "it's <i>" }] },
    );
    const html = readFileSync(buildReport(repo, { dgmo, now: NOW }), 'utf8');
    expect(html).toContain('<h1>A &#60;b&#62;bold&#60;/b&#62; title</h1>');
    expect(html).toContain('<p class="summary">&#60;script&#62;alert(1)&#60;/script&#62;</p>');
    expect(html).toContain('alt="&#34;quoted&#34;"');
    expect(html).toContain('<p class="text">it&#39;s &#60;i&#62;</p>');
  });

  it('adds a table of contents only past three diagrams', () => {
    const three = reportRepo({ 'a.dgmo': 'pie\n', 'b.dgmo': 'pie\n', 'c.dgmo': 'pie\n' });
    expect(readFileSync(buildReport(three.repo, { dgmo, now: NOW }), 'utf8')).not.toContain('class="toc"');
    const four = reportRepo({ 'a.dgmo': 'pie\n', 'b.dgmo': 'pie\n', 'c.dgmo': 'pie\n', 'd.dgmo': 'pie\n' });
    const html = readFileSync(buildReport(four.repo, { dgmo, now: NOW }), 'utf8');
    expect(html).toContain('<a href="#d-d">Title of d.dgmo</a>');
    expect(html).toContain('<section id="d-d">');
  });
});

describe('the manifest', () => {
  it('must list every .dgmo in the report directory', () => {
    const { repo, dir } = reportRepo({ 'a.dgmo': 'pie\n' });
    writeFileSync(join(dir, 'stale.dgmo'), 'pie\n');
    expect(() => buildReport(repo, { dgmo })).toThrow(/stale.dgmo is in docs\/codebase-report but not in report.json/);
  });

  it('must name files that exist, inside the report directory', () => {
    const missing = reportRepo({ 'a.dgmo': 'pie\n' }, { diagrams: [{ file: 'gone.dgmo', title: 't', text: 't' }] });
    expect(() => buildReport(missing.repo, { dgmo })).toThrow(/"gone.dgmo" does not exist/);
    const outside = reportRepo({}, { diagrams: [{ file: '../../README.dgmo', title: 't', text: 't' }] });
    expect(() => buildReport(outside.repo, { dgmo })).toThrow(/must be a .dgmo file name in docs\/codebase-report, with no directory/);
  });

  it('must give every diagram a title and text', () => {
    const { repo } = reportRepo({ 'a.dgmo': 'pie\n' }, { diagrams: [{ file: 'a.dgmo', title: 'A', text: ' ' }] });
    expect(() => buildReport(repo, { dgmo })).toThrow(/"diagrams\[0\].text" must be a non-empty string/);
  });

  it('must exist', () => {
    const repo = mkdtempSync(join(tmpdir(), 'skills-no-report-'));
    expect(() => buildReport(repo, { dgmo })).toThrow(/docs\/codebase-report\/report.json is missing/);
  });
});

describe('main', () => {
  it('prints the report path and the link notice once', () => {
    const { repo, dir } = reportRepo({ 'a.dgmo': 'pie\n', 'b.dgmo': 'pie\n' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([repo], { dgmo })).toBe(0);
    expect(log.mock.calls).toEqual([[join(dir, 'report.html')]]);
    expect(err.mock.calls).toEqual([[LINK_NOTICE]]);
  });

  it('takes --no-links, with no notice', () => {
    const { repo } = reportRepo({ 'a.dgmo': 'pie\n' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([repo, '--no-links'], { dgmo })).toBe(0);
    expect(err).not.toHaveBeenCalled();
    expect(callLog().filter((c) => c.startsWith('share'))).toEqual([]);
  });

  it('exits 1 with the error and writes nothing when a diagram fails', () => {
    const { repo, dir } = reportRepo({ 'a.dgmo': 'x\n// RENDER-ERROR\n' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([repo], { dgmo })).toBe(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/^Error: a.dgmo did not render/);
    expect(existsSync(join(dir, 'report.html'))).toBe(false);
  });

  it('exits 2 on an unknown flag', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--links'], { dgmo })).toBe(2);
  });
});

describe('fillTemplate', () => {
  it('refuses a slot with no value, and never re-reads what it inserted', () => {
    expect(() => fillTemplate('{{a}} {{b}}', { a: 'x' })).toThrow(/\{\{b\}\} has no value/);
    expect(fillTemplate('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });
});
