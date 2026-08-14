# 02 · Architecture & Conventions

> These are **hard contracts**. Violating them silently breaks routing, auth, or history — often with no error. Read before editing.

## 1. The stack

- **Google Apps Script** web app served via `HtmlService` — a custom **single-page app (SPA)**, not AppSheet.
- **Backend = Google Sheets** (one workbook, 8 tabs). The Sheet **is the official record / ledger**; everything reads from or reacts to it.
- **Frontend = HTML/CSS/JS** delivered as `.html` files through `HtmlService` (`include()`-style concatenation into one `Index.html` shell).
- Managed via **clasp** (`clasp push` syncs files) + VS Code + GitHub.
- Files: 12 backend `backend/*.js` + frontend `Index.html` / `JavaScript.html` / `Stylesheet.html` + `components/*.html` + `pages/*.html`.

## 2. ONE GLOBAL SCOPE (the #1 structural fact)

All `.js` and `.html` script blocks share **one Apps Script runtime global scope**. **No imports/exports.** A function defined in any file is callable from any other file.

**Consequence:** duplicate top-level function names **collide**. When `Accessors.js` was introduced, the old copies of `getApprovers` / `getCurrentApprover` / `detectRole` / `getApproverGroups` had to be **deleted** from `Utils.js`/`WebApp.js`. Each of these now lives in **exactly one** place (`Accessors.js`). When adding a function, grep for the name first.

`.clasp.json` `filePushOrder` is the real "architecture" — it controls load order. (No folder restructuring was ever done; deep nesting buys nothing in a flat global scope. This was an explicit verdict — "the structure is already right for Apps Script.")

## 3. Frontend → server: ALWAYS via `callServer`

The browser **never** calls `google.script.run` directly. Every server call goes through **`callServer(fnName, ...args)`** — a Promise wrapper in `JavaScript.html`. Assume it sits on every frontend→server hop.

## 4. Identity: ALWAYS server-side

Caller identity is **always** `Session.getActiveUser().getEmail()` on the server. **Never** accept an email as a parameter from the frontend. This is the backbone of the auth model.

> **Cross-domain gotcha:** under "Execute as: Me", `Session.getActiveUser().getEmail()` returns `""` for users *outside* the owner's Workspace domain (the cause of the white-screen "Sign-in problem" when a non-DLSU account hit the dev deploy). The dev workaround was deploying "anyone can access"; the production fix is same-domain ownership under a Megaworld account.

## 5. The Accessors seam + the FROZEN DTO (the keystone)

**`backend/Accessors.js` is the single door to the normalized database.** After the schema normalization (35-col monolith → 8 sheets), feature code must **never** read `Activity_Log` / `Groups` / `Group_Approvers` directly — it calls accessors. The seam:

- `getApprovers(groupId)` — returns the **legacy 6-field shape** (`approver1/2/3` + `designation1/2/3`) built from the first 3 sequences, so all downstream code (chain rendering, signatories, N-of-M, `isChainApprover`) is unchanged.
- `getCurrentApprover(step, group)` — "whose turn is it" (maps PENDING_2 → approver 2, skipping blanks).
- `getApprovalActions(requestId)` — raw timeline rows.
- `getApprovalView(requestId)` — **reconstructs the old shapes from the append-only timeline**: `byStep` (per-step date/remark), `previousApprovals` (current cycle), `priorApprovals` (earlier cycles → drives the re-review note), `approvedCount` (N-of-M), `latestRemark`, and the `\n\n---\n\n`-joined `resubmitHistory` string with `[PENDING]`/`Resubmit #N` markers.
- `appendAction(requestId, groupId, cycle, step, actor, action, remark)` — **the ONLY writer of the timeline** (7 args).
- `setRequestCache(requestId, {status, step, resubmitCount})` — **the ONLY writer of the `Requests` status/step/count cache.**
- `detectRole(email)` / `isAdmin(email)`; group/chain CRUD writers (`getAllGroups`, `getGroupChain`, `createGroup`, `updateGroupFields`, `replaceGroupChain`); `appendAdminLog`; ID generators (`generateActionId/GroupId/GroupApproverId/CocId/AdminLogId`).

