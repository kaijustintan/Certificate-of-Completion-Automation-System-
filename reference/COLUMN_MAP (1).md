# Column Map Reference — Normalized Schema

**Purpose:** Ground truth for all Apps Script code. Every column referenced in code must use the index numbers from this file. The live authoritative map is `backend/Constants.js`; this doc mirrors it in human-readable form. For overall build status see `reference/ROADMAP.md`; for operation traces see `reference/FLOWS.md`.

> **⚠️ Big-bang normalization.** The original single 35-column `Certificate_Requests` monolith (+ the 7-col `Approver_Settings`) has been **replaced** by 7 purpose-built sheets. All normalized-DB access goes through the `backend/Accessors.js` seam — feature code should call the accessors, not read these sheets directly. The pre-normalization version of this doc is preserved in git history.

---

## ⚠️ Two number systems (the #1 footgun)

Every column constant is **1-based**. Apps Script's `getRange` is 1-based; JavaScript arrays are 0-based.

```javascript
sheet.getRange(row, CR.STATUS)   // 1-based Sheet API — use as-is (CR.STATUS = 3)
row[CR.STATUS - 1]               // 0-based array index — subtract 1
```

## Source-of-truth vs cache

`Activity_Log` is the **source of truth** for everything that happens to a request (approve / decline / return / resubmit). `Requests.status`, `Requests.current_step`, and `Requests.resubmit_count` are a **denormalized read-cache** for cheap dashboard reads — written only by `setRequestCache()` and kept consistent with the timeline. Never treat them as authoritative history; derive history from `Activity_Log` via `getApprovalView()`.

---

## The 7 sheets

| Constant | Sheet tab (exact) | Cols | Role |
|---|---|---|---|
| `CR`     | `Requests`            | 25 | Core request row (+ status/step/count cache) |
| `ACT`    | `Activity_Log`        | 9  | Append-only action timeline (source of truth) |
| `GRP`    | `Groups`              | 4  | Approver-group registry (surrogate `group_id`) |
| `GAP`    | `Group_Approvers`     | 6  | Normalized approver chain (unlimited approvers) |
| `RA`     | `Request_Attachments` | 8  | Supporting documents (per cycle) |
| `ADM`    | `Admins`              | 3  | Admin allowlist (role deferred) |
| `COCPDF` | `COC_PDFs`            | 6  | One row per generated certificate PDF |

---

## Sheet 1: `Requests` (`CR`)

**Tab name (exact):** `Requests` · **25 columns (A–Y)**

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `Request ID` | ✅ KEY. Short unique id, generated in code. |
| B | 2 | `Control Number` | Human-readable id e.g. `EC-2026-00001-ABC`. Computed on creation. |
| C | 3 | `Status` | ⚡ **CACHE.** Source of truth = `Activity_Log`. See status values below. |
| D | 4 | `Step` | ⚡ **CACHE.** Current active approver step. 0 = with requestor. |
| E | 5 | `Date of Filing` | Set on creation. |
| F | 6 | `Project Title` | |
| G | 7 | `Requestor` | requestor_email. Server-captured from logged-in user. |
| H | 8 | `Requestor's Designation` | |
| I | 9 | `Group` | ⚡ **FK → `GRP.GROUP_ID`** — a `group_id` (e.g. `G001`), NOT a name. |
| J | 10 | `Accountable Person` | |
| K | 11 | `Department` | |
| L | 12 | `Location` | Predefined dropdown + "Other" free-text. |
| M | 13 | `PC Name` | |
| N | 14 | `PRISM` | Optional. |
| O | 15 | `Purchase Order` | |
| P | 16 | `IHelp Number` | Optional. |
| Q | 17 | `Product Type` | |
| R | 18 | `Product Name` | |
| S | 19 | `Type of Purchase` | |
| T | 20 | `Type of License` | |
| U | 21 | `Contract Start Date` | |
| V | 22 | `Contract End Date` | |
| W | 23 | `Supplier Name` | |
| X | 24 | `Requestor's Remark` | Purpose of the request. |
| Y | 25 | `Resubmit_Count` | ⚡ **CACHE.** Count of resubmit cycles. Default 0. |

> **GONE from this sheet** (now derived from `Activity_Log`): App1/2/3 remarks & dates, `Expected_Attachments`, `Resubmit_History`, `Previous_Approvals`, `Last_Action_By`.

### Status values (`Requests.status`, `STATUS.*`)

| Value | Meaning |
|---|---|
| `"Pending Approver 1"` | Routed to Approver 1 (every new + resubmitted request starts here). |
| `"Pending Approver 2"` | Routed to Approver 2. |
| `"Pending Approver 3"` | Routed to Approver 3. |
| `"Fully Approved"` | Final approval done → COC PDF generated. |
| `"Declined"` | Rejected. |
| `"Returned to Requestor"` | Sent back for revision. |

> `"Syncing Files"` was **removed** — upload-before-submit (Phase 8) means there is no waiting-for-files state.

---

## Sheet 2: `Activity_Log` (`ACT`) — append-only timeline

