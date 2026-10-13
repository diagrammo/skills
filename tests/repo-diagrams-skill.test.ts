import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(
  join(resolve(import.meta.dirname, '..'), 'skills', 'dgmo-repo-diagrams', 'SKILL.md'),
  'utf8',
);

/** The body of numbered step `n`, up to the next step. */
function step(n: number): string {
  const match = new RegExp(`^${n}\\. [\\s\\S]*?(?=^${n + 1}\\. |(?![\\s\\S]))`, 'm').exec(SKILL);
  return match?.[0] ?? '';
}

describe('dgmo-repo-diagrams interactive mode', () => {
  it('is named in the description, so a request to choose the diagrams loads the skill', () => {
    const description = /^description: (.*)$/m.exec(SKILL)?.[1] ?? '';
    expect(description).toMatch(/choose/);
    expect(description).toMatch(/propose/);
  });

  it('says when to use each of the two modes', () => {
    expect(SKILL).toMatch(/^- \*\*Default\*\* — /m);
    expect(SKILL).toMatch(/^- \*\*Interactive\*\* — you propose candidate diagrams and the user picks/m);
  });

  it('proposes numbered candidates in step 2, the default set first and marked, then waits for the pick', () => {
    const choose = step(2);
    expect(choose).toMatch(/\*\*Interactive mode — propose, then wait\.\*\*/);
    expect(choose).toMatch(/Put the default set\s+first and mark each of its rows `\(recommended\)`/);
    expect(choose).toMatch(/Reply with the numbers to draw/);
    expect(choose).toMatch(/Write nothing until the user answers/);
  });

  it('suggests candidate types beyond the default set', () => {
    const extras = [...step(2).matchAll(/^ {3}\| [^|]+\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
    expect(extras.length).toBeGreaterThanOrEqual(4);
    expect(extras).toEqual(expect.arrayContaining(['infra', 'state', 'class', 'flowchart', 'sitemap']));
  });

  it('drops the skipped-diagram lines from the report when the user chose the set', () => {
    expect(step(6)).toMatch(/In interactive mode, skip those lines/);
  });
});
