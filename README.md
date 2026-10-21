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
| `dgmo-codebase-report` | An onboarding report of your repo — 10 to 15 diagrams from its measured sizes, languages, history and imports, plus what the code shows, built into one `report.html` |

## What it runs and sends

- **Install:** `npx` downloads `@diagrammo/dgmo-mcp` at the version pinned in `.mcp.json` from the npm registry.
- **The MCP server** runs on your machine and makes no network requests. It checks and renders diagrams locally.
- **Share links:** the share tool compresses the diagram's source into a link to `online.diagrammo.app`. Nothing is uploaded when the link is made. Whoever opens the link sends the diagram, in the URL, to that site, which draws it in their browser and does not store it. The [privacy policy](https://diagrammo.app/privacy) covers that site.
- **Open in app:** if the Diagrammo desktop app is installed, the server can open a diagram in it.
- **Skill scripts** read the repo you run them in and write their output inside it. They send nothing.
- **Codebase report publishing:** only when you say yes at the end of a run. A Cloud space sends each diagram's source to `api.diagrammo.app` after you sign in; GitHub Pages pushes `report.html` to a `gh-pages` branch of your repo, where it is public.
- No personal data, credentials or telemetry.

## Layout

```
skills/<name>/SKILL.md          one folder per skill, agent-agnostic; scripts it bundles live beside it
.claude-plugin/marketplace.json the Claude Code marketplace; its one plugin is this repo's root
.claude-plugin/plugin.json      that plugin's manifest; raise `version` with every release
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
