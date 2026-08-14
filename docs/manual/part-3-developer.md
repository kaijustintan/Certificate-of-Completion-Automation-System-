# Part 3: Developer handover 👨‍💻

> For whoever maintains this next. Read **all of [Part 0](part-0-common.md)** first, especially
> §0.6 (security), then this.
>
> `CLAUDE.md` at the repo root is the working companion to this part: it states the conventions a
> code change must not break. This part explains the shape; that file states the rules.

---

## §3.1: Repository layout

```
backend/          11 .js files, one shared global scope
frontend/         15 .html files, assembled by include() at serve time
tools/            callable-surface.js  ⚠️ Node, never pushed to Apps Script
docs/manual/      this manual
reference/        runbook, test script, audit report, as-built profile
```

| Backend file | Holds |
|---|---|
| `Constants.js` | Sheet names, column maps, enums, config resolver. **Loads first** |
| `Utils.js` | Spreadsheet access, formatting, ID generation |
| `Accessors.js` | 🚩 The database seam. Every normalized read/write |
| `Approvals.js` | The four workflow mutators |
| `WebApp.js` | `doGet`, auth helpers, the frontend-facing callables |
| `Emails.js` | Plain-text email bodies (source of truth for copy) |
| `EmailHtml.js` | Branded HTML twins of the same emails |
| `Attachments.js` | Upload, validation, identity-gated download |
| `Certificate.js` | Certificate HTML → PDF |
| `Admin.js` | Admin console callables |
| `Triggers.js` | The two scheduled jobs and their registrars |

| Frontend file | Holds |
|---|---|
| `Index.html` | The shell. `include()`s everything else. **Order matters** |
| `Stylesheet.html` | All CSS. `:root` design tokens |
| `JavaScript.html` | Router, `callServer()`, state, shared dialogs |
| `components/UI.html` | Shared primitives: icons, hero, stat cards, table, timeline, field hints |
| `components/*.html` | Navbar, StatusBadge, EmptyState, MigaWidget |
| `pages/*.html` | One file per route |

> 🚩 **`tools/callable-surface.js` must never reach Apps Script.** It uses `require()`, which
> does not exist there, so it throws at load time and takes down the entire project before any
> code runs. `.claspignore` prevents this. It has happened.

---

## §3.2: Frontend architecture

A custom SPA served by `HtmlService`. No framework, no build step.

**Routing.** Every page change goes through `navigateTo(page, params)` in `JavaScript.html`. It
resolves `home` to the right dashboard for the role, renders, syncs the URL hash, then calls
`afterRender_<page>(params)` if one exists.

> 🚩 **The `afterRender_` hook name must match the lowercase route key exactly.**
> `afterRender_approverDashboard` fires. `afterRender_ApproverDashboard` silently never does.
> This was a real bug inherited from the original migration.

**Server calls.** Always `callServer(fnName, ...args)`, the promise wrapper. Never
`google.script.run` directly from a page.

**Role.** Read `state.user.role` (`"approver"` or `"requestor"`). Never re-detect it in a page.
Admin is the additive `state.user.isAdmin` boolean; never branch role logic on it.

**Styling.** All CSS in `Stylesheet.html`, using existing `:root` variables only. No inline
styles, no new colour literals.

### Shared primitives live in `components/UI.html`

Reuse these rather than hand-rolling per page: `renderIcon`, `renderHeroCard`, `renderStatCard` /
`renderStatGrid`, `renderSearchBar`, `renderPagination` / `paginate`, `renderRequestTable`,
`renderTimeline` / `showFlagDetails`, `renderBackLink`, `FIELD_HINTS` / `renderFieldHelp`,
`friendlyName`, `uiKeyActivate`.

> ℹ️ **Callbacks are passed as global function-name strings**, not closures, because the markup is
> injected via `innerHTML` and a closure cannot survive that boundary. Same reason
> `showFlagDetails` reads its data from a global that `renderTimeline` sets.

### Two layout traps

**`min-width: 0` on grid and flex children.** Without it, a long email address or project title
overflows its track and produces a horizontal scrollbar on the whole page.

**Search must re-render only the list.** The search `oninput` handler must not re-render the
region containing the `<input>`, or focus drops on every keystroke. Filter and sort changes may
re-render controls, and must reset the page number to 1.

---

## §3.3: Backend architecture

### The Accessors seam

All normalized reads and writes go through `Accessors.js`. Feature code must not touch
`Activity_Log`, `Groups`, `Group_Approvers`, `Request_Flags` or `Locations` directly.