**The Frozen DTO contract** is the migration's safety oracle: `getRequestDetail` / `getMyRequests` / `getPendingApprovals` / `getMyActionedRequests` return the **same field shape as before normalization**. The frontend reads a fixed set of field names; every change keeps that shape **byte-identical**, so "every screen renders normally" = the change is safe. **Never rename a DTO field the frontend reads** (`status`, `step`, `approver1/2/3`, `app1/2/3Date/Remark`, `previousApprovals`, `priorApprovals`, `resubmitHistory`, etc.). Additive fields are fine.

## 6. Routing & lifecycle (frontend)

- **`navigateTo(page, params)`** — every page change goes through this. State shape: `{ user: {email, role, isAdmin}, currentPage, params }`.
- **`afterRender_<page>(params)`** hooks fire after the DOM is ready. **⚠️ The hook name must be the EXACT lowercase route key from the `navigateTo` switch.** `afterRender_approverDashboard` ✓; `afterRender_ApproverDashboard` **silently never fires**. This is a latent bug-class inherited from the AppSheet migration — always check the switch when adding a hook.
- **Deep-links use query params, NOT hash fragments.** `doGet(e)` reads `?page=&id=` → injects `template.initialPage/initialId` → `Index.html` emits `window.__INITIAL_ROUTE` → `bootstrap()` honors it (deep-link wins over saved hash wins over home). **Why query, not `#hash`:** the Apps Script SPA runs in a sandboxed iframe that **cannot read the outer URL's hash**, but `?query` reaches `doGet` server-side.

## 7. Roles

- `state.user.role` = **`"approver"` | `"requestor"`** only. Read from state; never re-detect in a page.
- `detectRole(email)` (Accessors.js): if the email is an active approver in any group → `"approver"`, else `"requestor"`. It **deliberately never returns `"admin"`**.
- **Admin is additive:** `getCurrentUser()` returns an `isAdmin` boolean (from the `Admins` allowlist sheet). An admin who is also an approver keeps `role: "approver"`. Only the Admin nav link/page and `admin*` callables are gated on `isAdmin`. **Never branch role logic on admin.**

## 8. Backend authorization pattern

Every sensitive callable must, in order:
1. Resolve caller: `const caller = Session.getActiveUser().getEmail();`
2. Load the row: `const row = getRequestRowData(requestId);`
3. **Guard BEFORE any sheet write:** `if (!isCurrentApprover(row, caller)) return { success:false, error:"Unauthorized" };`

Auth helpers (in `WebApp.js`): `normalizeEmail`, `sameEmail`, `getRequestRowData`, `isCurrentApprover`, `isChainApprover`.

- **Email comparison: ALWAYS `sameEmail(a, b)`, NEVER `===`.** Two reasons: (1) Google accounts have casing differences across sessions; (2) `sameEmail` has a **non-blank guard** so two empty cells are NOT treated as the same approver (an explicit Cat-3 security decision).
- **`getRequestDetail()` returns `null` for BOTH "not found" AND "unauthorized"** — never `{success:false}`. The detail renderer treats `null` as an empty state; returning an object breaks it. **This contract must not change.** (A blank detail page during testing is the auth gate working, not a bug.)
- Admin read access was added by extending two gates with `|| isAdmin(caller)`: `getRequestDetail` and `downloadAttachment`. Admin access is read-only by construction (action panels are owner/current-approver gated and re-verify server-side).

## 9. Frontend patterns & conventions

- **Shared SaaS primitives live in `frontend/components/UI.html`** (loaded after `MigaWidget`, before pages — it needs `migaImageFor`). Reuse these instead of hand-rolling:
  - `renderIcon(name, size)` — inline Lucide-style SVG, `currentColor`, zero network.
  - `renderHeroCard({greeting, title, subtitle, insights, emotion})` — the navy gradient hero atop each dashboard.
  - `renderStatCard(opts)` / `renderStatGrid(cards)` — icon-tile stat cards; pass `filterKey`→`data-filter` or `statKey`→`data-statkey` to keep the clickable-filter hooks.
  - `renderSearchBar({id, onInput, value, placeholder})`, `renderPagination({total, page, perPage, onPage})` + `paginate()`.
  - `friendlyName(email)` (derives a first name; `state.user` has no display name), `uiKeyActivate(event)` (Enter/Space activation for `role="button"` divs).
