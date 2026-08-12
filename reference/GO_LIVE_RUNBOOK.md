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
6. **Resubmit with new files** — the write ordering changed (state flips before attachment rows are written), so confirm files still attach and land under the right cycle.
7. **Submit still works end-to-end** — the write sequence inside `submitNewRequest` was reordered.

### 🔴 Also re-test (config + expiry work, 2026-07-30)
8. **Config fallback:** with **no** Script Properties set, run `_testConfig` → every value tagged `[fallback(Constants.js)]`, `EMAIL_DEV_TAG = true`, and a final `fail-loud OK →` line. Then run `_testGenerateCOC` and submit a request with an attachment — the PDF and the file must land in the **same dev folders as before**. This proves the migration changed nothing on dev.
9. **Config override:** add Script Property `EMAIL_DEV_TAG` = `false` → approve something → subject has **no** `[FOR …]` prefix. Delete the property → the tag returns.
10. **Expiry sweep parity:** run `checkContractExpiries()` twice **before** pushing and note that the second run logs all zeros. After pushing, run again → must still log all zeros and send nothing.
11. **Expiry send path:** set one approved request's `CONTRACT_END` (col V) to today+2, delete its `expiry_warning` row from `Activity_Log`, run → exactly **1** email + 1 new row; run again → 0.
12. **⚠️ The duplicate-ID test (the one that catches a subtly wrong implementation):** duplicate a `Requests` row so **two rows share the same `request_id`**, both with `CONTRACT_END` = today+2, and delete their `expiry_warning` rows. Run once → must send **1 email, not 2** (log should read `1 warning(s)`). Delete the duplicate row afterward and restore any edited `CONTRACT_END` values.

### 🔴 Also re-test (callable-surface hardening, 2026-08-11)

> A full audit found that **118 of 140 backend functions were callable from any user's browser console** via `google.script.run`, while the frontend only calls **19**. Of the rest, 37 had a side effect or returned other users' data with no guard. The sweep renamed internal functions to a trailing `_` (which Apps Script hides from `google.script.run` while keeping them callable server-side) and guarded the entry points that cannot take an underscore. **Callable surface is now 31 names.** Nothing in the frontend changed — verified zero frontend references to every renamed function.

**Regression tests — these prove the renames did not sever a live call path:**
13. **Full happy path:** submit with ≥1 attachment → Approver 1 email → approve through the whole chain → COC generates **once**, requestor email arrives **once** with the PDF, one new `COC_PDFs` row.
14. **Decline** and **Return → resubmit with new files** both work; resubmitted files land under the right cycle.
15. **Admin console:** create group, rename, save a chain (reorder + add + remove), deactivate. Confirm rows appear in `Admins_Log` (this exercises `appendAdminLog_`, `replaceGroupChain_`, and the chain-change notification).
16. **Attachment view** still serves the file in-portal.
17. Editor: `_testConfig` and `_testGenerateCOC` still run. `checkContractExpiries()` and `checkPendingApprovals()` still run **from the editor**.

**Security tests — paste in the browser console while signed in to the portal.** Each must now fail with *"is not a function"*:
```
google.script.run.setRequestCache("REQ-anything", {status:"Fully Approved"})
google.script.run.getAllData("Admins")
google.script.run.sendBrandedEmail("you@example.com","x","y","z")
google.script.run.appendAction("REQ-x","G001",0,1,"boss@corp.com","approved","")
google.script.run.uploadAttachmentFile({base64:"",filename:"x",mimeType:"text/plain"},"x")
```
18. Also confirm `checkPendingApprovals()` called from the **console** does nothing (logs "refused"), while the same call from the **editor** works. That is `isOwnerContext_()` doing its job.

### 🔴 New validation behaviour to sanity-check
19. Submit with a >200-char project title → rejected with a clear message (previously accepted an unbounded value straight into the sheet).
20. Decline/return with a >2000-char remark → rejected.
21. Submit with contract end **earlier than** contract start → rejected. (Previously accepted, and the row was born expired, immediately tripping the expiry sweep.)

### 🔴 Also re-test (admin-key regression + hardening batch, 2026-08-11)

