# E-Certificate Portal — Implementation Roadmap (Living Status Doc)

**Project:** Megaworld COC Automation — AppSheet → Google Apps Script migration
**Last updated:** 2026-06-09
**Purpose:** Single source of truth for *what's built, what's left, and in what order*. Supersedes the "Known Gaps" section of `ARCHITECTURE.md`. Format per project doc standard: **Layman first, Technical second.**

**Legend:** ✅ DONE · ⏳ PENDING · ⏸️ DEFERRED

> **Two numbering schemes reconciled here:** the architecture doc's **"Phases"** (the original migration plan — Phase 1 audit, Phase 8 attachments, etc.) and the **"Categories"** (the enhancement build rounds). Both are folded into one sequence below.

---

## PART A — FOUNDATION: Core AppSheet → Apps Script Migration
*(architecture doc "Phases 1–7")*

### ✅ Phase 1 — Column Map Audit
- **Layman:** Before any code, every column in the 3 Google Sheets was catalogued so the code never guesses where data lives. Became the source of truth.
- **Technical:** Produced `COLUMN_MAP.md` — 1-based column indices for `Certificate_Requests`, `Approver_Settings`, `Request_Attachments`. Confirmed `_RowNumber` is an AppSheet phantom and `Expected_Attachments` is a real stored column.

