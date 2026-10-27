---
name: plugin-builder
description: End-to-end Skill for building DSH (DeepSeek Harness) plugins from scratch: interactive requirement intake → dsh-xxx-xxx naming → dialog / sidebar / settings-page layout choice → architecture design → project structure and implementation → testing and build → code audit and privacy scrubbing → README and GitHub release preparation → delivery. Use when the user wants to "build a DSH plugin / Harness plugin / extension / panel / tool / theme plugin", or has only an idea that needs to become a complete, deliverable project. Default is delivery only: no install, no enable, no GitHub upload, no git commit, no Release.
---

# plugin-builder — Full DSH Plugin Development Workflow

> English edition of [`SKILL.md`](SKILL.md). The two are meant to stay in sync; if they ever diverge, the Chinese `SKILL.md` is authoritative.

One-line principle: **Ask first, then design; implement first, then test; audit first, then deliver; never install by default.**

The output of this Skill is a **complete, inspectable, deliverable plugin project directory** — not a code snippet, and not a design document.

---

## 0. Hard boundaries (apply to every stage, non-negotiable)

Unless the user has **explicitly authorized it in the current conversation**, none of the following happens:

| Forbidden | Meaning |
|---|---|
| Installing the plugin | No `plugin_manager install_bundle`, no `dsh plugin ... add`, no copying into the profile's `node_modules` |
| Enabling / disabling the plugin | No `plugin_manager set_plugin` / `set_bundle` |
| Changing DSH config | No writes to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, `package.json`, or `cordis.yml` |
| Uploading / committing / publishing | No remote operations beyond `git init`, no `git commit`, no `git push`, no repo creation, no tags, no Releases |
| Installing dependencies into the host environment | No `pnpm add` into the user's DSH environment; project dependencies go into the project's own `package.json` only |
| Inventing DSH APIs | Any field, lifecycle, permission, slot name or install method that has not been verified must be marked "unverified" — see §2 |

Why: the user wants to read the code first, then decide whether to upload it to GitHub and whether to install from GitHub. **Development work and environment modification are separate tasks.**

Allowed write scope: new project directories inside the current workspace, this Skill's own templates, and paths the user explicitly names. Ask before writing outside the workspace.

---

## 0.1 Tools bundled with this Skill

All under `scripts/`, pure Node (no third-party dependencies). Invoke them by absolute path:

| Script | Purpose | When to use |
|---|---|---|
| `scripts/check-project.mjs <project-dir>` | Structure / config / entry / id / JSON / locale / icon / syntax self-check | Stage 7 testing |
| `scripts/audit-scan.mjs <project-dir> [--json] [--strict]` | Credentials, privacy, dangerous patterns + bundle structure scan | Stage 8 audit (re-scan once after fixes) |
| `scripts/audit-scan.test.mjs` / `check-project.test.mjs` | Tests for those two scripts | After changing the scripts |
| `scripts/self-check.mjs` | Verifies this Skill itself is complete and free of dead links | After editing the Skill's content |

Templates:

| File | Purpose |
|---|---|
| `templates/bundle-skeleton/` | Copy-ready empty plugin skeleton (already passes the self-check) |
| `templates/README-template.md` | README template for a plugin project |
| `templates/audit-report-template.md` | Audit report template |
| `templates/project-structure.md` | Project structure selection |

Reference documents: `references/requirements.md` (questioning strategy), `references/ui-design.md` (layout selection),
`references/security-audit.md` (audit checklist), `references/github-release.md` (release and install boundaries),
`references/dsh-plugin-api.md` (verified API and the unverified list), `references/scenarios.md` (behavioral acceptance scenarios).

> The two scripts check **the part that can be automated**. Passing them ≠ the plugin works: slot rendering,
> theme appearance and post-install behavior must be verified on a real machine. The delivery report must state the unverified items honestly.

---

## 1. Pipeline and stage gates

