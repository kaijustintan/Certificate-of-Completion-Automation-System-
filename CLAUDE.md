# megaworld-COC-automation — Project conventions

Google Apps Script web app (AppSheet migration). Backend: Google Sheets.
Frontend: custom SPA served via HtmlService. Managed via clasp + VS Code + GitHub.

> **Current status & roadmap:** see `reference/ROADMAP.md` — the living status doc. DONE: Categories 1–4, frontend redesign, documentation, **Phase 8** (attachment upload-before-submit + identity-gated serving + resubmit re-upload), **Phase 9** (COC PDF generation + auto-attach on full approval + `COC_PDFs` logging), the **big-bang DB normalization** (35-col monolith → 7 purpose-built sheets behind the `Accessors.js` seam), and attachment **cycle grouping (#6)**. Partial: **Phase 10** (Miga assets). Pending: contract-expiry indicator + "Expired" filter (#10), go-live gate. Admin role is DEFERRED (Admins sheet + `isAdmin()` scaffolded; no UI). Reference docs: `reference/ROADMAP.md` (status), `reference/FLOWS.md` (operation traces across files), `reference/ARCHITECTURE.md` (design), `reference/COLUMN_MAP (1).md` (columns), `reference/E-Certificate Automation Documentation.md` (AppSheet guide).

## Stack constraints — always respect these

- **One global scope.** All `.js` and `.html` files share one Apps Script runtime scope. No imports/exports. Functions defined in one file are callable from any other.
- **All server calls via `callServer(fnName, ...args)`** — the Promise wrapper in `JavaScript.html`. Never call `google.script.run` directly from pages.
- **Identity always from `Session.getActiveUser().getEmail()`** — NEVER accept an email as a parameter from the frontend. Server-side identity only.
- **All new CSS in `Stylesheet.html` using existing `:root` vars only.** No inline styles, no new color values — check `:root` first.
- **Router: `navigateTo(page, params)`** — every page change goes through this. `afterRender_<page>(params)` hooks (lowercase route key) fire after DOM is ready.
- **Role: `state.user.role`** = `"approver"` | `"requestor"`. Read from state, never re-detect in a page.

## Sheet structure (ground truth — never hardcode column numbers)

The database is **normalized into 7 sheets**. Use the column-map constants from `Constants.js` — `CR`, `ACT`, `GRP`, `GAP`, `RA`, `ADM`, `COCPDF`:

- `Requests` (`CR.*`) — 25 cols (A–Y). The core request row. Key: STATUS(3), STEP(4), GROUP(9 = a **group_id** FK → Groups, not a name), RESUBMIT_COUNT(25). ⚠️ STATUS / STEP / RESUBMIT_COUNT are a denormalized **read-cache** — the source of truth is `Activity_Log`. They're kept current only via `setRequestCache()` in `Accessors.js`.
- `Activity_Log` (`ACT.*`) — 9 cols. The **append-only** action timeline (submit / approve / decline / return / resubmit). Never updated or deleted. Replaces the old flat App1/2/3 date+remark, Previous_Approvals, Last_Action_By, Resubmit_History columns.
- `Groups` (`GRP.*`) — registry; surrogate `group_id` PK (e.g. `G001`) so a group can be renamed without breaking routing.
- `Group_Approvers` (`GAP.*`) — the normalized approver chain. Composite key (group_id, sequence). **Unlimited** approvers (no more 3-slot cap); `ACTIVE` soft-disables a slot.
- `Request_Attachments` (`RA.*`) — 8 cols. Adds RESUBMIT_CYCLE(6), UPLOADED_BY(7), UPLOADED_AT(8).
- `Admins` (`ADM.*`) — allowlist for the (deferred) admin role.
- `COC_PDFs` (`COCPDF.*`) — one row per generated certificate PDF (re-issuance capable).

> **The `CR` constant name is retained** — it historically meant "Certificate_Requests"; the sheet is now named `Requests` but the constant still means "the request row's columns." `Constants.js` constant `AS` (Approver_Settings) is **gone** — split into `GRP` + `GAP`.

> **All normalized-DB reads/writes go through `Accessors.js`** — the single seam. It preserves the legacy `getApprovers()` 6-field shape and reconstructs the old per-step/history/previousApprovals/N-of-M values from the timeline via `getApprovalView()`, so the **frontend DTO is frozen** and the UI was barely touched. Don't read `Activity_Log` / `Groups` / `Group_Approvers` directly from feature code — call the accessors.

⚠️ Two number systems:
- **1-based** → Sheet API: `sheet.getRange(row, CR.STATUS)`
- **0-based** → array index: `row[CR.STATUS - 1]`

## STATUS enum — always use `STATUS.*`, never raw strings

`PENDING_1 | PENDING_2 | PENDING_3 | APPROVED("Fully Approved") | DECLINED | RETURNED("Returned to Requestor")`

> `SYNCING` was **removed** — upload-before-submit (Phase 8) means every new request goes straight to `PENDING_1`. There is no waiting-for-files state. These exact strings are a **frozen DTO contract** (compared in filters, email subjects, frontend badges) — a raw-string typo silently breaks routing.

### `ACTION` enum — `Activity_Log.action` values

`ACTION.*` from `Constants.js`: `SUBMITTED | APPROVED | DECLINED | RETURNED | RESUBMITTED` (stored lowercase). The timeline's action drives derived status, history, who-acted, and N-of-M.

## Authorization pattern (backend)

Every sensitive callable must:
1. Resolve caller: `const caller = Session.getActiveUser().getEmail();`
2. Load the row: `const row = getRequestRowData(requestId);`
3. Guard BEFORE any sheet write: `if (!isCurrentApprover(row, caller)) return { success:false, error:"Unauthorized" };`

Auth helpers in `WebApp.js`: `normalizeEmail`, `sameEmail`, `getRequestRowData`, `isCurrentApprover`, `isChainApprover`.

### Email comparison — always `sameEmail()`, never `===`

Never use `===` to compare emails. Always use `sameEmail(a, b)` from `WebApp.js`. Two reasons:
1. Google accounts can have casing differences across sessions.
2. `sameEmail` has a non-blank guard — two empty cells must NOT be treated as the same approver. This was an explicit security consideration in the Cat 3 auth hardening.

### `getRequestDetail` return contract

`getRequestDetail()` returns `null` for BOTH "not found" AND "unauthorized caller" — NOT `{success:false}`. This is intentional: the detail renderer treats `null` as "not found/no access" and renders an empty state. Returning an object would break the renderer. This contract must not change.

## Email conventions

- Subject via `emailSubject(controlNumber, statusLabel, audience)` → `[COC Request]: <ctrl> | <Status>`
- Body: greeting → `buildInfoBlock(rowData)` → sections → `getPortalUrl(requestId, page)` deep-link
- `EMAIL_DEV_TAG = true` in `Emails.js` — **flip to `false` before production go-live**
- Deep-links use query params (`?page=review&id=XXX`), NOT hash fragments (iframe can't read hash)
- `getPortalUrl()` uses `ScriptApp.getService().getUrl()` — confirmed to return the `/exec` URL, not `/dev`

### Request-row reads now cover the whole row — history lives elsewhere

Post-normalization, both `getRequestData()` (`Emails.js`) and `getRequestRowData()` (`WebApp.js`) read `getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT)` — i.e. **all 25 cols** of the `Requests` row in one batch. There is no longer a truncated-read gotcha (the old "31 cols / 34 cols" limits are gone with the columns they referenced).

What you **cannot** get from the request row anymore — because it's no longer stored there — is approval history, per-step dates/remarks, previous-approvals, who-last-acted, and resubmit history. All of that now comes from `Activity_Log`:
```js
const view = getApprovalView(requestId); // Accessors.js — derives the old shapes from the timeline
// view.byStep, view.previousApprovals, view.priorApprovals, view.approvedCount,
// view.latestRemark, view.resubmitHistory, view.currentCycle
```
Who-last-acted = the latest `Activity_Log` row's `actor` (the old `LAST_ACTION_BY` column is gone). To record an action, append to the timeline with `appendAction(...)` — never write history back onto the request row.

## Frontend patterns

- Stat cards are **clickable filters** — `data-filter` / `data-statkey` attributes + `onclick` handlers.
- Loading overlay: `showLoading('Verb…')` before every `callServer` action; `hideLoading()` in **every** branch (success, failure, catch).
- Confirm dialogs: `await showConfirm({title, message, confirmLabel, danger})` — never `window.confirm()`.
- Two-column detail layout: `.detail-layout` grid, `.detail-main` left, `.detail-rail` right (sticky).

### `afterRender_<page>` hook casing — must match route key exactly

The hook name must use the **exact lowercase route key** from the `navigateTo` switch statement:
- ✅ `afterRender_approverDashboard`
- ✅ `afterRender_dashboard`
- ✅ `afterRender_new`
- ❌ `afterRender_ApproverDashboard` — silently never fires

This was a pre-existing bug in the original AppSheet migration. Always check the switch in `JavaScript.html` when adding a new hook.

### CSS grid/flex children and overflow

Grid and flex children need `min-width: 0` when placed inside a flex row or grid column, or long content (email addresses, long project titles) will overflow its track and cause a horizontal scrollbar. Always add `min-width: 0` to `.detail-main`, `.detail-rail`, and any new flex/grid children that may contain long text.

## Workflow-specific contracts

### `approve()` blank-slot skipping — N/M must use actions, not step

`approve()` skips blank approver slots (e.g. if only slot 1 is configured, it goes straight from PENDING_1 to APPROVED, skipping slots 2 and 3). Because of this, `step` is NOT a reliable "N of M" count. For any progress tracking in emails or UI always compute:
- **N** = `getApprovalView(requestId).approvedCount` — count of `approved` actions in the current cycle from `Activity_Log`
- **M** = count of non-null `approver1/2/3` slots from `getApprovers(groupId)`

### Resubmit history format — the `[PENDING]` contract

The `RESUBMIT_HISTORY` column is **gone**. The resubmit-history string is now **reconstructed on read** by `getApprovalView()` (`Accessors.js`) from the `returned` / `resubmitted` rows in `Activity_Log` — it's no longer a stored column. The output **string format is unchanged** (frozen DTO):
- Entries separated by `\n\n---\n\n`
- A `returned` action with no matching later `resubmitted` (cycle+1) → prefixed `[PENDING]` (the current, unconfirmed return)
- A `returned` action that *was* followed by a resubmit → labeled `Resubmit #N —`
- Only the latest return is `[PENDING]`, since a resubmit always follows older returns

Do not change this format. The frontend banner parser splits on `\n\n---\n\n` and detects `[PENDING]` to distinguish the current return from historical ones.

### Attachments — upload-before-submit (Phase 8, live) + cycle grouping (#6)

The old `EXPECTED_ATTACHMENTS` column and the `SYNCING` flow are **gone**. `submitNewRequest()` now uploads all files to Drive **first** (atomic — if any upload fails, uploaded files are trashed and no sheet row is written), then writes the request + `Request_Attachments` rows in one batch, then emails Approver 1. Files are private: never sent as a Drive URL — the UI fetches bytes through the identity-gated `downloadAttachment()`.

- Each attachment row stores its `RA.RESUBMIT_CYCLE` (0 = original submit; N = files added on Resubmit #N). `handleResubmit()` **appends** new files (prior files are kept) tagged with the next cycle.
- `getRequestDetail()` exposes `resubmitCycle` per attachment; `renderAttachmentsBlock()` groups them into **"Current submission"** (cycle === `detail.resubmitCount`) vs **"Previous versions"** (older cycles, sub-labeled Original / Resubmit #N). Never-resubmitted requests render a flat list (no headers).

## Documentation standard

Follow the format defined in the global `CLAUDE.md` → `### For technical documentation entries`.
- File headers: Layman → Technical → OUTLINE
- Function blocks: Layman → Technical → PARAMS/RETURNS → STEPS (both tracks) → EXAMPLE
- Depth scaled: one-liners get compact blocks; substantive functions get full treatment
- Layman (Tropang Ex) always FIRST

Reference files for "full treatment" examples: `backend/WebApp.js`, `backend/Approvals.js`.

## Production checklist before any deploy

- [ ] `EMAIL_DEV_TAG = false` in `backend/Emails.js`
- [ ] `clasp push` completed
- [ ] New `/exec` version **published** in Apps Script → Deploy → Manage deployments
      (`clasp push` updates `/dev` immediately but `/exec` still runs the old version until republished)
- [ ] All **7 normalized sheet tabs** exist with the exact names in `SHEET_NAMES` (`Requests`, `Activity_Log`, `Groups`, `Group_Approvers`, `Request_Attachments`, `Admins`, `COC_PDFs`) and matching headers (sheets were set up manually ✅)
- [ ] `Groups` + `Group_Approvers` seeded (each request's `Requests.group` holds a valid `group_id` FK; each group has ≥1 active approver row)

### Phase 8 — Attachments (added this session)
- [ ] `COC.ATTACHMENTS_FOLDER_ID` in `backend/Constants.js` swapped to the **Megaworld prod** supporting-docs folder
- [ ] `COC.ARCHIVE_FOLDER_ID` in `backend/Constants.js` swapped to the **Megaworld prod** COC archive folder (currently set to dev folder)
- [ ] Both Drive folders (`ATTACHMENTS_FOLDER_ID` and `ARCHIVE_FOLDER_ID`) set to **Restricted** in Drive UI — no anyone-with-link, no domain-with-link sharing (files are served exclusively through the identity-gated `downloadAttachment()` server function)
- [ ] Old test/dev supporting-doc files in the dev Drive folders **purged** — they were uploaded as `ANYONE_WITH_LINK` and are not linked to any sheet row
- [ ] (Optional, after first Megaworld-account deploy) Check Apps Script → Executions for any `"sharing could not be set"` log line — if absent, `DOMAIN_WITH_LINK` worked on the Megaworld account and files are org-confidential as intended

> Why push ≠ publish: `clasp push` syncs the code files. Email deep-links use `ScriptApp.getService().getUrl()` which returns the `/exec` URL — this points to the last *published* version. Always republish after a push for deep-links and `doGet` changes to take effect.