> A full read-through for the cross-repo system profile found that the callable-surface sweep had also renamed the **DTO property key** `isAdmin` → `isAdmin_` in `getCurrentUser()`, while the frontend still read `state.user.isAdmin`. The Admin console was therefore unreachable for every user, including real admins, for the entire life of commit `bf20b31`. Fixed, together with three gaps a DCS cross-repo review surfaced. **Static checks already passed**: 152 defined / 113 hidden / 0 unresolved, callable surface unchanged at 39, no property key ends in `_`, and the magic-byte logic was unit-tested against real file headers.

**Do these FIRST, before items 13-21 — item 22 is a two-second check that gates the whole admin section.**

22. **Admin link is back.** Sign in as an account listed in the `Admins` sheet → the **Admin** link appears in the sidebar, and both tiles (View Records / View Groups) load. Sign in as a non-admin → the link is still absent. *(This is the regression fix; if it fails, nothing else in the admin section is testable.)*
23. **Decline/return reasons are mandatory.** Open a pending request as its current approver → Decline. Empty box: Confirm stays disabled. Type 9 characters: still disabled, counter reads `9 / 20 characters minimum`. Type 20+: enables, submits, and the reason appears in the requestor's email and on the detail page. Repeat for Return.
24. **Upload type validation.** ⚠️ *Both halves matter and they test different things.*
    - a. Try to attach a `.txt` or `.zip` in the file picker → skipped with a red toast. **This is only the client-side convenience check.**
    - b. **Rename a `.txt` file to `PO.pdf` and attach it** → the picker accepts it, but submit is rejected server-side with *"PO.pdf does not appear to be a valid PDF file."* **This is the actual control.** If (a) passes and (b) does not, the validation is worthless.
    - c. Attach a real `.docx` and a real `.png` → both accepted.
    - d. Repeat (b) on the **resubmit** picker in `RequestDetail`, which shares the same handler.
25. **Group-lookup cache invalidation.** In Admin → View Groups, open a chain with 2+ approvers, **reorder** it, Save. The editor must redraw showing the **new** order immediately (a stale order means an `invalidateGroupCaches_()` call was missed). Confirm an `Admins_Log` row was written and the newly-current approver got the "Approver Role Changed" email. Then load both dashboards and confirm group names and pending lists are still correct.

### 🔴 Also re-test (unified approval timeline, 2026-08-11)

> Every audience previously saw a different fragment of a request's history: the requestor saw
> **returns only and never any approval**, the approver saw the current cycle plus a note about their
> own prior approval, and emails showed the current cycle only. All three now render one unified
> timeline of every action across every cycle, from the same `Activity_Log` data.
>
> **Static checks already passed**: callable surface unchanged at 31 (list byte-identical to HEAD),
> and 18 logic assertions run locally against a mock multi-cycle log, including the `EXPIRY_*` filter,
> the frozen `resubmitHistory` format, and HTML escaping.

**⚠️ SEED DATA FIRST — the feature is invisible without it.** Build ONE request that goes:
submit → approve as App1 → **return** as App2 → resubmit → **return** as App1 → resubmit → approve
through to Fully Approved. That single request exercises every branch below.

26. **Requestor view.** Open that request as the requestor. The Request History card lists **all**
    actions in order, grouped `Original submission` / `Resubmit #1` / `Resubmit #2`, each with actor,
    timestamp, and the return reasons. ⚠️ Confirm the **approvals are visible** — that is the whole
    point, the requestor could never see them before.
27. **Approver view.** Open the same request as an approver. The Request History card is
    **identical** to what the requestor sees. This symmetry is the feature.
28. **Clean request.** Open a request that was never returned. Timeline shows `Submitted` plus each
    approval under a single `Original submission` heading, with no `Resubmit` groups.
29. **⚠️ THE HIGHEST-VALUE TEST — expiry actions must not leak.** Take a Fully-Approved request that
    has an `expiry_warning` / `expiry_notice` / `expiry_overdue` row in `Activity_Log` (or run
    `checkContractExpiries()` from the editor to create one). Open its detail page and check any
    email it generates. **No `expiry_*` entry and no `system` actor may appear anywhere in the
    timeline.** If one does, the allowlist in `getApprovalView_` was broken.