```text
Receive request
  ↓
Stage 0   Fact check (real API / environment / existing projects)
  ↓
Stage 1   Requirement extraction and gap analysis   ── missing P0 info → ask
  ↓
Stage 2   Plugin naming                             ── no name / non-compliant → offer options   ★must ask
  ↓
Stage 3   Interaction layout and config placement   ── unspecified → offer options              ★must ask
  ↓
Stage 4   Requirement summary                       ── ★confirmation gate
  ↓
Stage 5   Architecture design                       ── ★confirmation gate
  ↓
Stage 6   Project structure and implementation
  ↓
Stage 7   Testing and build
  ↓
Stage 8   Code audit + privacy check + scrubbing
  ↓
Stage 9   README and documentation
  ↓
Stage 10  GitHub release preparation (prepare only, do not execute)
  ↓
Stage 11  Delivery report → stop
```

| Stage | Entry condition | Output | Needs user confirmation |
|---|---|---|---|
| 0 Fact check | Immediately | Capability/API list (verified / unverified) | No |
| 1 Requirement extraction | Stage 0 done | Known-information table + list of open questions | No (questions happen here) |
| 2 Naming | Function is clear | Final (compliant) name | **Yes** |
| 3 Layout | Function is clear | Interaction surfaces + each surface's responsibility | **Yes** |
| 4 Requirement summary | 2 and 3 done | Requirement summary | **Yes** |
| 5 Architecture design | 4 approved | Architecture description | **Yes** |
| 6 Implementation | 5 approved | Complete project files | No |
| 7 Testing | 6 done | Test results (four categories) | No |
| 8 Audit | 7 done | Audit report + fixed items | No |
| 9 Documentation | 8 done | README + config/dev notes | No |
| 10 Release prep | 9 done | Release checklist (not executed) | No |
| 11 Delivery | 10 done | Delivery report | Stop |

**Skipping rules**: reuse anything the user has already provided — never ask twice. But the confirmation gates in stages 2, 3, 4 and 5 cannot be skipped, unless the user explicitly says "you decide / don't ask me". In that case record the defaults you adopted per `references/requirements.md` §5, and mark each one "（default, changeable）" in the requirement summary.

**Staged interaction** (do not dump ten questions at once):

1. Name + core function
2. Interaction layout + configuration approach
3. Necessary details (data source, export format, default behavior, …)
4. Design confirmation

---

## 2. Stage 0: what must be verified before starting

**Do not write DSH APIs from memory.** Check in this order; if something cannot be verified, mark it "unverified" and tell the user.

1. **Load the official plugin-development Skill**: if the session offers `cordis-plugin-development` / `cordis-composition-reference`, load it with `skill` first and follow its pointers to the references (bundle manifest, Client module, slot registration, install boundaries).
2. **Live inspection (most authoritative)**:
   - `cordis_inspect_list` — see which read-only probes exist
   - `cordis_inspect_query` + `Config.listConfigs` — Config JSON Schema and `packageDir` of installed plugins
   - `cordis_inspect_query` + `Slots.listSubTree` (client) — real slot names, kind, registration arguments; `root=<slot>` for a single slot's props
   - `cordis_inspect_query` + `Theme.listTokens` (client) — theme tokens
   - `cordis_inspect_query` + `Service` / `Event` — Host service methods and event signatures
3. **Read the package docs**: `<packageDir>/README.md`; source under `lib/index.js`, `lib/types/**/*.d.ts` (installed build) or `src/` (source checkout).
4. **Read existing plugins**: plugin projects already in the workspace and `$DSH_PROFILE_DIR/node_modules/dsh-*` are valid sources of truth; **learn the structure, never copy the business logic**.

Output (internal record, attached to the delivery report):

```text
Verified:   DSH version, bundle declaration style, Host/Client entry points, available slots, theme tokens, install command
Unverified: fields / behavior that could not be confirmed (say why, and how the user can verify)
```

The facts already verified in this environment live in `references/dsh-plugin-api.md` (including the "unverified" list; it is not maintained automatically across DSH upgrades — re-check every time).

