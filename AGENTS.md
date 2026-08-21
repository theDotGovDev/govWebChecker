# govWebChecker

Check popular gov websites for status and speed.

## Where the project is right now

Feature `001` is built and running. The checker collects availability
measurements for 58 federal hosts on an hourly schedule in GitHub Actions and
commits the results to `data/`. Treat the stack and the record format as
decided; a change here is a change to working software, not a greenfield choice.

- **Stack**: TypeScript on Node 22, no runtime dependencies. `node --test` for
  tests, `tsc` for the build. Don't add a dependency without saying why first.
- **Code**: `src/checker` (fetching, robots, sampling), `src/politeness` (rate
  limiter, user-agent, backoff), `src/record` (types, validation, JSONL writer),
  `src/targets`, `src/site`, `src/cli`.
- **Targets**: `targets/federal.json`, 58 hosts. Adding one is a deliberate act
  (FR-001) — `refresh-targets.yml` opens a PR rather than committing.
- **Record**: monthly JSONL under `data/availability/` and `data/runs/`. It is
  append-only and it is the product, so it is committed, not ignored.
- **Workflows**: `check` (hourly collection), `ci`, `secret-scan`, `pages`,
  `refresh-targets`, `probe-data-sources`.
- **Site**: generated into `docs/` by `build-site` and deployed by `pages.yml`.
  It is a build artifact, not a checked-in directory.

`npm run verify -- data/availability/<month>.jsonl` checks the published record
against the guarantees it claims. `check.yml` runs it after every collection and
refuses to commit a record that violates them, so a failing run discards the
readings it just took. Runs fail independently, which means a broken guarantee
shows up as an elevated failure rate rather than a clean stop — collection limps
along committing whichever runs happen to pass. Treat a red `check` run as data
loss, not as a flaky job, and check the failure rate rather than whether the
most recent run was green.

The next substantial piece of work is feature `003` — a census of all US `.gov`
domains, checked in two tiers. Its spec is written
(`specs/003-dotgov-census/spec.md`) and awaiting approval; nothing is built. It
widens `001`'s scope, so it also revises `001`'s FR-001a and FR-009, which it
contradicts — do those edits in the same change, not afterwards.

Feature `002` — analysis and presentation — is still unwritten and keeps its
number. `003` skipped ahead rather than taking it, so `001`'s references to
`002` stay true.

## What the defaults below expect that this repo does not have yet

Most of the list is now in place: `ARCHITECTURE.md` exists, `node --test` is the
test framework, the pre-commit gitleaks hook and the CI secret scan are
configured, and the static site is generated and published by `pages.yml`.

Still missing — create each as part of the first change that needs it, not as a
later cleanup pass:

- `infra/` — repo settings in Terraform, applied by CI. This is also the third
  secret-scanning layer the constitution asks for (platform push protection),
  which nothing currently provides (task T049).
- A local `pre-commit install`. The config is committed but the hook is per
  machine, so a fresh checkout has only the CI layer until someone runs it.

## Spec-driven development