- **Client-side search + pagination** (Dashboard/Approver/Admin): caches are fetched **once**; the search `onInput` handler must re-render **only the list region** (`#…-list`), never the controls region holding the `<input>` (else focus drops mid-type). Filter/sort/stat changes may re-render controls and must reset the page var to 1. `filterBySearch(rows, q)` (global, in `Dashboard.html`) matches control no./project/group/requestor. **Zero new `callServer` calls** — all client-side over cached arrays.
- **Stat cards are clickable filters** (`data-filter` / `data-statkey` + onclick); the color lives in the `.stat-icon-<tone>` tile, not the number.
- **Loading overlay:** `showLoading('Verb…')` before every `callServer` action; `hideLoading()` in **every** branch (success/failure/catch). Full-screen blocking overlay on `document.body` at z-index 2500 (above the confirm modal's 2000); it survives `navigateTo()` swapping `#app` and inherently prevents double-submits.
- **Confirm dialogs:** `await showConfirm({title, message, confirmLabel, danger})` — never `window.confirm()`. Supports Escape (cancel), Enter (confirm), backdrop-click (cancel).
- **Two-column detail layout:** `.detail-layout` grid, `.detail-main` left, `.detail-rail` right (sticky).

## 10. CSS conventions

- **All new CSS in `Stylesheet.html`, using existing `:root` vars only.** No inline styles, no new hex values — check `:root` first. (There's a semantic alias layer: `--bg`, `--surface`, `--border`, `--text-primary/-secondary/-muted`, `--primary`, `--accent`, `--blue-accent` `#2563EB`, `--radius`, `--focus-ring`, `--shadow-*`, plus the navy brand palette `--navy-900` etc. and AA-verified status tints. **Gray ramp has 50/100/200/400/600/900 — no 500/700.**)
- **`min-width: 0` on every flex/grid child that may hold long text** (emails, long project titles), or it overflows its track and forces a horizontal scrollbar. Always add it to `.detail-main`, `.detail-rail`, and new flex/grid children. (This rule was born from a real rail-overflow bug — see `07`.)
- Animations are gated by `prefers-reduced-motion`.

## 11. Deploy model — `clasp push` ≠ publish

- `clasp push` updates the **`/dev`** URL immediately. Republishing is a separate step: **Apps Script editor → Deploy → Manage deployments → New version**.
- Email deep-links use `ScriptApp.getService().getUrl()`, which returns the **`/exec`** URL — that serves the **last published version**, not `/dev`. So **`doGet`/deep-link/email changes only take effect after a republish.**
- Testing loop: `clasp push` → open `/dev` → **hard refresh (Ctrl+Shift+R)** — the iframe caches aggressively; a soft refresh "will lie to you."
- `clasp` special-cases `appsscript.json` (manifest) — use **`clasp push -f`** to ensure manifest changes actually reach the server.
- **Apps Script cannot run locally / Claude cannot execute it.** Verification is always Kai's `clasp push` + browser pass. Syntax-only checks are done with `node --check` on backend files (and by extracting the `<script>` block from an `.html` file into a temp `.js` and `node --check`-ing it).

## 12. The dual email-path caveat (verify before go-live)

There are **two** code paths that can react to a status change:
1. The **`handle*` functions** (`handleApprove/Decline/Return/Resubmit` in `WebApp.js`) — run in the web-app session (they know *who* acted) and send emails directly.
2. **`onSheetChange(e)`** (`Triggers.js`) — the ported AppSheet bots; fires on raw Sheet edits and sends the matching email pair by status value.

If the installable `onSheetChange` trigger is **registered** AND a `handle*` path runs, one status change could send the **same email twice**. Crucially: **installable triggers do NOT fire on programmatic `setValue()`** — only human UI edits — so normal portal approvals don't double-send. But verify via `ScriptApp.getProjectTriggers()` whether `onSheetChange` is registered before go-live; if it is, gate one path. (Currently `onSheetChange` is dormant/unregistered; the always-on scheduled jobs are the expiry + pending-approval sweeps.)
