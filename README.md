# skills

Agent skills from Diagrammo — portable SKILL.md files plus a Claude Code plugin marketplace.

## Install

In Claude Code:

```
/plugin marketplace add diagrammo/skills
/plugin install diagrammo@diagrammo
```

The plugin brings the skills below, the dgmo MCP server (started with `npx -y @diagrammo/dgmo-mcp@<version>`, pinned in `.mcp.json`,
so Node 20 or later is the only prerequisite), and the `/diagrammo:diagram-this-repo` command, which
runs `dgmo-repo-diagrams` on the repo you are in.

Any other agent that reads `SKILL.md` folders: copy the folder you want from `skills/` into that
agent's skills directory.

## Skills

| Skill | Status |
|---|---|
| `dgmo-repo-diagrams` | Diagrams of your repo — architecture, key code paths, data model, or the ones you pick from its proposals — checked, with share links |
| `dgmo-diagramming` | The DGMO language — syntax, chart types, and the MCP tools to check, render and share a diagram. A copy of `SKILL.md` from [diagrammo/dgmo](https://github.com/diagrammo/dgmo), which generates it |
| `dgmo-codebase-report` | Under construction — does nothing yet |

## Layout

```
skills/<name>/SKILL.md          one folder per skill, agent-agnostic; scripts it bundles live beside it
.claude-plugin/marketplace.json the Claude Code marketplace; its one plugin is this repo's root
.claude-plugin/plugin.json      that plugin's manifest; raise `version` with every release
.claude-plugin/icon.png        the directory listing icon, the app's 512px icon; the portal takes it once, on first save
.mcp.json                       the plugin's MCP server: dgmo-mcp from npm
commands/<name>.md              the plugin's slash commands, run as /diagrammo:<name>
tests/                          vitest suite; tests/fixtures/repos/ holds small repos to run skills against
```

## Develop

```
pnpm install    # also arms the pre-push gate (core.hooksPath .githooks)
pnpm typecheck
pnpm test
```

## License

MIT
