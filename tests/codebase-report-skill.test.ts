import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MANIFEST, OUTPUT_DIR, readManifest } from '../skills/dgmo-codebase-report/scripts/build-report.mjs';
import { measure } from '../skills/dgmo-codebase-report/scripts/measure.mjs';
import { materializeFixture } from './helpers/fixture-repo.js';
import { tempDir } from './helpers/tmp.js';

const ROOT = resolve(import.meta.dirname, '..');
const SKILL_DIR = join(ROOT, 'skills', 'dgmo-codebase-report');
const SKILL = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');

/** The chart types the DGMO language reference lists. */
const KNOWN_TYPES = new Set(
  [...readFileSync(join(ROOT, 'skills', 'dgmo-diagramming', 'SKILL.md'), 'utf8').matchAll(/^\| `([a-z-]+)` +\|/gm)].map(
    (m) => m[1],
  ),
);

/** The body of numbered step `n`, up to the next step or heading. */
function step(n: number): string {
  const match = new RegExp(`^${n}\\. [\\s\\S]*?(?=^${n + 1}\\. |^## |(?![\\s\\S]))`, 'm').exec(SKILL);
  return match?.[0] ?? '';
}

/** The chart menu's rows: [chart, type cell, data cell]. */
function menu(): string[][] {
  return [...step(3).matchAll(/^ {3}\| ([^|]+)\| ([^|]+)\| ([^|]+)\| [^|]+\|$/gm)]
    .map((m) => [m[1]!.trim(), m[2]!.trim(), m[3]!.trim()])
    .filter(([chart]) => chart !== 'Chart' && !/^-+$/.test(chart!));
}

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('dgmo-codebase-report SKILL.md', () => {
  it('is no longer the under-construction stub', () => {
    expect(SKILL).not.toMatch(/disable-model-invocation/);
    expect(SKILL).not.toMatch(/under construction/i);
    const description = /^description: (.*)$/m.exec(SKILL)?.[1] ?? '';
    expect(description).toMatch(/codebase report/i);
    expect(description).toMatch(/report\.html/);
  });

  it('runs the two bundled scripts, which exist', () => {
    expect(step(1)).toMatch(/node <skill>\/scripts\/measure\.mjs <repo-dir>/);
    expect(step(7)).toMatch(/node <skill>\/scripts\/build-report\.mjs <repo-dir>/);
    expect(existsSync(join(SKILL_DIR, 'scripts', 'measure.mjs'))).toBe(true);
    expect(existsSync(join(SKILL_DIR, 'scripts', 'build-report.mjs'))).toBe(true);
    expect(SKILL).toContain(OUTPUT_DIR);
  });

  it('offers the core four and a menu of earned charts, every one a real DGMO type', () => {
    const rows = menu();
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const types = rows.map(([, type]) => /`([a-z-]+)`/.exec(type!)?.[1]);
    for (const type of types) expect(KNOWN_TYPES, `${type} is not a DGMO chart type`).toContain(type);
    expect(types.slice(0, 4)).toEqual(['boxes-and-lines', 'treemap', 'pie', 'event-line']);
    expect(types).toEqual(expect.arrayContaining(['sequence', 'er', 'flowchart', 'sitemap', 'state', 'journey-map', 'swimlane', 'scatter', 'arc']));
  });

  it('names only measurement fields that measure.mjs writes', () => {
    const dir = materializeFixture('typescript');
    made.push(dir);
    const m = measure(dir) as unknown as Record<string, unknown>;
    const fields = menu().flatMap(([, , data]) => [...data!.matchAll(/`([a-zA-Z]+)\.([a-zA-Z]+)`/g)].map((f) => [f[1]!, f[2]!]));
    expect(fields.length).toBeGreaterThanOrEqual(6);
    for (const [section, field] of fields) {
      const value = (m[section] as Record<string, unknown> | undefined)?.[field];
      expect(value, `measurements.json has no ${section}.${field}`).toBeDefined();
    }
  });

  it('shows a report.json the build accepts', () => {
    const json = /```json\n([\s\S]*?)```/.exec(step(6))?.[1];
    expect(json).toBeDefined();
    const dir = tempDir('skills-report-skill-');
    made.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, MANIFEST), json!);
    const example = JSON.parse(json!) as { diagrams: { file: string }[] };
    for (const { file } of example.diagrams) writeFileSync(join(dir, file), 'pie Example\n');
    expect(readManifest(dir).diagrams.map((d) => d.file)).toEqual(example.diagrams.map((d) => d.file));
  });

  it('publishes nothing without an explicit yes, and never over an existing Pages site', () => {
    expect(step(8)).toMatch(/do neither without an explicit yes/);
    expect(SKILL).toMatch(/Never overwrite a site that exists/);
    expect(SKILL).toMatch(/Never put the code in the URL/);
  });

  it('keeps the sign-in label inside the 80 characters the API takes, and says what a failed Pages switch leaves', () => {
    expect(SKILL).toMatch(/Cut\s+the label to 80 characters/);
    expect(SKILL).toMatch(/`gh-pages`\s+branch is pushed but no site is on/);
  });
});