30. **Emails carry it.** Approve/return/decline and confirm the "Request History" section appears in
    the resulting mail, matching the portal. Check both the HTML and the plain-text fallback.
31. **⚠️ Digests must NOT carry it.** Run `checkPendingApprovals()` from the editor with several
    pending requests. Each request keeps a **compact** "Approval Progress" block, not a full
    timeline. A digest with a timeline per request is the regression to watch for.
32. **Expiry reminder email** still has **no** history section (deliberately excluded, it is a
    contract-renewal nudge rather than an approval-state email).
33. **Resubmit banner still works.** The amber "returned for revision" banner and its collapsible
    previous-return history render as before. Its `[PENDING]` / `\n\n---\n\n` parser was deliberately
    left untouched.
34. **Cache invalidation.** Approve a request, then immediately open its detail page. The new
    approval appears in the timeline. This proves `appendAction_` invalidates the `Activity_Log` memo
    within the same execution.
35. **Mobile.** On a phone viewport the timeline wraps (long approver emails, long return reasons)
    and does not force the page to scroll sideways.

### ⚠️ Two things this sweep deliberately did NOT change
- **`include()` stays callable.** It is invoked from `Index.html` scriptlets; if underscore-hiding broke scriptlet resolution, no page would render at all. Too much blast radius for a Low finding that cannot be verified locally. Revisit with a live `/dev` to test against.
- **`ORG.ALLOWED_DOMAINS` still ships as `[]` (allow-all).** Correct for dev, wrong for production — see Phase D1b. `_testConfig` now prints a loud warning while it is empty.

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
Shrink-guard TOCTOU (re-validate inside the lock), a `rebuildCacheFromTimeline()` reconciler, per-recipient try/catch in `notifyChainChanges_`, lock on `createGroup`, expiry flag-before-send, ~~server-side non-blank remark check~~ (**done 2026-08-11**, see items 22-25 below), move `makeCopy` inside `generateCOC`'s try, decide whether newly-added approvers should see historical requests.

---

## Phase A — Readiness check (do this FIRST, ~10 minutes, no code)

You answered "not sure if prod is ready." Confirm these exist before doing anything else. If any is missing, that's your blocker to resolve first.

- [ ] **A Megaworld Workspace account** you can log into and that is allowed to own Apps Script projects + Google Sheets. (Layman: the company Google account this will run under, instead of your DLSU one.)
- [ ] **The production Google Spreadsheet** — either the real Megaworld COC workbook, or a copy you'll make. It must end up with **8 tabs** (Phase C).
- [x] ~~**The COC template Google Doc**~~ — **NO LONGER NEEDED (2026-08-11).** The certificate is now rendered directly in code by `buildCertificateHtml_` (`Certificate.js`), so there is no template Doc to share, copy, or grant the prod account access to. Skip this item entirely. If a `TEMPLATE_DOC_ID` Script Property exists on any deployment, delete it: it is ignored, and leaving it there reads as live config.
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

## Phase D — Config (Script Properties, then push, then publish)

### D1. Set the four Script Properties ⭐ PREFERRED (no code edit needed)
Apps Script editor → **Project Settings** (gear icon) → **Script Properties** → *Add script property*. Exactly four:

| Key | Value | If you forget it |
|---|---|---|
| ~~`TEMPLATE_DOC_ID`~~ | **REMOVED 2026-08-11.** Do not set it. The Doc-template engine is gone; `buildCertificateHtml_` renders the certificate in code. | n/a — the key is no longer read by anything |
| `ARCHIVE_FOLDER_ID` | prod COC-PDF archive folder ID | same |
| `ATTACHMENTS_FOLDER_ID` | prod supporting-docs folder ID | same |
| `EMAIL_DEV_TAG` | `false` | Defaults to **`true`** (dev-tagged) on purpose — a forgotten property can never silently send production-looking mail |

**How resolution works:** Script Property → the `Constants.js` literal as fallback → a named error if neither exists. So the app keeps working on dev with zero properties set, and **deleting all four properties is a complete rollback** to the source literals.

