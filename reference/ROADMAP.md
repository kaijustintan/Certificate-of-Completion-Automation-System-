# E-Certificate Portal — Implementation Roadmap (Living Status Doc)

**Project:** Megaworld COC Automation — AppSheet → Google Apps Script migration
**Last updated:** 2026-06-04
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

### ⏳ Phase 9 — Certificate of Completion (COC) Generation — *DO FIRST*
- **Layman:** When a request is fully approved, auto-generate the official COC PDF and email it to the requestor — exactly what the old AppSheet system did. **Template 1 chosen** (needs zero new data fields).
- **Technical:** Build a Google Docs version of **Template 1** with `{{placeholders}}` → on "Fully Approved," `DocumentApp` copies + fills → export PDF via `DriveApp...getAs("application/pdf")` → attach to `sendFullyApprovedToRequestor` (`attachments` option) → archive in Drive folder `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y`. All placeholders map to existing columns — no schema change.
- **Prereq:** create the Google Docs template (Drive side).

### ⏳ Phase 8 — Attachment Upload-Before-Submit Redesign — *biggest item*
- **Layman:** Require supporting documents *before* submit (like a loan/admissions form), with the right docs enforced per product type, stored in Google Drive.
- **Technical:** Replace legacy `Expected_Attachments`/`Syncing Files` honor-system flow with mandatory inline upload; disable submit until required docs attached; define required-documents matrix per Product Type; Drive integration (`File`/`File_Link`); drop `SYNCING` status + sync-finisher logic.
- **Prereq:** confirm required-docs matrix with supervisor.

### ⏳ Phase 10 — Finalize Miga Mascot Assets
- **Layman:** Swap the grey placeholder mascot images for the real finished artwork.
- **Technical:** Replace `placehold.co` URLs in `MIGA_IMAGES` (`MigaWidget.html`) with hosted PNG URLs for all 6 emotions.

### ⏳ Phase 11 — Audit Log *(OPTIONAL — only if a real audit requirement exists)*
- **Layman:** A permanent, never-overwritten record of *every* action on a request (submit / approve / decline / return / resubmit) — who, when, at what step, with what remark. Today only the **return narrative** survives across resubmits (`Resubmit_History` / AG); structured approval data (`AppN_Date`, `AppN_Remark`, `Previous_Approvals`) is **cleared each resubmit**, so cross-cycle history is lost. This would power a full ServiceNow-style "Activity Timeline".
- **Technical:** New `Request_Audit_Log` sheet tab + a `logAction(requestId, action, actor, step, remark, timestamp)` helper, called from `submitNewRequest` / `approve` / `decline` / `returnRequest` / `resubmit`. Append-only, never overwritten. This is the COC analog of the capstone's immutable on-chain `Log*` functions (`LogVerification`, `LogIssuerStatusChange`) — the Sheet doesn't give an audit log "for free" (no dual-write / no ledger), so it must be added explicitly.
- **Decision rule (friction-earned):** if the supervisor only needs "why was it returned" → the existing AG narrative already covers it, **don't build this.** Build only if there's a genuine audit/compliance requirement or a need for the full timeline.

### ⏸️ Deferred — In-Portal Admin Role
- **Layman:** A web-based admin who manages approver groups + sees all requests. **Not building for now** — whoever owns the Google Sheet already has these powers directly.
- **Technical:** Out of scope pending one supervisor answer: *who manages `Approver_Settings` post-handoff, and do they get direct Sheet access?* Non-technical manager needing web control → revisit (3rd role + guarded CRUD). Cheap middle ground if oversight-only is wanted: a read-only "all requests" admin view.

### ⏳ Pre-Production Go-Live Gate
- **Layman:** Final checklist before real users touch it.
- **Technical:**
  - [ ] `EMAIL_DEV_TAG = false` in `backend/Emails.js`
  - [ ] `clasp push` **and publish** a new `/exec` version (deep-links point to `/exec`)
  - [x] `LAST_ACTION_BY` header present in sheet (manual ✅)
  - [ ] Update `COLUMN_MAP.md` to 35 cols (done ✅)
  - [ ] Optional: Location dropdown (AGT/GCP/EGP/TWS/Other) — fold into Phase 8

---

## Recommended sequence for what's left
**Phase 9 (COC)** → **Phase 8 (attachments)** → **Phase 10 (Miga)** → **Go-live gate**.

COC is self-contained, high-value, zero-schema-risk — good momentum win. Attachments is the heavier architectural change. Miga is cosmetic, anytime.

**Phase 11 (Audit Log)** sits outside this sequence — build it *only if* an audit requirement surfaces. **Admin role** stays deferred pending the supervisor answer.
