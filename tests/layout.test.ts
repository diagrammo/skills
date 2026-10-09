import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SKILLS_DIR = join(ROOT, 'skills');

// Field rules from Claude Code's marketplace reference
// (https://code.claude.com/docs/en/plugins/marketplace-reference), fetched 2026-10-08.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// The skill listing truncates description + when_to_use past this
// (https://code.claude.com/docs/en/skills).
const LISTING_LIMIT = 1536;

interface PluginEntry {
  name?: unknown;
  source?: unknown;
}

function readMarketplace(): { name?: unknown; owner?: { name?: unknown }; plugins?: PluginEntry[] } {
  return JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
}

/** Top-level `key: value` scalars of a SKILL.md frontmatter block; null when there is none. */
function frontmatter(text: string): Map<string, string> | null {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match?.[1]) return null;
  const fields = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv?.[1] !== undefined && kv[2] !== undefined) fields.set(kv[1], kv[2].trim());
  }
  return fields;
}

const skillDirs = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR).filter((entry) => statSync(join(SKILLS_DIR, entry)).isDirectory())
  : [];

describe('the Claude Code marketplace manifest', () => {
  it('has the required top-level fields', () => {
    const marketplace = readMarketplace();
    expect(marketplace.name).toMatch(NAME);
    expect(String(marketplace.name)).not.toContain('..');
    expect(marketplace.owner?.name).toEqual(expect.any(String));
    expect(marketplace.plugins?.length).toBeGreaterThan(0);
  });

  it('lists each plugin once, from a directory inside this repo', () => {
    const plugins = readMarketplace().plugins ?? [];
    const names = plugins.map((plugin) => plugin.name);
    expect(new Set(names).size).toBe(names.length);
    for (const plugin of plugins) {
      expect(plugin.name).toMatch(NAME);
      expect(typeof plugin.source).toBe('string');
      const source = String(plugin.source);
      expect(source === '.' || source.startsWith('./')).toBe(true);
      expect(source).not.toContain('..');
      const dir = resolve(ROOT, source);
      expect(relative(ROOT, dir).startsWith('..')).toBe(false);
      expect(statSync(dir).isDirectory()).toBe(true);
    }
  });
});

describe('the skill folders', () => {
  it('holds at least one skill', () => {
    expect(skillDirs.length).toBeGreaterThan(0);
  });

  it.each(skillDirs)('%s has a SKILL.md whose name is its folder and whose description fits the listing', (dir) => {
    const path = join(SKILLS_DIR, dir, 'SKILL.md');
    expect(existsSync(path)).toBe(true);
    const fields = frontmatter(readFileSync(path, 'utf8'));
    expect(fields).not.toBeNull();
    expect(fields?.get('name')).toBe(dir);
    const description = fields?.get('description') ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length + (fields?.get('when_to_use')?.length ?? 0)).toBeLessThanOrEqual(LISTING_LIMIT);
  });
});
