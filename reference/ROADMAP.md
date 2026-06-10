# E-Certificate Portal — Implementation Roadmap (Living Status Doc)

**Project:** Megaworld COC Automation — AppSheet → Google Apps Script migration
**Last updated:** 2026-06-10
**Purpose:** Single source of truth for *what's built, what's left, and in what order*. Supersedes the "Known Gaps" section of `ARCHITECTURE.md`. Format per project doc standard: **Layman first, Technical second.**

> **⚡ 2026-06-10 — Big-bang schema normalization SHIPPED (ahead of the old "post-go-live" plan).** The 35-col `Certificate_Requests` monolith + `Approver_Settings` were replaced by **7 normalized sheets** behind the `backend/Accessors.js` seam. This flips three roadmap items that were written against the flat schema — see the **Schema Normalization** and **Phase 11** sections below (now ✅) and the **Activity_Log** as the free audit timeline. Historical Part A/B entries below describe what was built *at the time* (flat schema) and are left as-is for provenance.

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

### ✅ Phase 11 — Audit Log — *DELIVERED by the normalization (free)*
- **Layman:** A permanent, never-overwritten record of *every* action on a request (submit / approve / decline / return / resubmit) — who, when, at what step, with what remark. This now exists: it's the **`Activity_Log`** sheet, which the normalization added as the source of truth. Cross-cycle history is no longer lost on resubmit. A full "Activity Timeline" UI could be built on top whenever wanted — the data is already there.
- **Technical:** The append-only `Activity_Log` (written only via `appendAction()` from `submitNewRequest` / `approve` / `decline` / `returnRequest` / `resubmit`) IS the audit timeline — exactly the COC analog of ChainCert's immutable `Log*` functions. This was the "trivially free" payoff predicted in the Schema Normalization section. **Remaining (optional):** a dedicated read-only timeline view in the UI; the data layer is complete.

### ✅ Schema Normalization — *DONE (2026-06-10, big-bang)*
- **Layman:** The 35-column `Certificate_Requests` monolith — which crammed all approval history (who approved, when, their remarks) into fixed `App1/2/3` columns — was split into purpose-built sheets. This lifted the 3-approver cap, stopped losing cross-cycle history, and delivered a full audit timeline *for free*. The frontend barely moved because a translation layer keeps the old data shapes.
- **Technical:** `Certificate_Requests` → **`Requests`** (25 cols; status/step/resubmit_count now a denormalized read-cache). The repeating `App1/2/3_Date`/`_Remark`, `Previous_Approvals`, `Last_Action_By`, `Resubmit_History`, `Expected_Attachments` columns were extracted into the **append-only `Activity_Log`** (`request_id | group_id | resubmit_cycle | approver_step | actor | action | remark | timestamp`). `Approver_Settings` (3-slot) → **`Groups`** (surrogate `group_id`) + **`Group_Approvers`** (composite key, unlimited approvers). Added **`Admins`** (allowlist) + **`COC_PDFs`** (one row per generated PDF). New **`backend/Accessors.js`** seam centralizes all normalized reads/writes and reconstructs the legacy shapes (`getApprovers` 6-field, `getApprovalView` per-step/history/previousApprovals/N-of-M) so the **frontend DTO is frozen**. `Constants.js`: `AS` removed; `CR` retained (renamed sheet, same meaning) + new `ACT`/`GRP`/`GAP`/`ADM`/`COCPDF`. See `COLUMN_MAP (1).md` for the full per-sheet maps.
- **Note:** Sheets were created/seeded manually; code matches. The old flat-schema `ARCHITECTURE.md § 7.3` breakdown is now historical.

