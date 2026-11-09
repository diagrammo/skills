import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Codex plugin (#1791) is the same plugin root as the Claude Code one, with
// its own manifest (.codex-plugin/plugin.json), its own MCP file (mcp.json —
// the Agent Plugins format, which declares a transport `type`) and its own
// marketplace (.agents/plugins/marketplace.json). Format fetched 2026-11-09 from
// https://developers.openai.com/plugins/build/plugins and checked by installing
// it with codex-cli 0.166.0 into a scratch CODEX_HOME.
//
// 🔴 Without `mcpServers: "./mcp.json"` in the manifest, Codex reads the Claude
// `.mcp.json` instead and passes `${user_config.dgmo_api_key}` through as a
// literal API key (observed with codex-cli 0.166.0, 2026-11-09).

const ROOT = resolve(import.meta.dirname, '..');
const json = (rel: string): any => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const PIN = /^@diagrammo\/dgmo-mcp@(\d+\.\d+\.\d+)$/;

function pinOf(rel: string): string {
  const args: string[] = json(rel).mcpServers.dgmo.args;
  const pin = args.map((a) => PIN.exec(a)?.[1]).find(Boolean);
  expect(pin, `${rel} has no exact @diagrammo/dgmo-mcp@X.Y.Z argument`).toBeTruthy();
  return pin as string;
}

/** Chart ids in the skill's generated type index — the `| \`id\` | … |` rows. */
function skillIndexIds(): string[] {
  const text = readFileSync(join(ROOT, 'skills', 'dgmo-diagramming', 'SKILL.md'), 'utf8');
  return [...text.matchAll(/^\| `([a-z0-9-]+)`\s+\|/gm)].map((m) => m[1] as string);
}

/** Ask the installed server, over stdio, what `list_chart_types` returns. */
async function serverChartIds(): Promise<string[]> {
  const entry = join(ROOT, 'node_modules', '@diagrammo', 'dgmo-mcp', 'dist', 'index.js');
  const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'ignore'] });
  const send = (msg: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  try {
    const text = await new Promise<string>((done, fail) => {
      let buffer = '';
      child.on('error', fail);
      child.on('exit', (code) => fail(new Error(`dgmo-mcp exited (${code}) before answering`)));
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            send({ method: 'notifications/initialized' });
            send({ id: 2, method: 'tools/call', params: { name: 'list_chart_types', arguments: {} } });
          } else if (msg.id === 2) {
            done(msg.result.content[0].text as string);
          }
        }
      });
      send({
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'skills-test', version: '0' } },
      });
    });
    return [...text.matchAll(/^- ([a-z0-9-]+)/gm)].map((m) => m[1] as string);
  } finally {
    child.kill();
  }
}

describe('the Codex plugin', () => {
  it('is the Claude Code plugin under the same name and version', () => {
    const codex = json('.codex-plugin/plugin.json');
    const claude = json('.claude-plugin/plugin.json');
    expect(codex.name).toBe(claude.name);
    expect(codex.version).toBe(claude.version);
    expect(codex.mcpServers).toBe('./mcp.json');
  });

  it('is offered by a Codex marketplace rooted at this repo', () => {
    const market = json('.agents/plugins/marketplace.json');
    expect(market.plugins).toContainEqual(
      expect.objectContaining({ name: json('.codex-plugin/plugin.json').name, source: { source: 'local', path: './' } }),
    );
  });

  it('starts the same dgmo-mcp as the Claude plugin, and the one these tests run', () => {
    const pin = pinOf('.mcp.json');
    expect(pinOf('mcp.json')).toBe(pin);
    expect(json('mcp.json').mcpServers.dgmo.type).toBe('stdio');
    expect(json('package.json').devDependencies['@diagrammo/dgmo-mcp']).toBe(pin);
  });
});

describe('the dgmo-diagramming skill and the pinned MCP server', () => {
  it('index exactly the chart types list_chart_types offers', async () => {
    const skill = skillIndexIds();
    const server = await serverChartIds();
    expect(server.length).toBeGreaterThan(20);
    expect(
      { onlyInSkill: skill.filter((id) => !server.includes(id)), onlyInServer: server.filter((id) => !skill.includes(id)) },
      'copy dgmo/SKILL.md into skills/dgmo-diagramming/SKILL.md, or move the pin (scripts/plugin-follow-mcp.sh)',
    ).toEqual({ onlyInSkill: [], onlyInServer: [] });
  }, 30_000);
});