### ✅ Phases 2–7 — The Working Portal (core port)
- **Layman:** The actual rebuild — turning the no-code AppSheet app into a real custom web portal. By the end, a user could log in, file a request, and have it routed through approvers with emails at each step.
- **Technical:** `Constants.js`/`Utils.js`; `WebApp.js` `doGet()` + SPA shell + hash router + 6 pages + 4 components; role detection; `Approvals.js` (approve/decline/returnRequest/resubmit); `Emails.js` (original 7 emails); `Triggers.js` (`onSheetChange()` replacing AppSheet's 5 bots); core getters (`submitNewRequest`, `getRequestDetail`, `getMyRequests`, `getPendingApprovals`).

---

## PART B — ENHANCEMENT CATEGORIES
*(build rounds layered on the working portal)*

### ✅ Category 1 — Data Layer & Resubmit Tracking
- **Layman:** Hardened how the system remembers things — especially the return/resubmit cycle, so a bounced request keeps a clean history. Stopped double-click bugs on actions.
- **Technical:** Added `Resubmit_Count` (32), `Resubmit_History` (33), `Previous_Approvals` (34); established the `[PENDING]` history contract (split on `\n\n---\n\n`, promoted to `Resubmit #N` on resubmit); button-lock guards; data-integrity fixes.

### ✅ Category 2 — Approver UX Redesign (5 rounds)
- **Layman:** Made the approver's review screen pleasant — clear details, a visual approval chain showing who signed and who's next, a clean decision flow.
- **Technical:** Shared render helpers (`renderProgressSteps`, `renderApproversChain`, `renderRequestSummaryCards`, `renderResubmitBanner`), inline decline/return panels, status-icon chain (✓/✕/↩/⏳/○).

### ✅ Category 3 — Navigation, Dashboards & Backend Security
- **Layman:** Role-based navigation, filterable/sortable dashboards, and — critically — backend lockdown so a user can't bypass the UI and call approval functions they shouldn't.
- **Technical:** Auth layer (`normalizeEmail`, `sameEmail`, `getRequestRowData`, `isCurrentApprover`, `isChainApprover`) + guards on every sensitive callable; role nav links; filter/sort dropdowns; `getMyActionedRequests()`; `LAST_ACTION_BY` (col 35) audit column.

### ✅ Category 4 — Notification Completeness & Email Overhaul (+ Round 2)
- **Layman:** Closed every "left in the dark" gap — intermediate approvers get receipts, requestors get mid-chain progress, prior approvers are told when a request they approved gets bounced. Rebuilt all emails to one clean format with one-click portal links.
- **Technical:** Emails.js 7 → **12 functions**; `emailSubject()` standardization; labeled `buildInfoBlock()` bodies; portal deep-links via query params (`getPortalUrl`); return-reason + approver-label threading; `showConfirm()` modal; contract-date validation; actioned-list bug fixed via `LAST_ACTION_BY`.

### ✅ Post-Cat-4 — Frontend Redesign & Documentation
- **Layman:** Modern enterprise look (left sidebar, wider layout, two-column detail pages, sticky approve/decline buttons, clickable stat cards, loading spinners), then documented every file to one standard.
- **Technical:** Clickable stat-card filters + approver actioned status sub-filter; global `showLoading`/`hideLoading` on all 5 actions; sidebar conversion + 1280px content; `:has()` stat cards, modernized cards/badges/typography; `.detail-layout` two-column grid + sticky rail + `min-width:0` overflow fix; doc-comments standardized across all 21 files; global + project `CLAUDE.md` + memory updated.

---

## PART C — REMAINING ROADMAP

### ✅ Phase 9 — Certificate of Completion (COC) Generation — *DONE*
- **Layman:** When a request is fully approved, the COC PDF is auto-generated and emailed to the requestor as an attachment — exactly what the old AppSheet system did. **Template 1** used (zero new data fields).
- **Technical:** `backend/Certificate.js` `generateCOC(requestId)` → `DriveApp.makeCopy()` the template Doc → `replaceText()` via an ordered rules array that matches BOTH the as-built AppSheet `<<…>>` expressions AND clean `{{tokens}}` → clear unused Approver 2/3 signatory cells (last table) → export `application/pdf` → archive to `COC.ARCHIVE_FOLDER_ID` → trash temp copy. Wired into `sendFullyApprovedToRequestor` (`Emails.js`) with `{ attachments:[pdfBlob] }`, defensive so a COC failure never blocks the approval/email. Covers both the portal (`handleApprove`) and manual-edit (`onSheetChange`) paths. Config + token contract: `Constants.js` `COC.*`, `reference/COC_TEMPLATE_SPEC.md`. No schema change.
- **⚠️ Before production:** swap `COC.ARCHIVE_FOLDER_ID` (currently a dev folder) for the Megaworld folder `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y`, and ensure the executing account has read on the template Doc + write on that folder.

### ✅ Phase 8 — Attachment Upload-Before-Submit + Private Gated Serving — *DONE (2026-06-09)*
- **Layman:** Require at least one supporting document *before* submit. Files upload only at submit time (nothing hits Drive until you click Submit; any mid-upload failure rolls back cleanly). Documents are stored **fully private** in Drive — no shareable link for anyone. Requestor and approver both open files through a secure in-portal **"View"** button that checks identity before serving the file (PDF/image inline, others download; second view cached/instant, with a Miga loading screen). On a returned request, the requestor can attach corrected/missing docs when resubmitting — old files are kept, new ones added and labeled by resubmit cycle.
- **Technical:** Submit-time **upload-first** flow (`submitNewRequest`): `validateAttachmentPayload` → upload each file PRIVATE to `COC.ATTACHMENTS_FOLDER_ID` (no `setSharing`) with rollback-on-failure → `writeAttachmentRows` (one batched `setValues`) → `sendApprovalRequest` last. Identity-gated `downloadAttachment(attachmentId)` serves base64 only after `sameEmail(REQUESTOR)` OR `isChainApprover` (same gate as `getRequestDetail`) — **no raw Drive URL ever leaves the server**. `RA.FILE` = original filename (display), `RA.FILE_LINK` = Drive URL (server-side only; `extractDriveId` pulls the id). `buildAttachmentDriveName` → `EC-…__r{N}__file` naming convention. `handleResubmit(requestId, newFiles)` does optional upload-first re-upload (appends, keeps old rows). `resubmit()` always → `PENDING_1` (removed the `EXPECTED_ATTACHMENTS>0 ? SYNCING` branch that stuck resubmits post-Phase-8). `buildAttachmentList` (emails) lists `filename — description`, no link (private files would 404). Frontend: `<input type=file>` + `FileReader`→base64 on submit; `viewAttachmentFile` (blob cache + Miga loading tab); description always visible. Legacy `SYNCING`/`checkAttachmentSync`/`addAttachment` left **deprecated-dormant** (not deleted). New constant `COC.ATTACHMENTS_FOLDER_ID`.
- **Design decisions (changed from the original plan):** (1) **No required-docs matrix per Product Type** — supervisor confirmed "basta ≥1 supporting document"; `productType` stays free-text. (2) **Private + gated serving chosen over `DOMAIN_WITH_LINK`/`ANYONE_WITH_LINK` sharing** — NDA-grade confidentiality, no forwardable bearer links, and works regardless of the host account's Workspace sharing policy (the original plan's Drive-link approach broke on restricted domains). (3) `Expected_Attachments` (col 28) kept populated for record-keeping but is now **vestigial** — slated for removal in a future schema pass, not now.
- **⚠️ Before production (go-live gate):** swap `COC.ATTACHMENTS_FOLDER_ID` to the Megaworld supporting-docs folder; set both `ATTACHMENTS_FOLDER_ID` and `ARCHIVE_FOLDER_ID` to **Restricted** in Drive (no link sharing — files serve only through `downloadAttachment`); purge old `ANYONE_WITH_LINK` dev test files.

