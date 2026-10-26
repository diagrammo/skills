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

// Plugin components load from the standard layout at the plugin root
// (https://code.claude.com/docs/en/plugins/manifest-reference, fetched 2026-10-19):
// `.mcp.json` for MCP servers, `commands/<file>.md` as `/<plugin>:<file>`.
// The claude.ai directory blocks a plugin folder with no manifest, no license, or a name with
// characters outside [a-z0-9-] (https://claude.com/docs/plugins/pre-submission-checklist, fetched 2026-10-20).
describe('the plugin manifest', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<
    string,
    unknown
  >;

  it('names the plugin the marketplace lists, in lowercase kebab case', () => {
    expect(manifest['name']).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
    expect(readMarketplace().plugins?.map((plugin) => plugin.name)).toEqual([manifest['name']]);
  });

  it('sets the fields the directory listing shows', () => {
    expect(manifest['version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest['description']).toEqual(expect.any(String));
    expect(manifest['license']).toBe('MIT');
    expect((manifest['author'] as { name?: unknown } | undefined)?.name).toEqual(expect.any(String));
  });
});

describe('the plugin components', () => {
  // The claude.ai directory blocks an npx launcher not pinned to an exact version
  // (https://claude.com/docs/plugins/pre-submission-checklist, fetched 2026-10-20).
  // A credential the server reads from the user's machine is held for review;
  // the directory wants it asked for through userConfig with sensitive: true.
  it('starts the dgmo MCP server from npm, pinned to an exact version, with no prompt', () => {
    const config = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown; env?: unknown }>;
    };
    expect(config.mcpServers?.['dgmo']).toEqual({
      command: 'npx',
      args: ['-y', expect.stringMatching(/^@diagrammo\/dgmo-mcp@\d+\.\d+\.\d+$/)],
      env: { DGMO_API_KEY: '${user_config.dgmo_api_key}' },
    });
  });

  it('asks for the space API key as an optional, sensitive setting', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')) as {
      userConfig?: Record<string, Record<string, unknown>>;
    };
    expect(manifest.userConfig?.['dgmo_api_key']).toMatchObject({ type: 'string', sensitive: true });
    expect(manifest.userConfig?.['dgmo_api_key']?.['required']).not.toBe(true);
  });

  it('has a /diagram-this-repo command that runs a skill this plugin carries', () => {
    const text = readFileSync(join(ROOT, 'commands', 'diagram-this-repo.md'), 'utf8');
    expect(frontmatter(text)?.get('description')).toEqual(expect.any(String));
    const named = [...text.matchAll(/`([a-z0-9-]+)` skill/g)].map((match) => match[1]);
    expect(named).toEqual(['dgmo-repo-diagrams']);
    expect(skillDirs).toContain('dgmo-repo-diagrams');
  });

  it('carries the dgmo-diagramming skill as dgmo generates it, the AI core included', () => {
    const text = readFileSync(join(SKILLS_DIR, 'dgmo-diagramming', 'SKILL.md'), 'utf8');
    expect(text).toContain('GENERATED by dgmo/scripts/gen-ai-core.mjs');
    const start = text.indexOf('<!-- DGMO-AI-CORE:START -->');
    const end = text.indexOf('<!-- DGMO-AI-CORE:END -->');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });
});
