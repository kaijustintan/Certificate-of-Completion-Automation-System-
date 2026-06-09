# megaworld-COC-automation — Project conventions

Google Apps Script web app (AppSheet migration). Backend: Google Sheets.
Frontend: custom SPA served via HtmlService. Managed via clasp + VS Code + GitHub.

> **Current status & roadmap:** see `reference/ROADMAP.md` — the living status doc. Categories 1–4 + frontend redesign + documentation are DONE. Pending: Phase 9 (COC PDF generation, Template 1), Phase 8 (attachment upload-before-submit), Phase 10 (Miga assets), go-live gate. Admin role is DEFERRED. Reference docs: `reference/ROADMAP.md` (status), `reference/FLOWS.md` (operation traces across files), `reference/ARCHITECTURE.md` (original design), `reference/COLUMN_MAP (1).md` (columns), `reference/E-Certificate Automation Documentation.md` (AppSheet guide).

## Stack constraints — always respect these

- **One global scope.** All `.js` and `.html` files share one Apps Script runtime scope. No imports/exports. Functions defined in one file are callable from any other.
- **All server calls via `callServer(fnName, ...args)`** — the Promise wrapper in `JavaScript.html`. Never call `google.script.run` directly from pages.
- **Identity always from `Session.getActiveUser().getEmail()`** — NEVER accept an email as a parameter from the frontend. Server-side identity only.
- **All new CSS in `Stylesheet.html` using existing `:root` vars only.** No inline styles, no new color values — check `:root` first.
- **Router: `navigateTo(page, params)`** — every page change goes through this. `afterRender_<page>(params)` hooks (lowercase route key) fire after DOM is ready.
- **Role: `state.user.role`** = `"approver"` | `"requestor"`. Read from state, never re-detect in a page.

## Sheet structure (ground truth — never hardcode column numbers)

Use `CR.*`, `AS.*`, `RA.*` constants from `Constants.js`:
- `Certificate_Requests` — 35 cols (A–AI). Key: STATUS(3), STEP(4), GROUP(9), LAST_ACTION_BY(35).
- `Approver_Settings` — 7 cols. Key: GROUP(1), APPROVER_1/2/3, DESIG_1/2/3.
- `Request_Attachments` — 5 cols.

⚠️ Two number systems:
- **1-based** → Sheet API: `sheet.getRange(row, CR.STATUS)`
- **0-based** → array index: `row[CR.STATUS - 1]`

## STATUS enum — always use `STATUS.*`, never raw strings

`SYNCING | PENDING_1 | PENDING_2 | PENDING_3 | APPROVED("Fully Approved") | DECLINED | RETURNED("Returned to Requestor")`

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

### `getRequestData()` column-read limit — critical email gotcha

`getRequestData()` in `Emails.js` reads only **31 cols**. PREVIOUS_APPROVALS (col 34/AH) is NOT accessible through it. If an email function needs it, take it as a parameter — as `sendReturnedChainNotification(requestId, previousApprovals, ...)` does. Never try to read col 34 through `getRequestData()`.

### `getRequestRowData()` column-read limit — auth helpers

`getRequestRowData()` in `WebApp.js` reads **34 cols** (through PREVIOUS_APPROVALS). LAST_ACTION_BY (col 35/AI) is NOT in that batch read. Stamp it directly:
```js
sheet.getRange(rowNum, CR.LAST_ACTION_BY).setValue(Session.getActiveUser().getEmail());
```

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

### `approve()` blank-slot skipping — N/M must use dates, not step

`approve()` skips blank approver slots (e.g. if only slot 1 is configured, it goes straight from PENDING_1 to APPROVED, skipping slots 2 and 3). Because of this, `step` is NOT a reliable "N of M" count. For any progress tracking in emails or UI always compute:
- **N** = count of non-empty `APP1/2/3_DATE` values in the row
- **M** = count of non-null `approver1/2/3` slots from `getApprovers()`

### Resubmit history format — the `[PENDING]` contract

`RESUBMIT_HISTORY` (col 33/AG) format:
- Entries separated by `\n\n---\n\n`
- Active/unconfirmed return: prefixed with `[PENDING]` — written by `handleReturn()` while Step still points to the returner
- Confirmed resubmit: `[PENDING]` is promoted to `Resubmit #N —` by `resubmit()`
- Only ONE active `[PENDING]` at a time — `handleReturn` replaces it if one already exists (never stacks two)

Do not change this format. The frontend banner parser splits on `\n\n---\n\n` and detects `[PENDING]` to distinguish the current return from historical ones.

### `expectedAttachments` — hardcoded to 0 (Phase 8 pending)

`expectedAttachments` is hardcoded to `0` in `submitNewRequest()`. This means all new requests skip `SYNCING` and go straight to `PENDING_1`. **Phase 8** will repurpose this column for an upload-before-submit flow. Do NOT add UI for it yet. Do NOT change the hardcode without a Phase 8 plan.

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
- [ ] Sheet column AI header `Last_Action_By` present (added manually ✅)

### Phase 8 — Attachments (added this session)
- [ ] `COC.ATTACHMENTS_FOLDER_ID` in `backend/Constants.js` swapped to the **Megaworld prod** supporting-docs folder
- [ ] `COC.ARCHIVE_FOLDER_ID` in `backend/Constants.js` swapped to the **Megaworld prod** COC archive folder (currently set to dev folder)
- [ ] Both Drive folders (`ATTACHMENTS_FOLDER_ID` and `ARCHIVE_FOLDER_ID`) set to **Restricted** in Drive UI — no anyone-with-link, no domain-with-link sharing (files are served exclusively through the identity-gated `downloadAttachment()` server function)
- [ ] Old test/dev supporting-doc files in the dev Drive folders **purged** — they were uploaded as `ANYONE_WITH_LINK` and are not linked to any sheet row
- [ ] (Optional, after first Megaworld-account deploy) Check Apps Script → Executions for any `"sharing could not be set"` log line — if absent, `DOMAIN_WITH_LINK` worked on the Megaworld account and files are org-confidential as intended

> Why push ≠ publish: `clasp push` syncs the code files. Email deep-links use `ScriptApp.getService().getUrl()` which returns the `/exec` URL — this points to the last *published* version. Always republish after a push for deep-links and `doGet` changes to take effect.
