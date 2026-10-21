---
name: dgmo-codebase-report
description: Codebase report — measure this repo, then write 10 to 15 DGMO diagrams of it with a few sentences each and build one self-contained report.html in docs/codebase-report, for onboarding a developer. Use when the user asks for a codebase report, an onboarding report or a report.html of their repo. At the end it offers to publish the report to a Diagrammo Cloud space or to the user's own GitHub Pages.
---

# Codebase report

Turn the repository into `docs/codebase-report/report.html`: a short summary, then 10 to 15
diagrams, each with 2 to 4 sentences, rendered for light and dark. A developer new to the repo reads
it top to bottom on their first day. A re-run replaces the report: step 5 clears the old diagrams
first.

🔴 **Every number comes from `measurements.json`, and every box, participant or table names
something you read in the code.** Never estimate a size, a count or a date, and never draw an
imagined component. A chart with invented data is worse than no chart.

🔴 **You write only `.dgmo` files and `report.json`.** The build script writes the HTML. Never write
or edit HTML yourself.

What you need: Node 20 or later. The scripts run the CLI as `npx -y @diagrammo/dgmo-cli`, so the
user installs nothing. git is optional. `<skill>` below is this skill's directory.

## Steps

1. **Measure.** Run `node <skill>/scripts/measure.mjs <repo-dir>`. It writes
   `docs/codebase-report/measurements.json` and prints its path. Each section names the chart it
   feeds (`chart`), and says whether it was rolled up (`rolledUp`, `rollUpNote`). In a repo with no
   git history or a shallow clone, `history`, `edits` and `coChange` carry `available: false` and a
   `reason` — skip those charts and say why in the summary. Done when the file exists and you know
   which sections are available.

2. **Read the repo.** Read the README, the manifests (`package.json`, `pyproject.toml`, `go.mod`,
   `Cargo.toml`, …), the entry points, the routes or handlers, the config that names outside
   services, and any schema, migrations or ORM models. Note each finding with its `file:line`. Done
   when you can name the deployable parts, what each one talks to, the main use cases, and where data
   is stored.

3. **Pick the charts.** Always draw the core four, then add the earned charts the repo has the
   material for, until you have 10 to 15:

   | Chart | Type | Data | When |
   |---|---|---|---|
   | The stack | `boxes-and-lines` | What you read in step 2 | Always |
   | Size by directory | `treemap` | `sizes.entries` | Always |
   | Languages | `pie` | `languages.slices` | Always |
   | History | `event-line` | `history.tags` and `history.largestCommits` | When `history.available` |
   | Primary use cases — 2 or 3 | `sequence` | Each traced call by call through the code | Always, for an app or a service; for a library, its main entry calls |
   | Data model | `er` | The schema, migrations or ORM models | A schema is present |
   | An interesting algorithm | `flowchart` | One function with several decision points | The code has one worth explaining |
   | Pages or routes | `sitemap` | The router or pages directory | A site is present |
   | A real lifecycle | `state` | A status field with set transitions, such as an order | The code has one |
   | A user's journey | `journey-map` | The product's main flow, from the routes and the UI | An app with a user-facing flow |
   | Who does what | `swimlane` | A process that crosses several parts or roles | The code has one |
   | Hot files | `scatter` with a size column (a bubble chart) | `edits.files`: lines × edits, bubble size from bytes | When `edits.available` |
   | Module dependencies | `arc` | `imports.nodes` and `imports.edges` | The import graph has edges |
   | Files that change together | `arc` | `coChange.pairs` | When `coChange.available` and it has pairs |

   🔴 **No forced or placeholder charts.** Skip any chart the repo has nothing for. A small repo gets
   fewer than 10 — say so in the summary rather than padding. Done when you have the list, in reading
   order, with the data or files each chart comes from.

4. **Load the syntax for each type before you write it.** Fetch
   `https://diagrammo.app/llms/<type>.txt` for every type on your list, for example
   `https://diagrammo.app/llms/treemap.txt`. DGMO is not Mermaid — write from the reference, never
   from Mermaid habits. Done when you have read the reference for every type you will write.

5. **Write each diagram** to `docs/codebase-report/<nn>-<slug>.dgmo`. On a re-run, first delete the
   `.dgmo` files an earlier run left there. The two-digit number sets the order: `01-stack.dgmo`,
   `02-sizes.dgmo`, `03-languages.dgmo`.
   - The first line is the type and a short title, as the type's reference shows.
   - Then a `//` comment naming the source: `// From: measurements.json sizes` or
     `// From: src/server.ts, src/routes/checkout.ts`.
   - A measured chart copies its values from its section exactly. When the section is rolled up,
     draw the rolled-up data as it is, `(other)` included.
   - Use the names the code uses, shortened to a few words. Keep each diagram under about 40
     elements; leave out the minor parts rather than crowding it.

   Done when every chart on your list is a file in `docs/codebase-report/`, and no other `.dgmo`
   file is there.