⚠️ **Three things about Script Properties that will bite you:**
1. They are **not** pushed by `clasp` and are **not** in git. If go-live takes the Phase B2 path (a fresh project on the Megaworld account), they must be re-entered **by hand** there.
2. They are **project-scoped, not deployment-scoped** — `/dev` and `/exec` of the same project share one property store.
3. Values are trimmed on read, so a trailing space from a paste is harmless.

Verify with: Run **`_testConfig`** in the editor. It logs each resolved value tagged `[PROPERTY]` or `[fallback(Constants.js)]`, the `EMAIL_DEV_TAG` state, and proves the fail-loud path.

### D1-alt. (Fallback path) Edit `backend/Constants.js` directly
Still supported if you would rather not use properties — the literals are the fallback source:
- [x] ~~`COC.TEMPLATE_DOC_ID` → prod template Doc ID~~ — **removed from `Constants.js` 2026-08-11**, nothing to swap
- [ ] `COC.ARCHIVE_FOLDER_ID` → prod COC-PDF folder
- [ ] `COC.ATTACHMENTS_FOLDER_ID` → prod supporting-docs folder

### D1b. Edit `backend/Constants.js` — the domain allowlist (ORG)
- [ ] Set `ORG.ALLOWED_DOMAINS` to `["megaworldcorp.com"]` (add any other valid Megaworld domain: subsidiaries, contractor domains, a legacy domain).
  - Layman: this is the "only company accounts may use this portal" list.
  - It is a **backstop**, not the main gate. The real gate is the deployment setting in D4 ("Who has access: Anyone within Megaworld"). This exists so that if that dropdown is ever set wrong, an outsider still cannot sign in or file a request.
  - Leaving it `[]` (empty) allows all domains, which is correct for dev testing and WRONG for production.
  - ⚠️ If a legitimate approver is on a different domain and you forget to list it, they will be locked out at login. Add every valid domain.

### D2. The dev email tag
- [ ] Preferred: set the `EMAIL_DEV_TAG` Script Property to `false` (D1 above). Removes the `[FOR APPROVER]` / `[FOR REQUESTOR]` subject tags you used for solo testing.
- [ ] Or edit `backend/Emails.js` → `EMAIL_DEV_TAG = false` (line ~73). The property overrides this literal, so if both are set the property wins.

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

## Phase G — Post-launch improvements (do NOT do these before go-live)

> Sourced from (a) the pre-go-live adversarial review and (b) a comparison against the sibling **DCS (Data Collection System)** project, which solved several of the same problems differently. Everything here is deliberately deferred: each one is a real improvement, and each one is also a change to a system that will by then be carrying live requests. Ship first, then improve.

### G1. Certificate generation: drop the Google Docs template (HTML → PDF blob)
- **Layman:** Right now the certificate design lives in a separate Google Doc, and if that Doc is deleted, corrupted, or its ID mistyped, no certificate can ever be issued. DCS builds its PDF straight from code instead, so there is no external file to lose.
- **Technical:** DCS uses `Utilities.newBlob(html, MimeType.HTML, name).getAs(MimeType.PDF)` — no `makeCopy`, no `DocumentApp`, no temp file, no Drive round trips. Layout becomes source (diffable, code-reviewed) instead of an un-versioned Doc.
- **Wins:** removes the single point of failure (this already cost real debugging time once via a double-pasted 88-char Doc ID); far fewer Drive quota operations; layout under version control.
- **Costs — read before committing:** Google's HTML-to-PDF engine is a legacy renderer. Table-based HTML + inline CSS only (no flexbox/grid), **no page-break control, no headers/footers/page numbers**. A long approval history produces rows split across page boundaries. Also, a non-developer can no longer edit the certificate's appearance without a code change and redeploy.
- **Effort:** plumbing swap is small (the existing token→value rules map converts ~1:1 to interpolation). The real cost is re-creating the certificate's visual design in constrained HTML.
- **⚠️ If adopting: port the generation mechanism ONLY, not DCS's no-archive model.** DCS discards the PDF and regenerates on demand. Keep writing to `COC.ARCHIVE_FOLDER_ID` and keep appending the `COC_PDFs` row — an immutable artifact of what was certified is the better half of that trade for a compliance document.
- **Cheaper alternative if you skip this:** G2 alone fixes the SPOF symptom (a named, fail-loud error instead of a generic Drive exception).