This project uses [Spec Kit](https://github.com/github/spec-kit). The toolchain
is installed, so use its skills — `/speckit-specify`, `/speckit-clarify`,
`/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`,
`/speckit-converge` — rather than hand-rolling the artifacts. (This version
ships them as skills with hyphens; older docs name them `/speckit.specify` with
a dot.)

`.specify/memory/constitution.md` holds the project's binding principles. Read it
before planning anything: where it is stricter than the defaults below, it wins,
and its two NON-NEGOTIABLE principles have no convenience exception.

`specs/001-record-availability/spec.md` is the spec for the work that is built.
Its open questions have been answered and 46 of its 51 tasks are done; the
remainder are listed at the end of `tasks.md`. Keep it true — when intended
behavior changes, revise the spec in the same change as the code.

The spec for `002` (analysis and presentation) has not been written yet.

## Project-specific rules

These are about the one thing this project does: sending traffic to government
websites it does not own. The constitution states them as binding principles;
this is the short version. They sit above the general defaults — where they are
stricter, they win.

- **This is measurement, not load testing.** A check produces no more traffic
  than an ordinary visitor would. Never add concurrency, retries, or request
  volume to a target beyond that, and never use this code to find a site's
  breaking point.
- **Public and unauthenticated only.** Check pages any visitor can reach. No
  logins, no forms, no endpoints behind a session, and nothing that returns
  someone's personal data.
- **Be polite by construction, not by convention.** Rate limiting, a per-host
  request floor, timeouts, and a bounded number of targets in flight belong in
  the checker itself, where they cannot be forgotten by a caller. Honor
  `robots.txt` and published API terms; prefer an official status endpoint when
  a site offers one.
- **Identify the traffic.** Send a User-Agent naming the project with a URL an
  operator can follow to see what it is and how to make it stop.
- **A failing check is data, not an incident.** Record the failure with its
  timing and move on. Don't retry hard against a site that is already
  struggling, and don't treat a slow or down government site as a bug in this
  code until the code has been ruled out.
- **Store measurements, not pages.** Persist timings, status codes, and
  metadata. Don't commit or archive fetched page bodies.
- **Re-probe only when the question needs it.** Answer from stored results where
  they exist rather than generating fresh traffic to look something up twice.
- **Checks run in GitHub Actions, never from a development sandbox.** This is the
  intended production path, and running from anywhere else produces measurements
  of that machine's network rather than of the target.

  This is not theoretical. A run from a cloud sandbox whose egress refused
  `CONNECT` returned three federal sites as `blocked` with a 403 — individually
  plausible observations that, committed, would have asserted those agencies
  refuse automated traffic. See the FR-024 note in
  `specs/001-record-availability/spec.md`.

  To exercise the checker, use `workflow_dispatch` on `check.yml` and read the
  run's output. If you must run it locally to debug, point it at local fixtures,
  and never at a real government site.

## My working defaults

The block below is a copy of `INSTRUCTIONS.md` from
[mchelen/dotfiles-ai](https://github.com/mchelen/dotfiles-ai), which is
assembled from `defaults/*.md` there. It is a snapshot: nothing updates it
automatically.

Never edit inside the markers to change behavior — the edit belongs in
`defaults/` in that repo. To refresh, replace everything from the `BEGIN` line
through the `END` line, inclusive, with a fresh copy of `INSTRUCTIONS.md`
(`./install.sh --print` from a clone gives the same text). Anything outside the
markers, including everything above, is this project's own and survives a
refresh.

<!-- BEGIN dotfiles-ai (managed block, edit in the dotfiles-ai repo) -->
# Architecture documentation

**Every project keeps an `ARCHITECTURE.md`, updated in the same change that
rewires a component.**

- Every project keeps an `ARCHITECTURE.md` at the repo root: a high-level
  description of the code — major components, how they fit together, and key
  data flows — including Mermaid diagrams for structure and flows.
- Keep it current: when a change adds, removes, or rewires a component,
  update `ARCHITECTURE.md` in the same change. If it doesn't exist yet,
  create it as part of the first substantial change.
- Stay high level: components and boundaries, not function-by-function
  detail. If the diagram needs updating for small edits, it's too detailed.

# Code style

**Match the surrounding code, make the smallest change that solves the problem,
and never add a dependency without saying why.**

- Match the existing style of the codebase over any personal or general default.
- Prefer the smallest change that solves the problem; avoid opportunistic
  refactors unless I ask.
- Don't add comments that narrate what the code does; comment only non-obvious
  constraints or reasoning.
- Don't add new dependencies for something a few lines of code can do.
  If a dependency is genuinely warranted, say so and why before adding it.

# Communication

**Lead with the answer, say so before doing something you think is a bad idea,
and disclose whatever you skipped or left failing.**

- Lead with the answer or outcome, then supporting detail.
- If something I asked for seems like a bad idea, say so before doing it —
  a one-line "heads up, X might be better because Y" is enough.
- When you're unsure about intent, ask one focused question rather than
  guessing and building the wrong thing.
- Tell me what you *didn't* do: skipped steps, failing tests, known gaps.
  Don't present partially working results as done.

# Offloading mechanical work

**Mechanical work belongs in a command, not in your context.**

When a shell
command, script, or CI job produces the same answer, run it instead of loading
the material and working it out yourself — it's cheaper, it's reproducible, and
it leaves context for the parts that actually need thought.

- **Query, don't read.** Search, filter, count, and compare with the tools built
  for it — `grep`, `jq`, `diff`, `wc` — rather than reading a large file or a
  large command output to find a small part of it.
- **Ask for the answer, not the transcript.** Prefer flags that narrow at the
  source (`--json` with a filter, `--stat`, `--name-only`, `-o`, `-q`) over
  printing everything and picking through it.
- **Make checks self-reporting.** A verification script should print a verdict —
  expected versus actual — not output for me to eyeball.
- **Batch.** Independent commands go in one call, not one round trip each.
- **If it has to hold every time, put it in CI.** A check you would otherwise
  repeat by hand every session belongs in a workflow.

Don't offload when it costs correctness:

- **Judgment doesn't offload.** Reviewing code, weighing an approach, deciding
  whether wording is right — a command can find candidates, it can't decide.
  Read the code you are reasoning about.
- **Don't write a fragile parser to avoid a short read.** If getting the script
  right is harder than reading the thing, read the thing.
- **Don't trust output you can't sanity-check.** A clever one-liner whose result
  you have no way to verify is worse than the slow, obvious path.
- **Keep the evidence that matters.** When something fails I want the actual
  failure output, not a summarized verdict.
- **Never quietly sample.** If you filtered, truncated, or checked only part of
  something, say so. A partial check reported as a complete one is worse than
  no check at all.

# Feature development workflow

**For anything bigger than an obvious fix, put something concrete in front of me
and wait for a yes before implementing.**

When I ask for a new feature or a significant change (as opposed to a bug fix,
small tweak, or something I've already specified in detail):

- Do **not** jump straight into implementation.
- First give me something concrete to react to. Pick whichever fits the task:
  - **Mockup** — an ASCII sketch, quick HTML page, or description of the UI/UX
  - **Demo / spike** — a minimal throwaway version that shows the core idea working
  - **Options** — 2–3 approaches with trade-offs and a recommendation
  - **Direction** — a short proposal: approach, affected files, data model, risks
- Wait for my confirmation or feedback before writing production code.

Skip this ceremony when:

- The change is small and unambiguous (rename, typo, obvious bug fix)
- I've explicitly said to just build it
- I've already approved a direction and this is a follow-up within it

# Git

**Nothing is committed or pushed unless I ask; finished work goes to a pull
request that merges only on green.**

- Never commit or push unless I ask (or I've clearly set up a workflow where
  it's expected). This governs *whether* to commit; the rest of this section
  governs *how* the work is carved up once I've asked.
- Commit in atomic units: one logical change each — one feature, one fix, one
  refactor, one documentation update — so every commit is independently
  revertable and describable in a single line. Don't bundle unrelated changes,
  and don't dump a whole session into one commit called "updates".
- Write the message as a conventional prefix plus an imperative summary, with
  the reasoning in the body when it isn't obvious from the diff. Prefixes:
  `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `style:`, `perf:`, `chore:`.
- Don't commit code that doesn't build, tests that fail (unless a failing test
  is deliberately the point), leftover debugging, or unrelated changes mixed
  together.
- Reshaping history on a feature branch is fine and needs no confirmation,
  before or after pushing it: squash the fixups, reorder, reword, split a "wip"
  into the commits it should have been, and force-push the result. Until it
  merges, the branch is yours. `git log origin/main..HEAD` shows what's in
  scope.
- **`main` is the line.** Never rewrite history there — no force-push, no
  rebase, no amending a merged commit — without explicit confirmation. The same
  restraint applies to any branch someone else has started work from, which is
  the reason the rule exists.
- Once work on a branch is complete and pushed, go ahead and open a pull
  request by default — no need to ask first.
- After opening a pull request, keep watching it if the tooling allows:
  respond to review comments and fix CI failures until it's merged or closed.
- Merge pull requests by default once automated checks pass and any required
  reviews are approved — no need to ask first. Don't merge over failing
  checks, missing required approvals, or unresolved discussions.
- Squash-merging a pull request is fine even though it collapses the branch:
  `main` is meant to carry one commit per change, which is the unit `revert`
  and `bisect` work on, and the commit-by-commit story stays readable in the
  pull request. That is a reason to keep the branch's story clean, not a
  reason to stop telling one — reviewers read it commit by commit.
- Never commit secrets, `.env` files, or credentials — flag it if you see
  them staged.

## Using GitHub tooling efficiently

- Ask for the smallest useful response: set `minimal_output` where the tool
  supports it, page in small batches, and use server-side filters instead
  of fetching everything and filtering after.
- Don't pull a large payload to read one field. When polling something like
  a workflow or check status, request only that status; if a response comes
  back huge anyway, save it and query the field out of the file rather than
  re-fetching.
- Prefer a scheduled re-check over tight polling loops when waiting on CI
  or a deployment.

# Project website

**Most projects get a static site — what it is, why it exists, how to use it —
with demos simulated and labeled when real ones aren't practical.**

- Most projects should have a static website (GitHub Pages or similar)
  covering: what the project is, why it exists, and how to use it.
- Show the project in action. Where real screenshots or live demos aren't
  practical, simulate them — rendered terminal sessions, mocked UI states,
  example output — and label simulated content as such.
- Include a before/after demo showing what the project actually changes:
  the same scenario with and without it, side by side.
- Give install steps for every environment where they differ (local CLI,
  cloud/web, IDE, settings-UI-only tools), not just the common case —
  and say *why* a variant differs, so the reader can generalize.
- Keep the site in the repo (e.g. a `docs/` folder) so it versions with
  the code, and update it alongside user-facing changes.
- Publish via the GitHub Actions Pages path by default: Pages source set
  to "GitHub Actions", with a workflow using `actions/configure-pages`,
  `actions/upload-pages-artifact`, and `actions/deploy-pages` — not the
  legacy deploy-from-branch mode.
- Plain static HTML/CSS is fine; don't introduce a site generator or
  framework unless the project already has one or genuinely needs it.
- Skip the site for internal scratch work, private utilities, or projects
  too small for it to add anything — and ask before publishing anything
  publicly for the first time.

# Repo configuration as code

**Repository settings live in Terraform in the repo and are applied by CI, never
clicked through the web UI.**

- GitHub repository settings are managed declaratively, not clicked through
  the web UI. Use the official Terraform GitHub provider
  (`integrations/github`) with an `import` block to adopt the existing
  repo; keep the config in `infra/` in the repo itself.
- Settings that belong in code: description/homepage, feature toggles,
  merge policy, Pages, vulnerability alerts, secret scanning + push
  protection, and branch protection rules once they exist.
- Never commit Terraform state, lock-in tokens, or `*.tfvars` — state
  stays local (or in a proper backend), auth comes from the environment
  (e.g. `GITHUB_TOKEN=$(gh auth token)`).
- Prefer applying in CI on merge to main: a workflow runs the apply using
  the stateless import-block pattern (re-adopt, reconcile, discard state).
  The built-in Actions `GITHUB_TOKEN` cannot administer repo settings, so
  use a least-privilege fine-grained PAT (Administration only, this repo
  only) stored as an Actions secret — and skip gracefully when it's absent.
- When something must change in repo settings, change the `.tf` file and
  apply — don't flip it in the UI and let the code drift. If a UI change
  already happened, reconcile the code to match (or revert) promptly.
- For org-owned repos, prefer the org's existing mechanism if one exists
  (e.g. safe-settings, an infra monorepo) over per-repo Terraform.

# Secrets and sensitive data

**Secrets are stopped by three independent layers, and a failing check is never
quietly disabled.**

- Every repo gets a pre-commit hook that scans staged changes for
  credentials, key material, and PII before they can be committed. Use
  standard tooling — the pre-commit framework with the official gitleaks
  hook (extra rules via `.gitleaks.toml` `[extend]`) — not hand-rolled
  scanners. Set it up as part of the first substantial change.
- Layer the defenses; don't rely on any single one:
  - **pre-commit** — catches secrets before they enter history
  - **CI** — a secret scanner (e.g. the gitleaks action) on every push/PR
  - **platform** — GitHub secret scanning with push protection enabled in
    repo or org settings
- Never weaken or bypass these checks (`--no-verify`, editing patterns)
  without flagging it to me explicitly first.
- A false positive gets an explicit inline allow-marker, not a disabled
  check.
- If a real secret ever reaches history — even briefly, even in a private
  repo — treat it as compromised: rotate it and say so. Deleting the file
  or force-pushing does not un-leak it.

# Specification

**For anything beyond a small change, keep a written specification in the repo,
in a standard format, and keep it true.**

The current format is
[Spec Kit](https://github.com/github/spec-kit).

- **Where it lives:** one directory per feature under `specs/`, holding
  `spec.md` (the intended behavior) and, where the tooling is in use,
  `plan.md` (technical approach) and `tasks.md` (work breakdown).
  Project-wide principles go in `.specify/memory/constitution.md`.
- **The spec is the contract.** It states what the software should do and why
  — behavior, constraints, acceptance criteria — not how the code achieves it.
  Implementation detail belongs in `plan.md`.
- **Keep it current.** When intended behavior changes, revise `spec.md` in the
  same change as the code; never leave it describing behavior that no longer
  exists. Then bring `plan.md` and `tasks.md` back in line with it. Same rule
  as `ARCHITECTURE.md`.
- **Never let them disagree silently.** If you find code that contradicts the
  spec, say so and ask which one is wrong. Don't quietly rewrite the spec to
  match whatever the code happens to do.
- **It pairs with the feature workflow.** For a significant feature the spec,
  or a draft of it, is usually the concrete thing to react to: write it, show
  me, wait for a yes before implementing. Don't chain the generation commands
  straight through to implementation unattended.
- **Tooling:** when a project already has `.specify/`, use its commands —
  `/speckit.specify`, `/speckit.clarify`, `/speckit.plan`, `/speckit.tasks`,
  `/speckit.analyze`, `/speckit.implement`, `/speckit.converge`. When it
  doesn't, ask before adding the toolchain: `specify init` reshapes the repo,
  so it isn't a unilateral call, and a hand-written `spec.md` in the same
  shape is fine on its own.

Skip all of this for small, unambiguous changes, one-off scripts, and
throwaway spikes — the same threshold as the feature workflow.

# Testing

**Start from a failing test that captures the expected behavior, then write the
code that makes it pass — and show me both runs.**

- Write tests **before** implementation by default: start from a failing test
  that captures the expected behavior, then write the code to make it pass.
- Show me the failing test run before the fix and the passing run after —
  that's the evidence the test actually exercises the change.
- When fixing a bug, first add a test that reproduces it.
- Test behavior, not implementation details; don't write tests that just
  mirror the code's internals or mock everything into meaninglessness.
- Use the project's existing test framework and conventions. If the project
  has no test setup at all, propose one before introducing it.

Skip test-first when:

- It's a throwaway spike, mockup, or exploration (per the feature workflow)
- The change isn't meaningfully testable (docs, comments, formatting, config)
- I've explicitly said to skip tests

# Tool fallbacks

**When an interactive tool looks stuck, switch to plain text rather than retrying
the thing that just broke.**

- If an interactive tool looks stuck — the same prompt keeps reappearing, a
  response never arrives, or I say I answered something you never received —
  stop using that tool and continue in plain text. Say that you're switching
  and why.
- A rejection is not always a refusal. If a tool reports that I declined but I
  say I answered, treat it as lost input rather than a decision, and re-ask in
  plain text.
- Never re-ask through a mechanism that just failed. Two failures of the same
  kind mean change approach, not retry — retrying is what turns one lost
  answer into a loop.
- Known issue behind this rule: dismissing an `AskUserQuestion` card silently
  discards typed free text, and a resolved card can keep re-rendering on
  mobile until the app restarts —
  <https://github.com/anthropics/claude-code/issues/81223>. If either happens,
  fall back to plain text and suggest restarting the app.
- This applies to any tool, not just question prompts: when something fails
  repeatedly, use the simplest thing that works — plain text, a file, a shell
  command — and tell me what you fell back to.
- When a tool failure may have destroyed something I typed, say so explicitly
  instead of quietly proceeding on a guess.

<!-- END dotfiles-ai -->