---

## 3. Stage 1: requirement extraction and gap analysis

Build a **known-information table** first, and only ask about the empty cells.

| Dimension | Provided? | If unknown |
|---|---|---|
| Plugin name | Use the user's name, check compliance | Offer candidates in stage 2 |
| Core function (P0) | Must be explicit | **Ask**: what problem does the plugin solve |
| Data handled (P0) | Session logs / files / clipboard / network | **Ask**: what is read and written, from where, to where |
| Trigger (P0) | Chat / button / automatic / command | **Ask** |
| Interaction layout (P1) | Adopt if specified | Offer candidates in stage 3 |
| Configuration needed (P1) | Needed for long-lived parameters | Ask for complex plugins |
| Input/output format (P1) | e.g. export as MD/JSON | Ask |
| UI style (P2) | May default | Offer options only when UI is involved |
| Extra features | — | Do not add on your own |

Finer questioning strategy, priorities (P0/P1/P2) and option wording are in `references/requirements.md`.

**Ask only the questions that genuinely change the design**; do not walk the checklist mechanically. When the user says "you decide", pick a reasonable default within your mandate and log it.

---

## 4. Stage 2: plugin naming (must interact)

### 4.1 Naming rules

| Rule | Requirement |
|---|---|
| Prefix | Must start with `dsh-` |
| Characters | Lowercase ASCII letters, digits and hyphens `-` only |
| Separator | Hyphens between words; no spaces, underscores, capitals or CJK characters |
| Length | 2–4 words, ≤ 32 characters total |
| Semantics | Describe the main function; avoid `dsh-my-plugin`, `dsh-test`, `dsh-awesome-tool-v2-final` |
| Consistency | Package name = patch line `name` = Client `ModuleLoader` `id` |

### 4.2 When the user gave no name

**Never decide the final name on the user's behalf.** Generate three candidates, each with name, meaning and rationale, plus a "custom name" option. Present them as options via `ask_user_question` (recommended one first, labelled `(Recommended)`).

Example output format:

```text
For the "beautify the chat UI" request, here are three naming options:

A. dsh-chat-beautify — beautify the chat UI; suits a broad chat-UI theming plugin.
B. dsh-chat-theme    — chat theme management; suits a plugin centered on theme switching and style config.
C. dsh-chat-style-customizer — chat style customization; long, suits a plugin with many configuration options.

Choose:
1. A   2. B   3. C   4. Custom name
```

After the user picks one, re-check it against 4.1; if non-compliant, fix it and explain what changed.

### 4.3 When the user already gave a name

- Compliant and matching the function → adopt it, **do not rename**.
- Non-compliant (e.g. `ChatBeautify`, `dsh chat beautify`, `my-dsh-plugin`) → propose the **smallest** correction (`dsh-chat-beautify`) and ask whether to accept it.
- Clearly mismatched with the function (named export, actually a theme) → point it out and ask; never rename silently.

### 4.4 Limits of the collision check

If reliable search is available you may check npm / GitHub for an existing package. **If you cannot search, you must not claim "uniqueness verified"** — write "unverified, recommend checking before publishing" instead.

---

## 5. Stage 3: interaction layout and config placement (must interact)

Ask, based on the plugin's actual function: "Where do you want users to operate this plugin?" — **trim the options to fit the function; never dump all six**.

| Option | Area | Suits | Real anchors (re-verify with `Slots.listSubTree`) |
|---|---|---|---|
| A Dialog | Inside the conversation flow | Quick execution, instant actions, lightweight features | In-conversation entry / tool calls / `conversation.input.dock`, `conversation.composer.dock` |
| B Sidebar | Left column | High-frequency use, multiple features, persistent state | `sidebar.panellist`, `sidebar.footer.action`, `sidebar.workspaces.session.menu.item` |
| C Settings page | Settings panel | Complex parameters, many options, long-term preferences | `settings.section` (full page), `settings.general.item` (single row), `settings.plugins.tab` |
| D Dialog + settings page | Both | Quick actions + long-term configuration | A ∪ C |
| E Sidebar + settings page | Both | Sidebar as entry, settings page for parameters | B ∪ C |
| F Custom | User-described | Special shapes (overlay, page, chat row, …) | Look up slots from the description |