`getApprovalView_(requestId)` is the important one. It replays a request's timeline and returns
every shape the frontend needs: `byStep`, `previousApprovals`, `approvedCount`, `latestRemark`,
`resubmitHistory`, `currentCycle`, and `timeline`. This is what let the database be normalized
from a 35-column monolith without rewriting the UI.

### The four mutators

`approve_`, `decline_`, `returnRequest_`, `resubmit_` in `Approvals.js`. All four share a shape:

1. Take a script lock
2. Re-read state **inside** the lock
3. Self-guard on caller identity *and* on the status still being actionable
4. `appendAction_` to the timeline, then `setRequestCache_`

> 🚩 **The re-read inside the lock is what makes it a compare-and-set.** A second racing call
> sees the already-advanced status and is rejected. Without it, a double-click across two tabs
> issues two certificates.

> 🚩 **Never nest `waitLock`.** Two of these calling each other while both hold the lock would
> deadlock for the full timeout.

### Adding a backend function

Pick one, deliberately:

| Situation | Do |
|---|---|
| Internal helper (**the default**) | Name it `fnName_` |
| Genuinely called by the frontend | Bare name, and guard the body |
| Trigger handler / editor-run | Bare name, guard with `isOwnerContext_()` |

Then run `node tools/callable-surface.js`. It fails on drift from the expected 27. If you
deliberately added or removed a callable, update `EXPECTED` in the same commit.

---

## §3.4: Frozen contracts 🚩

These are depended on by code you may not be looking at. Changing one silently breaks something.

| Contract | Detail |
|---|---|
| **`STATUS` strings** | Compared in filters, email subjects, frontend badges. Use `STATUS.*`, never a literal |
| **`getRequestDetail` returns `null`** | For **both** "not found" and "unauthorized". The renderer treats `null` as an empty state; returning an object breaks it |
| **`resubmitHistory` string format** | `\n\n---\n\n` separators, `[PENDING]` marker. Parsed by the banner renderer |
| **The timeline compaction rule** | Single-entry and cycle-header behaviour is implemented in the portal and **both** email renderers. Change one, change all three |
| **`FLAGGABLE_FIELDS`** | The single source of the flaggable and editable field set. The frontend receives it as data and must never hardcode a copy |
| **Digest emails use the `Summary_` renderers** | Not the `Log_` pair. A full timeline per request inside a multi-request digest is unreadable |

---

## §3.5: Verification 👨‍💻

Apps Script has no test framework and no local runtime, so verification is layered rather than
automated.

| Layer | What it catches |
|---|---|
| `node tools/callable-surface.js` | A function accidentally becoming a public endpoint |
| Parse-check every file with Node's `vm` | Syntax errors before a push takes the project down |
| Offline harnesses against mock data | Pure logic: history projection, domain gate |
| `_testConfig()` in the editor | Config resolution and the domain allowlist state |
| `reference/TEST_SCRIPT.md` | Everything else, by hand, in one sitting |

> ⚠️ **A green checker is not a substitute for deploying.** Every check here validates the file
> on disk. Several classes of defect in Apps Script exist only at serve time or run time. Deploy
> in small increments; code that has never been served has not been tested in any meaningful
> sense.

> 🚩 **The lesson worth keeping from this project's own history:** the defects that mattered
> produced **no error message**. A config that silently allowed every domain. An audit trail
> nobody could see. A dormant duplicate email path. A text field that could execute a formula.
> Each returned a plausible, wrong result. When reviewing, ask of each defensive default *"what
> conclusion would a caller draw if this silently returned nothing?"* and prefer a loud failure
> wherever that conclusion would be wrong.

---

## §3.6: Known debt

Current as of 14 August 2026. `reference/FINAL_AUDIT_REPORT.md` is the full account.

| Item | Status |
|---|---|
| **Nothing had executed end-to-end** until the first live pass | Largest historical risk. `TEST_SCRIPT.md` is the ordered pass |
| **3-approver cap** | Real limitation, not a bug. Lifting it touches `getApprovers_`, `approve_`, `isChainApprover_` and the certificate signatory layout |
| **No per-round submission snapshot** | The request row holds current values only. History records *what changed*, not the full document as it stood when each approver signed. Surfaced by a cross-repository review; the highest-value remaining item |
| **Error envelope not normalized** | Backend returns both `{success, message}` and `{success, error}`. The UI surfaces either, so it is cosmetic, but it should be one shape |
| **Attachments are append-only** | Deliberate (Part 0 §0.6), not debt. Recorded here so it is not "fixed" |
| **Admin Tier 3** (force-approve, reassignment) | Deliberately not built (Part 2 §2.2) |

---

*← [Part 2: Administration](part-2-admin.md) · Next: [Appendices](appendices.md) →*