**Tab name (exact):** `Activity_Log` · **9 columns** · One row per action; never updated or deleted.

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `action_id` | ✅ KEY (e.g. `ACT-1A2B3C4D`). |
| B | 2 | `request_id` | FK → `CR.REQUEST_ID`. |
| C | 3 | `group_id` | FK → `GRP.GROUP_ID`. Denormalized so the log is self-sufficient for audit. |
| D | 4 | `resubmit_cycle` | 0 = first cycle; 1+ after each resubmit. |
| E | 5 | `approver_step` | Approver position 1/2/3 the action pertains to; blank for submit/resubmit. |
| F | 6 | `actor_email` | Who performed the action. |
| G | 7 | `action` | `ACTION.*` enum (lowercase): `submitted` / `approved` / `declined` / `returned` / `resubmitted`. |
| H | 8 | `remark` | Comment / decline reason / return reason. |
| I | 9 | `timestamp` | Server time. |

`getApprovalView(requestId)` reconstructs the old shapes from this timeline: `byStep` (per-step date/remark), `previousApprovals` (current cycle), `priorApprovals` (earlier cycles → the re-review note), `approvedCount` (N-of-M), `latestRemark`, and the `\n\n---\n\n`-separated `resubmitHistory` string (`[PENDING]` / `Resubmit #N`).

---

## Sheet 3: `Groups` (`GRP`)

**Tab name (exact):** `Groups` · **4 columns**

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `group_id` | ✅ KEY surrogate PK (e.g. `G001`). Referenced by `CR.GROUP` and `GAP.GROUP_ID`. |
| B | 2 | `group_name` | Unique display name. Renameable without breaking routing. |
| C | 3 | `active` | Soft-disable a group (`FALSE` hides it). |
| D | 4 | `created_at` | |

## Sheet 4: `Group_Approvers` (`GAP`) — the normalized chain

**Tab name (exact):** `Group_Approvers` · **6 columns** · Composite key (group_id, sequence). **Unlimited approvers** — no 3-slot cap.

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `id` | ✅ KEY (e.g. `GA-1A2B3C4D`). |
| B | 2 | `group_id` | FK → `GRP.GROUP_ID`. |
| C | 3 | `sequence` | 1-based order in the chain (1, 2, 3, … N). |
| D | 4 | `approver_email` | |
| E | 5 | `designation` | |
| F | 6 | `active` | Soft-disable a slot. |

> `getApprovers(groupId)` still returns the **legacy 6-field shape** (`{approver1, designation1, approver2, …}`) built from the first 3 sequences, so all downstream code (approve skip-blank, signatories, N-of-M, isChainApprover, DTO) is unchanged.

---

## Sheet 5: `Request_Attachments` (`RA`)

**Tab name (exact):** `Request_Attachments` · **8 columns**

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `Attachment ID` | ✅ KEY (e.g. `A3F-ATT`). |
| B | 2 | `Request ID` | FK → `CR.REQUEST_ID`. |
| C | 3 | `File` | Friendly filename (display). |
| D | 4 | `File_Link` | Drive URL — **server-side only**, never sent to the frontend. Served via gated `downloadAttachment()`. |
| E | 5 | `Description` | Human label, e.g. "Supplier Quotation". |
| F | 6 | `resubmit_cycle` | 0 = original submit; N = added on Resubmit #N. Drives the #6 "Current / Previous" grouping. |
| G | 7 | `uploaded_by` | |
| H | 8 | `uploaded_at` | |

## Sheet 6: `Admins` (`ADM`)

**Tab name (exact):** `Admins` · **3 columns** · Allowlist for the (deferred) admin role.

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `email` | ✅ KEY. `isAdmin()` checks this (active only). |
| B | 2 | `active` | |
| C | 3 | `added_at` | |

## Sheet 7: `COC_PDFs` (`COCPDF`)

**Tab name (exact):** `COC_PDFs` · **6 columns** · Appended by `generateCOC()` on full approval. `request_id` is the FK, **not unique** (re-issuance capable).

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `coc_id` | ✅ KEY (e.g. `COC-1A2B3C4D`). |
| B | 2 | `request_id` | FK → `CR.REQUEST_ID`. |
| C | 3 | `control_number` | Human-readable, denormalized. |
| D | 4 | `pdf_link` | Drive URL of the generated PDF. |
| E | 5 | `drive_file_id` | |
| F | 6 | `generated_at` | |

---

## Key data relationships (JOINs)

```
Requests.Group (I) ──FK──> Groups.group_id (A)
                            Groups ──< Group_Approvers.group_id (B)   (one group : many ordered approvers)

Activity_Log.request_id (B) ──FK──> Requests.Request ID (A)          (one request : many actions)
Request_Attachments.Request ID (B) ──FK──> Requests.Request ID (A)   (one request : many files, across cycles)
COC_PDFs.request_id (B) ──FK──> Requests.Request ID (A)              (one request : 1+ generated PDFs)
Admins.email (A) ── checked by isAdmin()
```

All of these JOINs are encapsulated in `backend/Accessors.js` (groups/approvers/timeline) and `backend/Utils.js` (`getAttachmentsForRequest`). Prefer those over hand-rolling reads.

---

*Authoritative map: `backend/Constants.js`. Update both together when the sheet structure changes.*