Composite proposals must explain **what each area is responsible for**, for example:

- Dialog: one-sentence trigger for export, progress display
- Sidebar: export entry and recent records
- Settings page: default format, export scope, field toggles

Rules:

- The user already specified a layout → adopt it, write it into the requirement summary, **do not ask again**.
- Do not force a sidebar or settings page onto every plugin; a pure Host tool plugin may have no UI at all (say so: "no UI entry; triggered by tool/command").
- The plugin's Config (`config` in `cordis.patch.yml`) and a "settings page" are two different things: the former is Host configuration, the latter is UI. Explain the relationship clearly.
- Slot names, registration arguments and props must come from live inspection, never from memory. See `references/ui-design.md`.

---

## 6. Stage 4: requirement summary (confirmation gate)

Present it in a compact structure, then ask the user to confirm or amend:

```text
Plugin name: dsh-session-export
Main function: export selected sessions as Markdown / JSON
Modules: session selection, content options, format rendering, download
Interaction: settings page (settings.section) for selection and export; no dialog entry
Configuration: default format, default inclusions (written to config, may be empty for defaults)
UI style: minimal, follows DSH theme tokens
Data handling: read-only session logs; no writes to sessions; no network upload
Key constraints: local machine only; exported content is not written into the plugin directory
Defaults: format=Markdown; scope=current session; exclude tool results
```

If key requirements are still unclear → keep asking; do not move on to architecture.

---

## 7. Stage 5: architecture design (confirmation gate)

Analyze as needed; do not over-engineer:

- **Plugin entry points**: what the Host half does, what the Client half does; a UI-only plugin may have an empty Host implementation
- **Modules**: UI layer / business logic / configuration / data processing / utilities
- **Data flow**: where data comes from (session logs, files, network), what it passes through, where it goes, whether it is persisted
- **External dependencies**: avoid if possible; when unavoidable, state purpose and license
- **Permissions and security**: file read/write scope, network egress, whether session content is read, whether user confirmation is required
- **Error handling**: user-visible feedback on failure, degradation strategy, limits (size, count, timeout)
- **Logging**: log events and errors only, never content or credentials
- **Test plan**: what can be automated (structure, syntax, pure functions, static assertions) and what must be verified on a real machine

A simple plugin needs 3–5 files; only complex ones get split into `ui/`, `core/`, `config/`, `util/`. See `templates/project-structure.md`.

**Show the design to the user** and confirm the key decisions (module split, whether data leaves the machine, new dependencies, UI anchors). Write code only after confirmation.

---

## 8. Stage 6: implementation

Implementation discipline:

1. Create directories first, then place files by responsibility; entry files must be obvious.
2. Use **verified** APIs only. For uncertain constructs, do a minimal validation first, or mark them "unverified" and tell the user.
3. Error handling is mandatory: network failure, missing file, insufficient permission, empty data, oversized input.
4. Configuration has defaults; it must run out of the box, and invalid values fall back to defaults.
5. Key operations give user-visible feedback (success / failure / in progress).
6. Never add data collection, reporting, telemetry or auto-execution capabilities on your own.
7. No hard-coded absolute paths, usernames or secrets in code.
8. UI uses theme tokens (`--dsw-alias-*`) and locale strings; no invented colors, no hard-coded Chinese inside components.
9. Uninstall must be clean: every registration hangs off `ctx.effect` / `ctx.on` and returns a cleanup function.

File responsibilities (minimal working bundle):