### ✅ Phase 10 — Miga Mascot Assets (interim) — *DONE*
- **Layman:** Replaced placeholder squares with real Miga artwork — 6 expressions (default, welcome, approved, pending, declined, returned), shown as a portrait box on a dark rounded tile.
- **Technical:** 6 PNGs in `assets/MIGA-<EMOTION>.png` resized to ~180px tall, base64-encoded, embedded as `data:` URIs in `MIGA_IMAGES` (`MigaWidget.html`) — no external hosting. `.miga-img` updated to portrait box (64×88, `object-fit:contain`, `--radius-md`, `--navy-900` bg).
- **⚠️ Interim:** Art has dark opaque background; `MIGA-WELCOME` has a lighter bg. Not yet transparent or licensed. See Phase 12 for final polish.

### ⏳ Phase 12 — Miga Final Polish *(do before go-live)*
- **Layman:** Make Miga look perfect for production — transparent background on all expressions, consistent styling, and potentially more expressions if needed.
- **Technical:** Replace `assets/MIGA-<EMOTION>.png` crops with clean transparent-bg, licensed versions → re-encode each to `data:` URI → swap into `MIGA_IMAGES` slots (no other code change). Optionally add new emotion variants (e.g. `loading`, `error`) if UX calls for them. Drop-in process documented in `MigaWidget.html` header comment.
- **Note:** No code change needed beyond re-encoding the source PNGs. The mechanism is fully in place.

### ⏳ Phase 11 — Audit Log *(OPTIONAL — only if a real audit requirement exists)*
- **Layman:** A permanent, never-overwritten record of *every* action on a request (submit / approve / decline / return / resubmit) — who, when, at what step, with what remark. Today only the **return narrative** survives across resubmits (`Resubmit_History` / AG); structured approval data (`AppN_Date`, `AppN_Remark`, `Previous_Approvals`) is **cleared each resubmit**, so cross-cycle history is lost. This would power a full ServiceNow-style "Activity Timeline".
- **Technical:** New `Request_Audit_Log` sheet tab + a `logAction(requestId, action, actor, step, remark, timestamp)` helper, called from `submitNewRequest` / `approve` / `decline` / `returnRequest` / `resubmit`. Append-only, never overwritten. This is the COC analog of the capstone's immutable on-chain `Log*` functions (`LogVerification`, `LogIssuerStatusChange`) — the Sheet doesn't give an audit log "for free" (no dual-write / no ledger), so it must be added explicitly.
- **Decision rule (friction-earned):** if the supervisor only needs "why was it returned" → the existing AG narrative already covers it, **don't build this.** Build only if there's a genuine audit/compliance requirement or a need for the full timeline.

