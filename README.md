# skills

Agent skills from Diagrammo — portable SKILL.md files plus a Claude Code plugin marketplace.

## Install

In Claude Code:

```
/plugin marketplace add diagrammo/skills
/plugin install diagrammo@diagrammo
```

Any other agent that reads `SKILL.md` folders: copy the folder you want from `skills/` into that
agent's skills directory.

## Skills

| Skill | Status |
|---|---|
| `dgmo-codebase-report` | Under construction — does nothing yet |

## Layout

```
skills/<name>/SKILL.md          one folder per skill, agent-agnostic; scripts it bundles live beside it
.claude-plugin/marketplace.json the Claude Code marketplace; its one plugin is this repo's root
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
