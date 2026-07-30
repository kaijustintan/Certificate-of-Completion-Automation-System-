# GO-LIVE RUNBOOK — Megaworld COC Portal

**Purpose:** A single, self-contained checklist to take the portal from the dev (personal DLSU) account to production on a Megaworld Workspace account. Written so it can be executed **without any Claude access** — every step says what to do, where, the exact value, and how to confirm it worked.

**Doc standard:** Layman first, technical second (per project `CLAUDE.md`).

> ⚠️ **Nothing here is destructive to the current dev setup until Phase D (publish).** Phases A–C are setup and preparation on the Megaworld side. You can stop after any phase and resume later.

---

## Phase 0 — Pre-go-live hardening (review + fixes, 2026-07-29)

> A 5-lens adversarial review ran, then the fixes below were **implemented in code**. ⚠️ **They are NOT yet tested** — Apps Script can't run locally. Before go-live: `clasp push`, hard-refresh `/dev`, and run the smoke tests in Phase F plus the specific re-tests noted at the end of this section. Files touched: `Approvals.js`, `Utils.js`, `WebApp.js`, `Accessors.js`, `Certificate.js`, `EmailHtml.js`, `Triggers.js`, `Admin.js`.

### ✅ Implemented (needs your clasp push + test)
- **B1 auth-bypass** — `approve/decline/returnRequest/resubmit` now self-guard (identity + status) so a direct `google.script.run` call can't bypass the wrapper; `createGroup/updateGroupFields/replaceGroupChain` now require `isAdmin`; `generateCOC` now requires chain-approver-or-admin + status APPROVED. *(Residual, accepted: the low-level writers `setRequestCache`/`appendAction` remain technically callable — a much deeper, less useful attack with a full audit trail. Fully sandboxing them needs a single-dispatch redesign; deferred.)*
- **B2 terminal re-entry** — the status guard in the mutators blocks re-approving/returning a Declined (or Approved) request.
- **B3 Request ID** — `generateRequestId()` now returns a full unique `REQ-<uuid>` (was 3 chars); `submitNewRequest` regenerates until unique; control number keeps its `EC-YYYY-NNNNN-XXX` look via a short display suffix off the unique ID. *(Still format the ID column Plain Text in Phase C as belt-and-suspenders; the `REQ-` prefix already prevents numeric coercion.)*
- **B4 locking** — `LockService` compare-and-set on all four mutators (no more double-COC / double-email on a two-tab double-click). Control-number race downgraded to cosmetic (unique suffix).
- **T5 gapped chain** — `approve()` derives the next step from the next pending status, not `step+1`.
- **T6 orphan submit** — `submitNewRequest` rejects a group with no active approver chain.
- **T7 email failures** — `sendBrandedEmail` swallows+logs send errors so a Gmail hiccup never rolls back a committed action or blocks the COC.
- **T8 partial write** — submit now rolls back BOTH the Drive files and the request row on a mid-write failure.
- **T9 (partial)** — `registerTrigger()` now throws a clear "do not run" error; `Admins_Log` self-heals (auto-creates the tab) so the audit can't silently vanish.
- **Tier-3 cheap wins** — `generateCOC` makeCopy moved inside its try; `createGroup` locked; `notifyChainChanges_` isolates each recipient send.

### ⏳ Deferred (documented, not done tonight — decide later)
- **T9 Script Properties** for the folder IDs + `EMAIL_DEV_TAG` — deliberately NOT done: it trades a documented one-time manual swap (Phase D) for an untestable init-time dependency right before go-live. Do it later with testing if you want per-deployment config.
- **Shrink-guard TOCTOU**, a `rebuildCacheFromTimeline()` reconciler, mandatory server-side decline/return reason, and the "newly-added approver sees historical requests" access question — all low-frequency / policy calls left as notes.