### ✅ Attachment Cycle Grouping (#6) — *DONE (2026-06-10)*
- **Layman:** On a request that's been resubmitted, the Attachments card now separates **"Current submission"** from **"Previous versions"** (labeled Original / Resubmit #N) so the requestor and reviewer can tell which documents belong to which cycle. Never-resubmitted requests still show a plain flat list.
- **Technical:** `getRequestDetail` DTO exposes `resubmitCycle` per attachment (additive, frozen-DTO safe); `renderAttachmentsBlock` (shared by RequestDetail + ReviewDetail) groups by `RA.RESUBMIT_CYCLE` against `detail.resubmitCount`. CSS `.attachment-group*` in `Stylesheet.html` (existing `:root` vars only).

### ✅ Location Dropdown — *DONE*
- **Layman:** The request form's "Location" field is now a fixed dropdown (predefined Megaworld property list + "Other" free-text) instead of free text, so location data is consistent and filterable.
- **Technical:** `location` `<select>` in `NewRequest.html` with the canonical property codes + an "Other" → free-text fallback. No backend change (still writes `CR.LOCATION`).

### ⏳ In-Portal Admin Role — *2nd in sequence*
- **Layman:** A web-based admin who can see ALL requests across every group and manage the approver groups (who approves what) without ever touching the raw Google Sheet. The goal: give a non-technical manager safe control through the portal instead of handing them the spreadsheet (where one wrong edit breaks the column structure).
- **⚠️ Scope gate (confirm with supervisor before building):** *who manages `Groups` / `Group_Approvers` post-handoff, and do they get direct Sheet access?* The answer picks the tier:
  - **Tier 0 — Don't build.** If the Sheet owner keeps direct access and is fine managing groups there. (Original deferral logic.)
  - **Tier 1 — Oversight-only** (~half day): read-only "all requests" dashboard (filter by status/group/requestor/date) + read-only group list. Good if the manager wants *visibility*, not control.
  - **Tier 2 — Group management** (~1–2 days, the real "admin"): Tier 1 + guarded CRUD on `Groups` + `Group_Approvers` (add/edit/remove approvers + groups, validated so a malformed group can't be saved). Easier now — the normalized `Group_Approvers` is purpose-built for this (unlimited rows, soft-delete via `active`). **Recommended target** if a non-technical manager needs control.
  - **Tier 3 — Request intervention**: reassign a stuck request's approver, force-advance/cancel/reopen. Admin overrides MUST be logged — now **unblocked** since `Activity_Log` exists (append an action with the admin as actor). Still recommended post-go-live, but no longer gated on building an audit table.
- **Technical:** New third role `state.user.role = "admin"` (today only `approver`|`requestor`). Admin identity resolved **server-side** against an admin allowlist; every admin callable guards `isAdmin(caller)`, same discipline as the existing auth layer. New admin page + nav link gated on role. Group CRUD writes validated + ideally `LockService`-guarded.
- **⚡ Already scaffolded by the normalization:** the **`Admins`** sheet (`ADM`) and **`isAdmin(email)`** (`Accessors.js`) exist and work server-side; `detectRole()` intentionally does NOT return `"admin"` yet. Group CRUD also got easier — `Group_Approvers` is the table an admin would edit (unlimited approvers, soft-delete via `active`). What's left is purely the **UI** (admin page + nav + the guarded CRUD callables).
- **Sequencing note:** Built pre-go-live, so it can only reach **Tier 1–2** (oversight + group management). Tier 3 (intervention) is intentionally post-go-live because it depends on the audit log.

### ⏳ Pre-Production Go-Live Gate
- **Layman:** Final checklist before real users touch it.
- **Technical:**
  - [ ] `EMAIL_DEV_TAG = false` in `backend/Emails.js`
  - [ ] `clasp push` **and publish** a new `/exec` version (deep-links point to `/exec`)
  - [ ] Swap `COC.ARCHIVE_FOLDER_ID` (Constants.js) from the dev folder to the Megaworld folder `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y`; confirm executing account can read the template Doc + write that folder
  - [ ] Swap `COC.ATTACHMENTS_FOLDER_ID` to the Megaworld supporting-docs folder; set both Drive folders to **Restricted** (no link sharing); purge old `ANYONE_WITH_LINK` dev test files
  - [ ] All **7 normalized sheet tabs** present with exact `SHEET_NAMES` names + headers; `Groups`/`Group_Approvers` seeded (each request's `group` is a valid `group_id` FK)
  - [ ] Run `registerExpiryTrigger()` once **on the Megaworld account** (daily 8am expiry-reminder sweep #10; triggers are per-account, not created by `clasp push`)
  - [x] `COLUMN_MAP (1).md` synced to the normalized schema (done ✅, 2026-06-10)
  - [x] Location dropdown (done ✅)

---

### ✅ Contract-Expiry Indicator + Reminders (#10) — *DONE (2026-06-10; live verification pending)*
- **Layman:** Dalawang bahagi. (1) **Indicator** — kapag lumipas na ang Contract End Date, may maliit na gray na "Expired" chip sa tabi ng status badge sa parehong dashboards AT sa detail pages, plus "Expired" option sa Status dropdown. (2) **Reminders** — tuwing 8am, may email sa requestor kapag 3 araw na lang, araw na mismo, o lumipas na ang contract ng isang fully-approved na COC, para may panahon mag-renew.
- **Technical (indicator):** Server-side `isContractExpired(rawEnd)` (`Utils.js`) — end-of-day comparison, blank/invalid → false; frontend never parses dates. `getMyRequests` / `getPendingApprovals` / `getMyActionedRequests` / `getRequestDetail` DTOs gained additive `contractEnd` + `isExpired`. `.badge-expired` chip on both dashboard tables + both detail-page headers; "Expired (N)" dropdown option + filter branch on the requestor Status dropdown and the approver Actioned-status dropdown. No stat-card change; no schema change.
- **Technical (reminders):** `checkContractExpiries()` (`Triggers.js`) — the system's **first time-based trigger**, daily ~8am (Asia/Manila per `appsscript.json`). Sweeps Fully-Approved rows with a contract end; **three stages** emailing the **requestor only** via `sendExpiryReminderToRequestor()` (`Emails.js`, reuses `emailSubject`/`buildInfoBlock`/`getPortalUrl`/`EMAIL_DEV_TAG`): `1..3` days → "Expiring Soon" (range), `===0` → "Expires Today" (exact), `<0` → "Has Expired" (range). Per-stage idempotency via `Activity_Log` system actions `EXPIRY_WARNING`/`EXPIRY_NOTICE`/`EXPIRY_OVERDUE` (no new sheet/column; `getApprovalView` ignores them) + `daysUntilContractEnd()` helper. The post-expiry email is the real awareness channel (requestors rarely watch the portal). ⚠️ Requires a one-time **per-account** `registerExpiryTrigger()` run. Approver notifications intentionally out of scope.

## Recommended sequence for what's left
~~Phase 9~~ ✅ → ~~Phase 8~~ ✅ → ~~Phase 10~~ ✅ → ~~Location dropdown~~ ✅ → ~~Schema normalization~~ ✅ → ~~#6 attachment grouping~~ ✅ → ~~#10 expiry filter~~ ✅ → **Admin role UI → Phase 12 → Go-live gate**.

**All pre-admin work is complete.** Updated order for what's left:

1. **Admin role UI** — data layer is already scaffolded (`Admins` sheet, `isAdmin()`, `Group_Approvers` as the editable chain). What's left is the admin page + nav + guarded CRUD callables. Tier 1 (oversight) / Tier 2 (group management) buildable pre-go-live; Tier 3 (intervention) is now unblocked by `Activity_Log` if wanted. **Blocked on the supervisor tier decision.**
2. **Phase 12 (Miga final polish)** — *floats*: externally blocked on licensed/transparent art; pure drop-in re-encode (no code).
3. **Go-live gate** — **intentionally last.** Megaworld-account migration + folder/link swaps + `EMAIL_DEV_TAG=false` happen at the very end.

**Phase 11 (Audit Log)** is no longer a separate build — `Activity_Log` already IS the append-only audit timeline; only an optional read-only timeline UI remains.