### G2. ✅ DONE (2026-07-30) — Environment config moved to Script Properties
> **Implemented and unit-tested; still needs a `clasp push` + browser pass.** See **Phase D1** for the operational steps. What landed: `scriptProps_` / `configFallback_` / `config_` / `configFlag_` / `_testConfig` appended to `backend/Constants.js` (loads first per `filePushOrder`, so the bindings exist before any other file evaluates); 6 read sites migrated across `Certificate.js` (3), `Attachments.js` (3); `emailDevTag_()` added in `Emails.js`. Resolution is **property → source literal → named throw**, so the dev account works with zero properties and deleting the properties is the rollback. `EMAIL_DEV_TAG` is fail-soft defaulting to `true`. `EMAIL_DEV_TAG`'s `const` was deliberately left as a literal (no PropertiesService call at file-load time — a throw there is an uncatchable load error). `ORG.ALLOWED_DOMAINS` deliberately stays source-only and has no fallback case, so a stray lookup fails closed.
>
> Original rationale retained below for context.

<details><summary>Original G2 write-up</summary>
- **Layman:** Today, moving between accounts means editing source code and redeploying. These values should be settings you change in the Apps Script editor, not code.
- **Technical:** Move to `PropertiesService.getScriptProperties()`, read through ONE cached accessor (a single `getProperties()` call per execution, not N × `getProperty()`), with a **fail-loud** wrapper that throws an error naming the missing key.

| COC value | Move? | Missing-value policy | Why |
|---|---|---|---|
| ~~`COC.TEMPLATE_DOC_ID`~~ | **Gone (2026-08-11)** | n/a | The misleading-Drive-error class of failure this row existed to diagnose is now structurally impossible: there is no external Doc to point at. |
| `COC.ATTACHMENTS_FOLDER_ID` | Yes | Fail loud | Pure environment value |
| `COC.ARCHIVE_FOLDER_ID` | Yes | Fail loud | Pure environment value |
| `EMAIL_DEV_TAG` | Yes | **Fail soft, default to `true` (dev-tagged)** | A forgotten property then sends visibly-test emails, never silently-production ones |
| `ORG.ALLOWED_DOMAINS` | **No — keep in source** | n/a | A security control, not an environment value. In `Constants.js` it is version-controlled, diffable, and code-reviewed; as a Script Property it becomes silently editable with no audit trail. (Two independent reviews reached this same conclusion.) If it is ever moved anyway, the missing-value branch must **deny**, not allow. |

- **The transferable idea (better than the mechanism):** DCS picks a failure mode per value type — **fail-loud** for infrastructure, **fail-secure** for security controls (missing domain config denies everyone), **fail-soft** for cosmetics (a missing optional URL just omits the button). Adopt the discipline, not just the API.

</details>

### G3. A `System_Configuration` passthrough sheet (the best idea from DCS)
- **Layman:** A sheet tab where an admin can change labels, links, and settings themselves, with no developer and no deploy.
- **Technical:** One getter walks every row of a config tab into a key/value object handed to the frontend. Adding a new admin-editable value costs zero backend code.
- **Why it is distinct from G2:** Script Properties are for values *ops* changes at migration time. This sheet is for values an *admin* changes on a Tuesday. Different audience, different cadence, both worth having.