6. **Write `docs/codebase-report/report.json`:**

   ```json
   {
     "title": "<repo name> — codebase report",
     "summary": "One paragraph: what the repo is, how it is built, and where a newcomer starts.",
     "diagrams": [
       { "file": "01-stack.dgmo", "title": "The stack", "text": "2 to 4 sentences." }
     ]
   }
   ```

   - List every `.dgmo` file in the folder once, in reading order. The build refuses a file that is
     missing from the list, and a listed file that does not exist.
   - Each `text` is plain text, 2 to 4 sentences: what the chart shows, then what a newcomer should
     take from it. When the section was rolled up, say so in the chart's own words — its
     `rollUpNote`.
   - The summary names any core chart you skipped, with the reason: `No history chart — this is a
     shallow clone`.

   Done when the file is valid JSON and lists every diagram.

7. **Build.** Run `node <skill>/scripts/build-report.mjs <repo-dir>`. It renders every diagram
   light and dark, gets an "Edit in Diagrammo" link for each, writes `report.html` and prints its
   path. If a diagram does not render, it writes nothing and prints `Error: <file> did not render
   (<theme>):` and the CLI's error. Fix that diagram, and any other with the same mistake, then run
   it again. Fix the diagram, never the script. Done when it exits 0 and prints the path.

   Each link carries the diagram's full source in the URL; the script prints a notice saying so.
   Pass it on to the user. If the user asked for no links, run it with `--no-links`. A diagram too
   big for a link gets its source printed in the report instead.

8. **Report and offer to publish.** Tell the user the path of `report.html`, the number of
   diagrams, each core chart you skipped with its reason, and the link notice. Then offer the two
   publish options below, both in one question, and 🔴 **do neither without an explicit yes.**
   Done when the user has the path and has answered the offer, or declined it.

## Publish to a Diagrammo Cloud space

Puts each diagram in a new Cloud space named after the repo, where the user can edit and share it.
The API is `https://api.diagrammo.app`; send JSON with `content-type: application/json`.

1. **Sign in.** Reuse `~/.config/diagrammo/session.json` if it exists and its `expiresAt` (epoch
   seconds) is in the future. Otherwise:
   - `POST /auth/desktop/start` with `{"client":"cli","label":"Codebase report on <hostname>"}`. It
     answers `deviceCode`, `userCode` and `expiresIn` (seconds).
   - Tell the user: open `https://online.diagrammo.app/connect?client=cli` and type `<userCode>`.
     🔴 Never put the code in the URL. Never show `deviceCode`.
   - `POST /auth/desktop/poll` with `{"deviceCode":"<deviceCode>"}` every 3 seconds. `status:
     "pending"` means wait. `status: "approved"` carries `session.token`, `session.expiresAt`,
     `label` and `manageUrl`. A 404 means the code expired: start again.
   - Save `{"token","expiresAt","label"}` to `~/.config/diagrammo/session.json` with mode 0600.
     Tell the user: "Signed in as `<label>`. Revoke it any time at `<manageUrl>` (Your sessions)."
     Also say that deleting the file does not revoke the session.
2. **Make the space.** `POST /spaces` with `{"name":"<repo name>"}`, the header
   `authorization: Bearer <token>`, and an `idempotency-key` header holding a new UUID. The reply's
   `id` is the space.
3. **Add each diagram**, in report order: `POST /spaces/<space id>/diagrams` with
   `{"title":"<its report title>","source":"<the .dgmo file's text>","chartType":"<its type>"}`,
   the same `authorization` header, and a new UUID `idempotency-key` per diagram.
4. A 401 at any step: delete the session file, sign in again, and retry that step with the same
   `idempotency-key`. Any other error: stop, show the user the API's error message, and say which
   diagrams are already in the space. Done when every diagram is in the space. Tell the user the space's name, and
   that it is in the spaces menu at `https://online.diagrammo.app`.

## Publish to the user's own GitHub Pages

Puts `report.html` on the user's GitHub Pages site as `index.html` on a `gh-pages` branch. Needs
`gh` signed in and a GitHub remote.

1. 🔴 **Warn, then ask for an explicit yes.** Say that every file path, directory name, module name
   and commit message in the report becomes public, and that a Pages site is public on most GitHub
   plans even when the repo is private. Go on only on a yes to that warning.
2. 🔴 **Never overwrite a site that exists.** If `git ls-remote --heads origin gh-pages` prints a
   line, or `gh api repos/<owner>/<repo>/pages` answers anything but 404, stop and tell the user:
   they already have a Pages site, and publishing over it is their call, not yours.
3. Build the branch in a temporary worktree, so the user's working tree is not touched. 🔴 **Run
   every command after the first with `git -C <tmp>`, never bare** — `checkout --orphan` and `rm`
   in the user's own repo would switch their branch and delete their files.
   - `git worktree add --detach <tmp>`
   - `git -C <tmp> checkout --orphan gh-pages`, then `git -C <tmp> rm -rfq .`
   - Copy `report.html` to `<tmp>/index.html`, and create an empty `<tmp>/.nojekyll`.
   - `git -C <tmp> add index.html .nojekyll`, `git -C <tmp> commit -m "Codebase report"`, and
     `git -C <tmp> push origin gh-pages`.
   - Remove the worktree with `git worktree remove <tmp>`. If the push failed, also delete the local
     branch this run made, `git branch -D gh-pages`, before you try again.
4. Turn Pages on: `echo '{"source":{"branch":"gh-pages","path":"/"}}' | gh api -X POST
   repos/<owner>/<repo>/pages --input -`. Its reply's `html_url` is the address. Done when you have
   told the user that address; the first build can take a few minutes to appear.
