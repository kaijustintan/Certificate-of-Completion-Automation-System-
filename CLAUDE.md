# megaworld-COC-automation — Project conventions

Google Apps Script web app (AppSheet migration). Backend: Google Sheets.
Frontend: custom SPA served via HtmlService. Managed via clasp + VS Code + GitHub.

> **Current status & roadmap:** see `reference/ROADMAP.md` — the living status doc. DONE: Categories 1–4, frontend redesign, documentation, **Phase 8** (attachment upload-before-submit + identity-gated serving + resubmit re-upload), **Phase 9** (COC PDF generation + auto-attach on full approval + `COC_PDFs` logging), the **big-bang DB normalization** (35-col monolith → 7 purpose-built sheets behind the `Accessors.js` seam), attachment **cycle grouping (#6)**, contract-expiry indicator + reminders (#10), daily pending-approval reminders, and the **Admin console (Tier 2)** — all-requests oversight + group/approver-chain CRUD via `backend/Admin.js` + `frontend/pages/Admin.html`. Partial: **Phase 10** (Miga assets). Pending: go-live gate. Admin Tier 3 (force-approve/reassign) is deliberately post-go-live. Reference docs: `reference/ROADMAP.md` (status), `reference/FLOWS.md` (operation traces across files), `reference/ARCHITECTURE.md` (design), `reference/COLUMN_MAP (1).md` (columns), `reference/E-Certificate Automation Documentation.md` (AppSheet guide).

## Stack constraints — always respect these

- **One global scope.** All `.js` and `.html` files share one Apps Script runtime scope. No imports/exports. Functions defined in one file are callable from any other.
- **All server calls via `callServer(fnName, ...args)`** — the Promise wrapper in `JavaScript.html`. Never call `google.script.run` directly from pages.
- **Identity always from `Session.getActiveUser().getEmail()`** — NEVER accept an email as a parameter from the frontend. Server-side identity only.
- **All new CSS in `Stylesheet.html` using existing `:root` vars only.** No inline styles, no new color values — check `:root` first.
- **Router: `navigateTo(page, params)`** — every page change goes through this. `afterRender_<page>(params)` hooks (lowercase route key) fire after DOM is ready.
- **Role: `state.user.role`** = `"approver"` | `"requestor"`. Read from state, never re-detect in a page. **Admin is NOT a role** — it's the additive `state.user.isAdmin` boolean (from `getCurrentUser()`); an admin who is also an approver keeps `role: "approver"`. Never branch role logic on admin; only gate the Admin nav link/page and admin callables.

## Sheet structure (ground truth — never hardcode column numbers)

The database is **normalized into 8 sheets**. Use the column-map constants from `Constants.js` — `CR`, `ACT`, `GRP`, `GAP`, `RA`, `ADM`, `ADL`, `COCPDF`:

- `Requests` (`CR.*`) — 25 cols (A–Y). The core request row. Key: STATUS(3), STEP(4), GROUP(9 = a **group_id** FK → Groups, not a name), RESUBMIT_COUNT(25). ⚠️ STATUS / STEP / RESUBMIT_COUNT are a denormalized **read-cache** — the source of truth is `Activity_Log`. They're kept current only via `setRequestCache()` in `Accessors.js`.
- `Activity_Log` (`ACT.*`) — 9 cols. The **append-only** action timeline (submit / approve / decline / return / resubmit). Never updated or deleted. Replaces the old flat App1/2/3 date+remark, Previous_Approvals, Last_Action_By, Resubmit_History columns.
- `Groups` (`GRP.*`) — registry; surrogate `group_id` PK (e.g. `G001`) so a group can be renamed without breaking routing.
- `Group_Approvers` (`GAP.*`) — the normalized approver chain. Composite key (group_id, sequence). **Unlimited** approvers (no more 3-slot cap); `ACTIVE` soft-disables a slot.
- `Request_Attachments` (`RA.*`) — 8 cols. Adds RESUBMIT_CYCLE(6), UPLOADED_BY(7), UPLOADED_AT(8).
- `Admins` (`ADM.*`) — allowlist for the admin role (managed by hand — no UI).
- `Admins_Log` (`ADL.*`) — 6 cols. **Append-only** audit of admin group/chain actions (`log_id | admin_email | action | target_group | details | timestamp`). Written only via `appendAdminLog()`. Separate from `Activity_Log` because admin actions are config-scoped (no `request_id`) and must not pollute `getApprovalView`.
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

> Two **system** action values also exist: `EXPIRY_WARNING | EXPIRY_NOTICE` (#10). They are idempotency flags written by `checkContractExpiries()` when a contract-expiry reminder is emailed — NOT approval events. `getApprovalView()` ignores them (it only branches on the five workflow actions), so history reconstruction is unaffected. Don't treat them as approval history.

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

### Contract expiry — indicator + daily reminders (#10)

Expiry is a **derived lens, not a stored status** — never add an `"Expired"` value to the STATUS enum. `isContractExpired(rawEnd)` (`Utils.js`) computes it live; `getMyRequests`/`getPendingApprovals`/`getMyActionedRequests`/`getRequestDetail` expose `isExpired` (+ `contractEnd`) as additive DTO fields. The UI shows a `.badge-expired` chip next to (never instead of) the status badge, plus an "Expired" dropdown filter on both dashboards.

**Scheduled reminders:** `checkContractExpiries()` (`Triggers.js`) is a daily ~8am sweep that emails the **requestor only**, for **Fully-Approved** rows, in **three stages**: **T-3 days** ("Expiring Soon"), **day-of** ("Expires Today"), and **post-expiry** ("Has Expired"). The warning + overdue stages use self-healing ranges (a skipped run catches up); day-of is exact. The post-expiry email exists because requestors rarely watch the portal, so the passive "Expired" label isn't enough — email is the real awareness channel. Idempotency is per-stage via `Activity_Log` system actions (`ACTION.EXPIRY_WARNING` / `EXPIRY_NOTICE` / `EXPIRY_OVERDUE`), not a column/sheet. ⚠️ The trigger must be registered manually **once per Google account** via `registerExpiryTrigger()` — so it must be re-run on the Megaworld account after migration (it's NOT auto-created by `clasp push`).

### Admin console (Tier 2) — oversight + group/chain CRUD

The admin side lives in **`backend/Admin.js`** (callables) + **`frontend/pages/Admin.html`** (route `admin`, hook `afterRender_admin`). Scope is **Tier 2 only**: see all requests read-only + CRUD on `Groups`/`Group_Approvers`. NO force-approve/reassign (Tier 3, post-go-live), NO admins-allowlist UI (the `Admins` sheet is managed directly — deliberate, so an admin can't mint admins).

- **Frontend is a two-tile landing** (`_adminSection` = `null` | `'records'` | `'groups'`): entering shows two `.stat-card` tiles ("View Records" / "View Groups"); each section has a "← Admin home" back link. It's an **internal section state** within the single `admin` route (no sub-routes) — `adminGoSection()` swaps `#admin-body` from the caches with no refetch. There is **no "View" dropdown** (it read as a filter); Status/Sort live only in Records.
- **Guard pattern:** every `admin*` callable starts with `adminGuard_()` (Session identity + `isAdmin()`) — list getters return `[]` on failure, mutations return `{success:false, error:"Unauthorized"}`.
- **Read access:** `getRequestDetail()` and `downloadAttachment()` gates were extended with `|| isAdmin(caller)`. Admin detail access is read-only by construction — the resubmit panel is owner-gated, approve/decline/return are current-approver-gated, and the handlers re-verify server-side.
- **New-request dropdown is approver-gated** — `getApproverGroups()` returns only groups that are `GRP.ACTIVE` **AND have ≥1 active `Group_Approvers` row**, so an empty (chain-less) group can't be picked by a requestor (would route to no one). Empty groups still appear in admin, flagged "no chain." `getAllGroups()` (admin view) is unfiltered.
- **Chain editing is in-place, position-matched** (`adminSaveChain` → `replaceGroupChain` in `Accessors.js`, under `LockService`): the k-th existing active row is **reused** for the k-th new slot (overwrite SEQUENCE/EMAIL/DESIGNATION cols 3-4-5, `GAP.ID` stays stable) — so a **reorder or email change writes ZERO new rows and ZERO tombstones**. Grow → append the surplus rows; shrink → set the leftover old rows `ACTIVE=FALSE` (the only remaining tombstone case). Server assigns sequences 1..N; client numbers never trusted. (Was whole-chain replace; switched to in-place once `Admins_Log` made the tombstone history redundant.) In the editor, removing a slot is a **soft-remove** (greyed "pending removal" with **Undo**); it only drops on Save, so a rejected save / misclick doesn't lose work.
- **Hard backend guards in `adminSaveChain`:** 1–3 slots (engine hard-capped — `approve()` only branches steps 1–3), valid + unique emails (`normalizeEmail`), and the **in-flight shrink guard**: reject if any `PENDING_*` request of the group sits at a step beyond the new length, else it vanishes from every pending list permanently (`getCurrentApprover` → null).
- **Deactivating a group is routing-safe** — `GRP.ACTIVE` only gates the new-request dropdown; chain reads ignore it, so in-flight requests keep flowing. Deliberately NOT blocked when pending requests exist.
- **Every admin mutation is audited to `Admins_Log`** (8th sheet; `ADL.*`; `appendAdminLog` in `Accessors.js`) — separate from the request-scoped `Activity_Log` (admin actions have no `request_id` and must not pollute `getApprovalView`). `ADMIN_ACTION` enum: create/rename/activate/deactivate/chain_changed; a chain change's `details` is a before→after approver diff. Logging is best-effort (try/catch — never fails the committed mutation; no-ops if the tab is missing).
- **Chain-change notification is current-approver-based, NOT membership** — `notifyChainChanges_` (`Admin.js`) emails whoever **newly becomes the current handler of an in-flight request** (∪ anyone newly in the chain): it captures each pending request's current approver BEFORE the replace and compares AFTER. This correctly fires on **reorder** (e.g. ex-Approver-2 → Approver-1 of a PENDING_1 request), replace-at-occupied-step, and fresh adds; a **designation-only edit sends nothing**. The email (`sendNewApproverNotice`) branches on the recipient's PRIOR sequence: a fresh add reads "added as approver — Your role: Approver N"; a **reorder** of an existing approver reads "you were Approver M; you are now Approver N" (subject suffix "Approver Role Changed"). It lists the requests they now hold; wrapped in try/catch. Create/rename/activate/deactivate are silent. Removed approvers are deliberately NOT emailed (supervisor decision: the approver themselves requests the move). Requestors are NOT emailed on chain changes — instead in-flight requestor emails carry `REQUESTOR_PORTAL_NOTE` ("approvers may change — check the portal for the current handler").

### Approver reminders — daily pending-approval nudge

There are **two** daily ~8am time-based triggers (no longer just one). The second, `checkPendingApprovals()` (`Triggers.js`), nudges whoever is **currently** holding up a pending request, because approvers sometimes miss the original "needs your approval" email (it gets buried). It sweeps all `PENDING_1/2/3` rows, resolves the responsible approver per row via `getCurrentApprover(step, group)`, **buckets by `normalizeEmail()`**, and sends `sendPendingApprovalReminder()` — **one digest email per approver** listing all their pending requests with `?page=review` deep-links.

⚠️ **Idempotency is the schedule itself, NOT an `Activity_Log` flag** — deliberately the opposite of the expiry sweep. A daily nudge is *meant* to repeat, so the once-a-day trigger run is the only guard; the function writes **nothing** to `Activity_Log` and adds **no `ACTION` enum value** (logging one row per pending request per day would bloat the append-only timeline). Purely additive, backend-only — no DTO/column/frontend change. ⚠️ Register manually **once per Google account** via `registerApproverReminderTrigger()` (not created by `clasp push`); it's the **3rd** per-account trigger registration alongside `registerTrigger()` and `registerExpiryTrigger()`.

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
- [ ] All **8 normalized sheet tabs** exist with the exact names in `SHEET_NAMES` (`Requests`, `Activity_Log`, `Groups`, `Group_Approvers`, `Request_Attachments`, `Admins`, `Admins_Log`, `COC_PDFs`) and matching headers (sheets are set up manually — **the `Admins_Log` tab must be created by hand**: headers `log_id | admin_email | action | target_group | details | timestamp` per `ADL`)
- [ ] `Groups` + `Group_Approvers` seeded (each request's `Requests.group` holds a valid `group_id` FK; each group has ≥1 active approver row)
- [ ] `Admins` sheet seeded on the production spreadsheet (email + `ACTIVE=TRUE` per admin) — the Admin console only appears for allowlisted accounts
- [ ] Run `registerExpiryTrigger()` **once on the Megaworld account** (daily 8am expiry-reminder sweep, #10) — triggers are per-account and are NOT created by `clasp push`
- [ ] Run `registerApproverReminderTrigger()` **once on the Megaworld account** (daily 8am pending-approval nudge — one digest per current approver) — also per-account, NOT created by `clasp push`

### Phase 8 — Attachments (added this session)
- [ ] `COC.ATTACHMENTS_FOLDER_ID` in `backend/Constants.js` swapped to the **Megaworld prod** supporting-docs folder
- [ ] `COC.ARCHIVE_FOLDER_ID` in `backend/Constants.js` swapped to the **Megaworld prod** COC archive folder (currently set to dev folder)
- [ ] Both Drive folders (`ATTACHMENTS_FOLDER_ID` and `ARCHIVE_FOLDER_ID`) set to **Restricted** in Drive UI — no anyone-with-link, no domain-with-link sharing (files are served exclusively through the identity-gated `downloadAttachment()` server function)
- [ ] Old test/dev supporting-doc files in the dev Drive folders **purged** — they were uploaded as `ANYONE_WITH_LINK` and are not linked to any sheet row
- [ ] (Optional, after first Megaworld-account deploy) Check Apps Script → Executions for any `"sharing could not be set"` log line — if absent, `DOMAIN_WITH_LINK` worked on the Megaworld account and files are org-confidential as intended

> Why push ≠ publish: `clasp push` syncs the code files. Email deep-links use `ScriptApp.getService().getUrl()` which returns the `/exec` URL — this points to the last *published* version. Always republish after a push for deep-links and `doGet` changes to take effect.