### G4. ✅ DONE (2026-07-30) — Expiry sweep no longer re-scans per row
> **Implemented and unit-tested; still needs a `clasp push` + editor run.** `getExpiryFlagMap_()` added to `backend/Accessors.js` (one `Activity_Log` scan → a `{requestId: {stage: true}}` map); `checkContractExpiries()` in `backend/Triggers.js` now builds the map once before the loop and looks up instead of re-scanning. Projected sweep time at 2,000 lifetime requests drops from ~11 min (past the 6-minute ceiling) to a few seconds.
>
> ⚠️ **The subtle part, do not "simplify" it away:** the sweep *appends* `EXPIRY_*` rows mid-loop, and the old per-row re-scan could see those writes while a pre-built snapshot cannot. `markExpiryFlag_()` mirrors each append into the in-memory map to preserve that. This matters because **duplicate `request_id` rows are physically possible** (IDs were a 3-char slice with no uniqueness check before commit `e87d69c`, and legacy short IDs remain in the dev sheet) — without the mirror, two rows sharing an ID would each send an email. A unit test confirmed 1 email with the mirror and 2 without it.
>
> Also deliberate: `getExpiryFlagMap_()` is **not** wrapped in a try/catch falling back to `{}` — an empty map reads as "no reminder ever sent" and would re-notify every approved contract. A scan failure aborts the sweep (fail closed).
>
> **Test it with the duplicate-ID case** (see the Phase 0 test list). Original analysis retained below.

<details><summary>Original G4 write-up</summary>
- **Layman:** A daily background job re-reads the entire history log once per approved request. Fine now, but it gets slower every year and eventually exceeds Google's time limit — and when it does, it fails silently on the newest requests.
- **Technical:** `checkContractExpiries()` (`Triggers.js`) calls `getApprovalActions(requestId)` inside its per-row loop; each call is a full `Activity_Log` scan. Cost is quadratic in cumulative history.

| Lifetime requests | Daily sweep |
|---|---|
| 100 | ~4 s |
| 500 | ~52 s |
| ~1,450 | ~6 min ← **Apps Script ceiling** |
| 2,000 | ~11 min, fails |

- **Estimated 3-8 years out** at a few hundred requests/year. **Fix is ~15 lines in one function:** hoist a single `Activity_Log` scan above the loop into a `{requestId: {stage: true}}` flag map, then test against the map instead of re-scanning. 1,400 scans becomes 1. No DTO or signature change.
- **Two cheaper related wins (still open):** an invocation-scoped cache for the small config tabs (`Groups`/`Group_Approvers`/`Admins`) — the admin console currently does ~500 sheet round trips at 500 requests; and an optional `view` parameter on the approval-log builders so each email stops computing the same view twice. ⚠️ The config-tab cache needs explicit write-invalidation: `adminSaveChain` writes via `replaceGroupChain` then immediately re-reads in `notifyChainChanges_` to compute a before/after diff, so a naive execution-scoped cache would silently break chain-change notifications.

</details>

### G5. Smaller items
- **Per-operation lock timeouts** instead of one constant (DCS uses 30s draft / 45s submit / 60s session) — cheap, better ops signal.
- **Flag-driven partial revision:** DCS lets approvers flag specific fields/files so a resubmit only requires re-uploading the flagged ones, rather than COC's full chain restart. Materially kinder UX, but heavily coupled to client state and the source of many of DCS's own bug fixes. Study before adopting.
- **Admin Tier 3** (force-approve / reassign / cancel-reopen) — the riskiest auth surface, unblocked by `Activity_Log` whenever wanted.
- **Read-only Activity Timeline UI** and an in-portal `Admins_Log` viewer — the data already exists, only the view is missing.
- **Phase 12 — final Miga art:** externally blocked on licensed transparent-background assets. Pure drop-in re-encode of 6 PNGs into `MIGA_IMAGES`, no code change.

### G6. Verify in the sibling project (not a COC task)
A live vulnerability was identified in **DCS** during the comparison: `apiPhase3_RouteApprovedRequest` is an unguarded top-level global with no caller-identity check, no approved-status check, and no lock. It can be invoked directly via `google.script.run` with an enumerable session ID to email a forged "Certificate of Approval — Implementation Required" to the real provisioning inboxes, and it side-effects uploaded documents to `DOMAIN_WITH_LINK`. Fix in that repo with the same pattern used here (self-guard on identity + actionable status, inside the lock).

> **The generalizable lesson, worth remembering in both systems:** DCS's team already knew about the `google.script.run` bypass class (their code carries explicit F-02 guard comments) and still missed this function — because it reads like a formatter and mailer, not an authorization decision. When auditing, sweep every state-mutating and side-effect-producing global, not just the ones named like approvals.

---

*Generated as a pre-go-live handoff. Phases 0-F are the launch path; Phase G is the post-launch backlog.*