| File | Responsibility |
|---|---|
| `package.json` | Package name (= plugin name), `type: module`, `exports`, `files`, `dsh.bundle.patch`, `dsh.client` |
| `cordis.patch.yml` | A single `- insert:` entry with `id` / `name` / `config`; `name` matches the package name |
| `index.js` | Host half: `export function apply(ctx, config)`; optional `inject`, `Config` |
| `client.js` | Client half: `window.__ModuleLoader__.load({ id, factory })`; `id` must equal the package name |
| `locale/en.json`, `locale/zh.json` | `meta.title` / `meta.description` (shown in the plugin manager) |
| `icon.svg` | Icon, original or licensed, ≤ 256 KiB |
| `README.md` | See stage 9 |
| `test/*.mjs` | Tests that can be automated |

Start from `templates/bundle-skeleton/` (its syntax and structure are validated against the current DSH); read the comments before renaming things.

API contracts and common pitfalls: `references/dsh-plugin-api.md`; UI anchors: `references/ui-design.md`.

---

## 9. Stage 7: testing and build

At minimum, check:

- [ ] Directory structure complete, no missing entry files
- [ ] `package.json` valid; `exports` / `files` / `dsh.bundle.patch` / `dsh.client` point at files that really exist
- [ ] `cordis.patch.yml` `id` and `name` match the package name; YAML indentation correct
- [ ] Every `.js` / `.mjs` passes a syntax check (`node --check`)
- [ ] JSON files parse; `locale` contains `meta.title` / `meta.description`
- [ ] Icon format, path and size compliant
- [ ] Main functional paths match the requirements; error branches handled
- [ ] Pure functions / UI components have runnable automated tests
- [ ] Privacy audit done (stage 8)