### ⏸️ Post-Go-Live — Schema Normalization (known design debt)
- **Layman:** Right now the main `Certificate_Requests` sheet has 35 columns — including all the approval history (who approved on which date, their remarks) flattened into fixed `App1/App2/App3` columns. This creates a hard cap of 3 approvers, loses cross-cycle history on every resubmit, and makes the sheet feel bloated. The right long-term fix is to pull approval actions out into their own sheet (one row per action, never cleared), which also delivers the full audit timeline *for free* — no extra code needed beyond the table itself.
- **Technical:** Extract the repeating `App1/2/3_Date`, `App1/2/3_Remark`, `Previous_Approvals`, `Last_Action_By` columns into a new **append-only `Approvals` sheet**: `request_id | step | approver | decision | remark | timestamp`. Removes ~8 columns from `Certificate_Requests`, lifts the 3-approver cap, and makes **Phase 11 (Audit Log) trivially free** — the append-only table IS the audit timeline (same pattern as ChainCert's `LogVerification`). `Approver_Settings` `Approver_1/2/3` flat columns have the same smell but are low-stakes.
- **Why deferred:** Massive regression surface — every getter, `Approvals.js`, emails, triggers, and frontend approval-chain rendering assumes the flat layout. Wrong timing for a nearly-deployed system.
- **Trigger condition — do this when any of these become real:** (a) a group needs more than 3 approvers; (b) a genuine audit/compliance requirement lands (build the `Approvals` table *instead of* a bolt-on Phase 11); (c) resubmit history loss actually hurts someone. See `ARCHITECTURE.md § 7.3` for the full technical breakdown.

### ⏳ Location Dropdown — *1st in sequence (next, quick win)*
- **Layman:** Change the request form's "Location" field from a free-text box to a fixed dropdown (AGT / GCP / EGP / TWS / Other) so location data is consistent and filterable instead of every requestor typing it differently.
- **Technical:** Convert the `location` `<input type=text>` in `NewRequest.html` to a `<select>` with the canonical Megaworld property codes + "Other". If "Other" → reveal a free-text fallback input. `validateNewRequest` already treats `location` as required — no backend change (still writes `CR.LOCATION`). **Open:** confirm the exact option set + display labels (do the codes show as bare codes or full property names?) and whether "Other" needs a free-text fallback.

### ⏳ In-Portal Admin Role — *2nd in sequence*
- **Layman:** A web-based admin who can see ALL requests across every group and manage the approver groups (who approves what) without ever touching the raw Google Sheet. The goal: give a non-technical manager safe control through the portal instead of handing them the spreadsheet (where one wrong edit breaks the column structure).
- **⚠️ Scope gate (confirm with supervisor before building):** *who manages `Approver_Settings` post-handoff, and do they get direct Sheet access?* The answer picks the tier:
  - **Tier 0 — Don't build.** If the Sheet owner keeps direct access and is fine managing groups there. (Original deferral logic.)
  - **Tier 1 — Oversight-only** (~half day): read-only "all requests" dashboard (filter by status/group/requestor/date) + read-only group list. Good if the manager wants *visibility*, not control.
  - **Tier 2 — Group management** (~1–2 days, the real "admin"): Tier 1 + guarded CRUD on `Approver_Settings` (add/edit/remove approvers + groups, validated so a malformed group can't be saved). **Recommended target** if a non-technical manager needs control.
  - **Tier 3 — Request intervention** (deferred): reassign a stuck request's approver, force-advance/cancel/reopen. **Blocked on the audit foundation** — admin overrides MUST be logged, so this waits for the post-go-live `Approvals` table (see Schema Normalization). Do NOT build Tier 3 pre-go-live.
- **Technical:** New third role `state.user.role = "admin"` (today only `approver`|`requestor`). Admin identity resolved **server-side** (`Session.getActiveUser().getEmail()` against an admin allowlist — new sheet/column or `Constants.js` list); every admin callable guards `isAdmin(caller)` server-side, same discipline as the existing auth layer. New admin page + nav link gated on role. Group CRUD writes validated + ideally `LockService`-guarded.
- **Sequencing note:** Built pre-go-live, so it can only reach **Tier 1–2** (oversight + group management). Tier 3 (intervention) is intentionally post-go-live because it depends on the audit log.

### ⏳ Pre-Production Go-Live Gate
- **Layman:** Final checklist before real users touch it.
- **Technical:**
  - [ ] `EMAIL_DEV_TAG = false` in `backend/Emails.js`
  - [ ] `clasp push` **and publish** a new `/exec` version (deep-links point to `/exec`)
  - [ ] Swap `COC.ARCHIVE_FOLDER_ID` (Constants.js) from the dev folder to the Megaworld folder `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y`; confirm executing account can read the template Doc + write that folder
  - [x] `LAST_ACTION_BY` header present in sheet (manual ✅)
  - [ ] Update `COLUMN_MAP.md` to 35 cols (done ✅)
  - [ ] Optional: Location dropdown (AGT/GCP/EGP/TWS/Other) — fold into Phase 8

---

## Recommended sequence for what's left
~~Phase 9~~ ✅ → ~~Phase 8~~ ✅ → ~~Phase 10~~ ✅ → **Location dropdown → Admin role → Phase 12 → Go-live gate → Schema normalization → Phase 11**.

Phases 8, 9, 10 done — **all major architectural work is complete.** Agreed order for what's left (2026-06-09):

1. **Location dropdown** — quick win, do next.
2. **Admin role** — after the supervisor confirms scope (Tier 1 oversight vs Tier 2 group management). Buildable pre-go-live up to Tier 2; Tier 3 intervention waits for the audit log.
3. **Phase 12 (Miga final polish)** — *floats*: externally blocked on licensed/transparent art, slot it in whenever the art lands. Pure drop-in re-encode (no code).
4. **Go-live gate** — **intentionally last.** Dev runs on a personal Google account; the Megaworld-account migration + folder/link swaps + `EMAIL_DEV_TAG=false` all happen at the very end, once everything is verified working on the personal setup.
5. **Schema normalization** — **post-go-live**, on-demand (per the trigger conditions). Ship first on the proven flat schema; refactor when the wall is actually hit, without launch pressure.
6. **Phase 11 (Audit Log)** — last, and **free once normalization exists** (the append-only `Approvals` table IS the audit timeline). Don't build it as a separate bolt-on.

**Admin role** is now in the active sequence (was deferred). **Phase 11** stays after normalization by design.
