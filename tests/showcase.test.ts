import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readManifest } from '../skills/dgmo-codebase-report/scripts/build-report.mjs';

// The showcase (#1109): dgmo-codebase-report run on four public repos, served
// by GitHub Pages from this repo's docs/ folder. Each report keeps its source
// (.dgmo files + report.json) beside the built page, so a refresh rebuilds it.

const ROOT = resolve(import.meta.dirname, '..');
const DOCS = join(ROOT, 'docs');

interface Entry {
  slug: string;
  name: string;
  repo: string;
  commit: string;
  date: string;
  about: string;
}

function entries(): Entry[] {
  const raw = JSON.parse(readFileSync(join(DOCS, 'showcase.json'), 'utf8')) as { reports: Entry[] };
  return raw.reports;
}

const INSTALL = ['/plugin marketplace add diagrammo/skills', '/plugin install diagrammo@diagrammo'];

describe('showcase site', () => {
  it('lists the four repos the showcase row names', () => {
    expect(entries().map((e) => e.repo).sort()).toEqual([
      'https://github.com/BurntSushi/ripgrep',
      'https://github.com/diagrammo/dgmo',
      'https://github.com/fastapi/fastapi',
      'https://github.com/plausible/analytics',
    ]);
  });

  it('pins every report to the commit it was made from', () => {
    for (const e of entries()) {
      expect(e.commit, e.slug).toMatch(/^[0-9a-f]{7,40}$/);
      expect(e.date, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.slug, e.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('turns Jekyll off, so Pages serves the files as they are', () => {
    expect(existsSync(join(DOCS, '.nojekyll'))).toBe(true);
  });

  describe('index page', () => {
    const index = () => readFileSync(join(DOCS, 'index.html'), 'utf8');

    it('links every report, its repo and its commit', () => {
      const html = index();
      for (const e of entries()) {
        expect(html, e.slug).toContain(`href="${e.slug}/"`);
        expect(html, e.slug).toContain(`href="${e.repo}"`);
        expect(html, e.slug).toContain(`${e.repo}/tree/${e.commit}`);
      }
    });

    it('carries the same install commands as the README', () => {
      const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
      for (const line of INSTALL) {
        expect(readme).toContain(line);
        expect(index()).toContain(line);
      }
    });

    it('loads nothing from another site', () => {
      expect(index()).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/i);
    });
  });

  describe.each(entries().map((e) => [e.slug, e] as const))('report %s', (slug, e) => {
    const page = join(DOCS, slug, 'index.html');
    const source = join(DOCS, slug, 'source');

    it('has its source, and the source passes the build script\'s own manifest check', () => {
      const manifest = readManifest(source);
      expect(manifest.diagrams.length).toBeGreaterThan(0);
    });

    it('is a built report with one figure per listed diagram', () => {
      const html = readFileSync(page, 'utf8');
      const manifest = readManifest(source);
      expect(html).not.toContain('{{');
      expect(html.match(/<figure class="diagram">/g)?.length).toBe(manifest.diagrams.length);
      expect(html).toContain(`<title>`);
      expect(e.name.length).toBeGreaterThan(0);
    });

    it('states the commit it was built at', () => {
      expect(readFileSync(page, 'utf8')).toContain(`<code>${e.commit.slice(0, 7)}`);
    });

    it('is counted on the index by its real number of diagrams', () => {
      const count = readManifest(source).diagrams.length;
      const html = readFileSync(join(DOCS, 'index.html'), 'utf8');
      expect(html).toContain(`${count} diagrams.`);
    });
  });
});