### 🔴 Re-test these specifically after `clasp push`
1. Normal full approval still generates the COC + emails once (B1/B4 didn't break the happy path).
2. A single-approver group and a 2-approver group both route correctly (T5 step mapping).
3. Decline a request → you can NOT re-approve it (B2).
4. Submit still works end-to-end and the new `REQ-...` IDs appear in the sheet + deep-links (B3).
5. `_testGenerateCOC` still works from the editor (your DLSU email is a G001 approver, so the new guard passes).

### Tier 1 — go-live blockers (real, meaningful)
- [ ] **B1. Auth guards are bypassable.** The workflow mutators (`approve/decline/returnRequest/resubmit` in `Approvals.js`) and the admin write-primitives (`replaceGroupChain/createGroup/updateGroupFields` in `Accessors.js`) + `generateCOC` carry NO auth of their own — the guards live only in the `handle*`/`admin*` wrappers. In Apps Script, `google.script.run` can call ANY global directly, around the wrappers. → Any authenticated Megaworld user could self-approve their own request or make themselves a group's sole approver (logged under their real email, but still). **Fix:** fold an identity + actionable-status guard INTO each workflow mutator; add `isAdmin()` guards into the admin write-primitives; guard `generateCOC` on `isChainApprover || isAdmin` + `status===APPROVED`.
- [ ] **B2. Declined requests can be re-opened.** `decline()` sets status Declined but never resets `step`, so the decliner is still "current approver" → they can re-Approve/Return a terminal request through the normal button. **Fix:** reject in the handlers unless status ∈ {PENDING_1/2/3}; have `decline()` also move step out of range. (Closed by the B1 status-guard.)
- [ ] **B3. Request ID is only 3 characters** (`generateRequestId`, `Utils.js:290`) — 4096 values, no uniqueness check. Collisions start ~request #75; colliding requests share attachments + approval history and the second becomes unroutable. Also numeric-looking IDs (`"1E3"`, `"071"`) get mangled by Sheets on write. **Fix:** use the full UUID (or an `EC-`/`REQ-`-prefixed long slice), format the ID column Plain Text, regenerate-until-unique.
- [ ] **B4. No locking on the workflow mutators + control-number race.** Two tabs / double-click on final approve → duplicate COC PDF + double requestor email + inflated N-of-M. Concurrent submits → duplicate control number (`getLastRow()` race, `Utils.js:322`). **Fix:** `LockService.getScriptLock()` around submit + each mutator with a re-read-status-inside-lock (compare-and-set); derive control-number sequence from max+1 inside the lock.

### Tier 2 — should-fix (lower frequency / config-gated)
- [ ] **T5. Gapped-chain orphan.** `approve()` sets `newStep = step+1` unconditionally but skips blank slots for status → a chain with slot 2 disabled routes to PENDING_3 at step 2 → orphan. **Fix:** derive next step from the next non-blank sequence.
- [ ] **T6. Submit with a chain-less group orphans silently.** `submitNewRequest` trusts `formData.group` blindly. **Fix:** reject if `getApprovers(group)` is null/inactive.
- [ ] **T7. Unguarded email sends mask committed state.** A throwing send (Gmail quota/transient) after the state is committed aborts siblings → COC never generated + user told "failed" → may resubmit → duplicate. **Fix:** a `safeSend_` per-send try/catch.
- [ ] **T8. Partial-write orphan on submit.** Upload rollback closes before the sheet writes (`WebApp.js:687`); a mid-write failure leaves a request with 0 attachment rows + orphaned Drive files. **Fix:** widen rollback scope over the sheet writes.
- [ ] **T9. Config via Script Properties, not source edits.** Move `COC.*` folder IDs + `EMAIL_DEV_TAG` into `PropertiesService` so prod/dev differ by deployment, not a forgettable source edit. Rename/guard `registerTrigger()` so it can't be run by mistake (it double-sends every email). Add `ensureAdminsLogTab()` so the audit sheet can't be silently missing.

### Tier 3 — hardening (low)
Shrink-guard TOCTOU (re-validate inside the lock), a `rebuildCacheFromTimeline()` reconciler, per-recipient try/catch in `notifyChainChanges_`, lock on `createGroup`, expiry flag-before-send, server-side non-blank remark check, move `makeCopy` inside `generateCOC`'s try, decide whether newly-added approvers should see historical requests.

---

## Phase A — Readiness check (do this FIRST, ~10 minutes, no code)

You answered "not sure if prod is ready." Confirm these exist before doing anything else. If any is missing, that's your blocker to resolve first.

- [ ] **A Megaworld Workspace account** you can log into and that is allowed to own Apps Script projects + Google Sheets. (Layman: the company Google account this will run under, instead of your DLSU one.)
- [ ] **The production Google Spreadsheet** — either the real Megaworld COC workbook, or a copy you'll make. It must end up with **8 tabs** (Phase C).
- [ ] **The COC template Google Doc** — the certificate layout with `{{tokens}}` / `<<...>>` placeholders. The prod account must be able to **read** it. (Current dev ID in `Constants.js`: `COC.TEMPLATE_DOC_ID`.)
- [ ] **Two Drive folders** owned by / writable by the prod account: one for archived COC PDFs, one for supporting-document uploads.
  - Known Megaworld COC archive folder from the old AppSheet system: `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y` (confirm the prod account can write to it).
- [ ] **Decide the ownership model** (see Phase B).

**Open question to resolve with your supervisor (needed for Phase C):** the real Megaworld property names for the Location dropdown (currently placeholders `AGT / GCP / EGP / TWS - Pending` in `frontend/pages/NewRequest.html`).

---

## Phase B — The account / ownership decision (the biggest structural choice)

The Apps Script project and the bound Sheet currently live under your **DLSU** account (`.clasp.json scriptId = 1T4UkBz1...`). Production must run under **Megaworld**. Two ways to get there:

| Option | What you do | Trade-off |
|---|---|---|
| **B1 — Transfer ownership** | Transfer the existing Sheet + Apps Script project to the Megaworld account (Drive → Share → change owner). | Keeps the same scriptId, history, deployment. Simplest IF Megaworld Drive allows ownership transfer from an external DLSU account (often blocked across orgs). |
| **B2 — Fresh project on Megaworld (recommended if transfer is blocked)** | Log into Apps Script as Megaworld → create a new project bound to the prod Sheet → `clasp clone`/set the new scriptId in `.clasp.json` → `clasp push` all files. | Clean org-owned project. You re-do the deployment + trigger registration on the new account. This is the likely path since cross-org transfers are usually disabled. |

> **Why this matters for security:** identity (`Session.getActiveUser().getEmail()`) only returns a real email for users **inside the owner's Workspace domain**. Running under Megaworld is what makes every Megaworld employee's identity resolve correctly (and is why the dev "anyone can access" workaround must be removed).

**Recommendation:** try B1; if Megaworld's admin blocks external-owner transfer, fall back to B2. Either way, the code is identical — only `.clasp.json scriptId` and where you push differ.

---

## Phase C — Backend (Sheets + Drive) setup on the prod account

### C1. Create the 8 sheet tabs — exact names, exact headers
The code reads these by name (`SHEET_NAMES` in `backend/Constants.js`). Names must match **exactly**.

- [ ] `Requests` — 25 cols (A–Y) per `CR` in Constants.js
- [ ] `Activity_Log` — 9 cols: `action_id | request_id | group_id | resubmit_cycle | approver_step | actor_email | action | remark | timestamp`
- [ ] `Groups` — 4 cols: `group_id | group_name | active | created_at`
- [ ] `Group_Approvers` — 6 cols: `id | group_id | sequence | approver_email | designation | active`
- [ ] `Request_Attachments` — 8 cols: `Attachment ID | Request ID | File | File_Link | Description | resubmit_cycle | uploaded_by | uploaded_at`
- [ ] `Admins` — 3 cols: `email | active | added_at`
- [ ] `Admins_Log` — 6 cols: `log_id | admin_email | action | target_group | details | timestamp` ← **easy to forget; `appendAdminLog` silently no-ops if this tab is missing**
- [ ] `COC_PDFs` — 6 cols: `coc_id | request_id | control_number | pdf_link | drive_file_id | generated_at`

- [ ] Format the **Request ID** and **Control Number** columns as **Plain Text** (Format → Number → Plain text) — otherwise Apps Script reads numeric-looking IDs as numbers and comparisons break.

### C2. Seed the data
- [ ] `Groups`: one row per approver group (real Megaworld groups), each with a `group_id` (e.g. `G001`), `active = TRUE`.
- [ ] `Group_Approvers`: for each group, ≥1 row with `sequence` 1..N, real `approver_email`, `designation`, `active = TRUE`. (A group with no active approver row can't be picked in the new-request form.)
- [ ] `Admins`: one row per admin, `email` + `active = TRUE`. **The Admin console only appears for emails on this list.** Managed by hand on purpose (no UI to add admins).

### C3. Drive folders
- [ ] Set `COC.ARCHIVE_FOLDER_ID` (COC PDFs) and `COC.ATTACHMENTS_FOLDER_ID` (supporting docs) to the prod folder IDs (Phase E does the code edit).
- [ ] Set **both** folders to **Restricted** in Drive (Share → General access → Restricted). No "anyone with link," no "domain with link." Files are served only through the identity-gated `downloadAttachment()`.
- [ ] Confirm the prod (executing) account can **read** the template Doc and **write** both folders.
- [ ] Purge any old dev test files that were shared `ANYONE_WITH_LINK`.

---

## Phase D — Code config flips (edit, then push, then publish)

### D1. Edit `backend/Constants.js`
- [ ] `COC.TEMPLATE_DOC_ID` → prod template Doc ID (44 chars — a double-length paste throws a misleading "Unexpected error" — check the length).
- [ ] `COC.ARCHIVE_FOLDER_ID` → prod COC-PDF folder.
- [ ] `COC.ATTACHMENTS_FOLDER_ID` → prod supporting-docs folder.

### D2. Edit `backend/Emails.js`
- [ ] `EMAIL_DEV_TAG = false` (line ~72). Removes the `[FOR APPROVER]` / `[FOR REQUESTOR]` subject tags you used for solo testing.

### D3. (Optional) `frontend/pages/NewRequest.html`
- [ ] Replace the Location dropdown placeholders (`AGT / GCP / EGP / TWS - Pending`) with the real Megaworld property names once your supervisor gives them. Not a blocker — free-text "Other" still works.

### D4. Push + publish
- [ ] `clasp push` (use `clasp push -f` since `appsscript.json` is touched by clasp specially).
- [ ] In the Apps Script editor: **Deploy → Manage deployments → Edit → New version → Deploy.** This is what updates the `/exec` URL. **`clasp push` alone does NOT update `/exec`** — email deep-links point at `/exec` (the last *published* version), so skipping this means links serve stale code.
- [ ] Deployment setting: **Execute as: Me** (the Megaworld owner), **Who has access: Anyone within [Megaworld domain]** (NOT "anyone," NOT "execute as user" — execute-as-user would force sharing the backend Sheet with every user and break the auth model).

---

## Phase E — Triggers (per-account; NOT created by `clasp push`)

Time-based triggers are per-Google-account and must be registered **once** by running the function in the Apps Script editor on the **Megaworld** account.

- [ ] Run `registerExpiryTrigger()` once → daily ~8am contract-expiry reminder sweep (#10).
- [ ] Run `registerApproverReminderTrigger()` once → daily ~8am pending-approval digest to current approvers.
- [ ] **Do NOT** run `registerTrigger()` (the legacy `onSheetChange`) unless you deliberately want the AppSheet-bot email path. It's currently dormant on purpose — leaving it off avoids any double-send with the portal's own emails. (If you ever do register it, verify the double-send handling first.)
- [ ] Confirm registration: Apps Script editor → Triggers (clock icon) → you should see exactly the two daily jobs.

---

## Phase F — Post-deploy smoke test (on the prod account, real accounts)

Run one real request end-to-end before announcing it:

- [ ] File a request as a test requestor with ≥1 attachment → Approver 1 gets an email (no `[FOR ...]` tag), deep-link opens the review page.
- [ ] Approve through the full chain → requestor gets the success email **with the COC PDF attached**; a new row appears in `COC_PDFs`; the PDF renders correctly (no raw `<<...>>` / `{{...}}` tokens).
- [ ] Open an attachment via the in-portal **View** button → it serves; confirm the file has **no** shareable Drive link.
- [ ] Return a request → requestor return email; resubmit → Approver 1 email carries the prior return reason.
- [ ] Log in as an admin email → Admin console appears; as a non-admin → it does not.
- [ ] Confirm the sender on all emails is the **Megaworld** account, not your DLSU account.

---

## Quick reference — the 3 things most often forgotten
1. **Publish a new `/exec` version** after `clasp push` (deep-links break otherwise).
2. **Create the `Admins_Log` tab by hand** (audit silently no-ops without it).
3. **Run the two `register*Trigger()` functions** on the Megaworld account (reminders won't fire otherwise).

---

*Generated as a pre-go-live handoff. The remaining non-go-live item is Phase 12 (final Miga mascot art — a pure image re-encode, no code). Deferred post-go-live options: Admin Tier 3, a read-only Activity Timeline UI.*