Run what can be run (both scripts live in this Skill's `scripts/`, invoke by absolute path):

```powershell
# Structure and config self-check (naming / patch / entry / id / JSON / locale / icon / syntax)
node "<skill>/scripts/check-project.mjs" "<project-dir>"

# Syntax fallback: ESM cannot always be validated by the script above — run these too
node --check index.js
node --check client.js

# Business tests: run directly, avoiding node --test spawn failures in restricted sandboxes
node test/client.test.mjs
```

`check-project.mjs` exit codes: `0` no failures, `1` failures present, `2` bad argument or path.
If it reports "cannot validate ESM in this environment", `vm.SourceTextModule` is unavailable (common in restricted sandboxes);
you **must** run `node --check` manually — do not treat that message as a pass.

Report results in exactly four categories; **never present unverified work as done**:

| Verdict | Meaning |
|---|---|
| Actually run and passed | The command ran and its output shows a pass (include the command) |
| Ran but failed | It ran and failed (include the error and whether it was fixed) |
| Static checks only | Only syntax / structure / JSON validation, no business logic executed |
| Not yet verified | Requires a real DSH instance (slot rendering, theme, permission prompts) |

Fix build failures from the error; if you cannot, stop and explain the cause and the steps the user must take — do not route around it and declare success.

---

## 10. Stage 8: code audit and privacy check

Three steps, none optional: **automated scan → manual audit → fix and re-scan**.

### 10.1 Automated scan

```powershell
node "<skill>/scripts/audit-scan.mjs" "<project-dir>"          # human-readable
node "<skill>/scripts/audit-scan.mjs" "<project-dir>" --json   # structured
node "<skill>/scripts/audit-scan.mjs" "<project-dir>" --strict # medium counts as failure too
```

Exit codes: `0` no high-severity findings, `1` high-severity findings present (`--strict`: medium too), `2` bad argument or path.

Coverage: private key / certificate blocks (including `.pem`/`.key`/`.p12` files), cloud and platform key prefixes,
hard-coded Bearer tokens, `secret/token/password`-style assignments, JWTs, local absolute paths, `eval`/`new Function`,
`innerHTML`, shell concatenation, outbound calls, plaintext HTTP, logging of data bodies; plus bundle structure checks
(naming rules, `dsh.bundle.patch`, Client module id matching the package name, locale metadata).

The scanner is a **screen, not a guarantee**: hits need human judgment (many are legitimate requirements), and no hit does not mean safe.
Placeholders (`<YOUR_API_KEY>`, `your-token-here`, `process.env.X`) are downgraded to notices rather than false high-severity reports.

### 10.2 Manual audit

Walk the checklist in `references/security-audit.md`, focusing on:

- Credentials: are keys / tokens / passwords / cookies / private keys present in code, config, examples, logs, README or test fixtures?
- Privacy: are chat logs, file contents or account data read, sent out, written to disk or logged?
- Network: where do requests go, is it HTTPS, can it be disabled, does failure fail silently?
- Files: is the read/write scope minimal, can it escape (`..`, absolute paths, symlinks)?
- Injection: `innerHTML`, `eval`, `new Function`, HTML concatenation, command concatenation
- Permissions: which Host services are called; does that exceed what the feature needs?
- Dependencies: are new dependencies necessary, is the license distributable, do they add install scripts?
- Release surface: `.gitignore`, example config, test fixtures, documentation screenshots, local absolute paths

### 10.3 Fix and re-scan

On finding sensitive information: delete it or replace it with a placeholder, then read it from an environment variable or a credential service, then check logs and examples, then scan again, then write it up in the report.

- If a real credential has already leaked → explicitly tell the user to revoke or rotate it.
- If it was ever written into Git history → explain that "editing the current file ≠ cleaning history", offer history-rewrite advice (`git filter-repo`, etc.) but **do not run it for them**.

### 10.4 Audit report

Generate `AUDIT.md` from `templates/audit-report-template.md` (or fold it into the delivery report). It must contain: audit scope, checked items, findings, fixed items, open items, privacy handling results, whether real credentials were found, and whether it is safe to deliver.

**The audit must produce a visible artifact** — it is not enough to run through it mentally.

---

## 11. Stage 9: documentation

Produce `README.md` (template: `templates/README-template.md`) containing at least:

Plugin name · what it does · feature list · usage · configuration · project structure · dependencies · privacy notes · security notes · development notes (build / test / key APIs)

If configuration is involved: provide an example config, secure defaults, state clearly which fields the user must fill in, and **contain no real credentials**.

For complex projects add `docs/`: directory guide, module guide, key APIs, build and test instructions. Documentation must match the implementation and must not describe features that do not exist.

---

## 12. Stage 10: GitHub release preparation (prepare only, do not execute)

Prepare: `README.md`, `LICENSE` (MIT recommended, with the copyright holder named), `.gitignore`, `.gitattributes`, example config, dependency notes, release-notes draft, audit conclusion, directory structure.

Pre-release self-check:

- [ ] Clear structure, obvious entry files
- [ ] No real credentials in config or examples
- [ ] README has verifiable install and usage instructions
- [ ] Install instructions are based on the real DSH mechanism (`dsh plugin --profile <name> add <spec>` or the plugins page)
- [ ] No local absolute paths (`C:\Users\...`, `/home/...`)
- [ ] No temp files, build artifacts, debug logs or sensitive test data
- [ ] `.gitignore` covers `node_modules`, `.env`, logs, personal config

**Not done by default**: uploading to GitHub, creating public repos, `git commit`, tagging, publishing a Release. All of these require explicit authorization. Full checklist in `references/github-release.md`.

---

## 13. Stage 11: delivery report (then stop)

Use this structure; never describe untested items as complete:

```text
### Plugin
- Name:
- Function:
- Interaction layout:

### Implementation
- Implemented:
- Not implemented:
- User must configure:

### Test results
- Actually run:
- Static checks:
- Not verified:

### Security audit
- Audit status:
- Sensitive data:
- Scrubbing applied:
- Open risks:

### Delivery
- Project directory:
- README:
- GitHub release preparation:

### Next steps
- Upload to GitHub: user's decision
- Install the plugin: user's decision
```

Deliverable: **the complete project directory** (not a snippet). When possible, show the README / audit report with `present`.

Closing line, always:

> The project has been delivered at `<path>`. I have not installed, enabled or uploaded it. You can review the code first, then decide whether to upload it to GitHub and install it from there; tell me if you want me to prepare the release flow or help with installation.

---

## 14. Installing only when the user explicitly asks

Do it only after the user says "install it and try"; and you must:

1. Check environment support (is `plugin_manager` available? is the profile writable? are version requirements met?).
2. **Explain what the install will change**: which profile, which package, whether it gets enabled, whether a restart is needed, how to uninstall.
3. After confirmation, call `plugin_manager install_bundle` (target = absolute project path) or give the `dsh plugin --profile <name> add <spec>` command.
4. Execute only the authorized step — do not also enable it, change config or upload.
5. If the environment does not support it → give manual install instructions only; do not force it.

To verify after installing: use `cordis_inspect_query` (no approval needed) to confirm the entry is active; every `plugin_manager` action requires approval, so only call it when the result determines the next step.

---

## 15. What to say when uncertain

In all of these cases you must **say so** — no guessing, no smoothing over:

- You do not understand a DSH plugin API / field semantics
- Documentation, dependencies or examples are missing
- A feature cannot be verified in the current environment
- You cannot run DSH or complete the tests
- The user's requirements conflict (e.g. "read all chat logs" + "touch no private data")
- You found a privacy risk or unsafe code

Template:

> I cannot verify this in the current environment: <specific gap>. I implemented a minimal working version based on <basis>, and documented the risk under "Known limitations" in the README. To confirm it, <specific verification steps> in a real DSH instance.

**Never fabricate**: no invented APIs, no invented test results, no invented "done".

---

## 16. Pre-delivery checklist

Tick every item; fill the gaps before delivering.

**Requirement interaction**
- [ ] If the user gave no name, at least 3 compliant candidates were offered (name / meaning / rationale / custom)
- [ ] A non-compliant user-supplied name was flagged with a correction proposal
- [ ] Unclear functions were asked about before any code was written
- [ ] Style and customization entries were offered (when UI is involved)
- [ ] Nothing the user already stated was asked again

**Layout**
- [ ] Layout options suited to the function were offered (dialog / sidebar / settings page / combination)
- [ ] Each area's responsibility was explained and key layout decisions confirmed
- [ ] No sidebar and settings page were forced onto every plugin

**Implementation**
- [ ] Based on verified DSH APIs (unverified ones marked)
- [ ] Dependencies explicit, structure sound, error handling in place
- [ ] No fabricated unverified features
- [ ] README matches the implementation

**Security**
- [ ] Automated scan + manual audit completed
- [ ] Keys / tokens / accounts / chat logs / local paths / logs / release files checked
- [ ] Sensitive information deleted, scrubbed or switched to secure reads
- [ ] Rotation advised for any leaked credential
- [ ] Audit conclusion visible

**Testing**
- [ ] Structure / config / syntax / icon checks passed
- [ ] Every runnable test was run
- [ ] Unverified items listed

**Delivery**
- [ ] Complete project + README + audit results + test results + release preparation
- [ ] Not installed, not enabled, not uploaded, not committed, not released

---

## 17. Common failure modes

| Anti-pattern | Correct approach |
|---|---|
| Writing code the moment the user says "make a plugin" | Ask about the function, then naming, then layout |
| Naming the plugin yourself and starting immediately | Offer candidates and let the user choose |
| Dumping all six layout options on a pure-tool plugin | Trim by function; offer only relevant ones |
| Writing slot names / Config fields from memory | Look them up live with `cordis_inspect_query` |
| README says "tests passed" when nothing ran | Use the four-category reporting |
| Running the audit only in your head | Produce a report file with the scan command and conclusion |
| Slipping in `install_bundle` at delivery | Delivery means stop; installation needs separate authorization |
| Putting `C:\Users\<me>\...` in the README | Use relative paths or placeholders |
| Adding telemetry/networking "for richness" | Add no unauthorized capability; ask first |
