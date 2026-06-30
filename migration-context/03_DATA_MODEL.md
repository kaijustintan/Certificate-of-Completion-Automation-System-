# 03 · Data Model (the 8 normalized sheets)

> Ground truth for all code. The live authoritative map is **`backend/Constants.js`**; this mirrors it. Never hardcode column numbers — use the `Constants.js` column-map objects.

## 0. The normalization story (why 8 sheets)

The app was originally **3 tables**: a **35-column `Certificate_Requests` monolith** + a 7-col `Approver_Settings` (3-slot chain) + `Request_Attachments`. The monolith conflated three concerns:
1. request core (fine),
2. approval state flattened into fixed `App1/2/3_Date` / `App1/2/3_Remark` columns (a one-to-many crammed into fixed slots → **hard 3-approver cap**),
3. resubmit/audit data partly cleared on each resubmit (**cross-cycle history lost**).

On **2026-06-10**, in a single **big-bang refactor** (safe because there were no real users and disposable dev data), it was split into **8 purpose-built sheets** behind the `backend/Accessors.js` seam. This: removed the repeating columns, **lifted the 3-approver cap** (schema now supports N — though routing still caps at 3, see below), **delivered Phase 11 (audit log) for free** via the append-only `Activity_Log`, and **fixed resubmit data loss** (history is derived from the timeline, never cleared). The frontend barely moved because the Accessors seam reconstructs the legacy shapes (the **Frozen DTO** — see `02`). *(The original 3-table layout survives only in git history. The 8th sheet, `Admins_Log`, was added on 2026-06-11 with the Admin console.)*

> **Routing still caps at 3 approvers.** `STATUS` only has PENDING_1/2/3 and `approve()` only branches steps 1–3. The *schema* supports unlimited approvers; lifting routing past 3 needs new status strings (a DTO change) — a deliberate future item, out of scope to keep the DTO frozen.

## The 8 sheets at a glance

| Constant | Tab (exact name) | Cols | Role |
|---|---|---|---|
| `CR` | `Requests` | 25 | Core request row (+ status/step/count **cache**) |
| `ACT` | `Activity_Log` | 9 | **Append-only** action timeline — **SOURCE OF TRUTH** for history |
| `GRP` | `Groups` | 4 | Approver-group registry (surrogate `group_id`) |
| `GAP` | `Group_Approvers` | 6 | Normalized approver chain (unlimited approvers) |
| `RA` | `Request_Attachments` | 8 | Supporting documents (tagged per resubmit cycle) |
| `ADM` | `Admins` | 3 | Admin allowlist (checked by `isAdmin()`) |
| `ADL` | `Admins_Log` | 6 | **Append-only** admin-action audit (config-scoped) |
| `COCPDF` | `COC_PDFs` | 6 | One row per generated certificate PDF |

> **Naming history:** the constant `CR` historically meant "Certificate_Requests"; the tab is now `Requests` but the constant name was **kept** (still means "the request row's columns") to avoid churning every core-field read. `AS` (Approver_Settings) was **removed**, split into `GRP` + `GAP`.

## ⚠️ Two number systems (the recurring footgun)

Every column constant is **1-based**.
```js
sheet.getRange(row, CR.STATUS)   // 1-based Sheet API — use as-is (CR.STATUS = 3)
row[CR.STATUS - 1]               // 0-based array index — subtract 1
```
Most historical read-width bugs trace to forgetting to widen `getRange(row, 1, 1, N)` when N grows.

## Source-of-truth vs cache

`Activity_Log` is the **source of truth** for everything that happens to a request. `Requests.status` / `Requests.step` / `Requests.resubmit_count` are a **denormalized read-cache** for cheap dashboard reads — written **only** by `setRequestCache()`, kept consistent with the timeline. Never treat them as authoritative history; derive history from `Activity_Log` via `getApprovalView()`. **If a screen looks wrong, diff it against `Activity_Log`.**

---

## Sheet 1 — `Requests` (`CR`) · 25 cols (A–Y)

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `Request ID` | KEY. Short unique id, generated in code (surrogate). Format Plain Text. |
| B | 2 | `Control Number` | Human-readable business key e.g. `EC-2026-00001-ABC`. Computed on creation. |
| C | 3 | `Status` | ⚡ CACHE. See STATUS values. |
| D | 4 | `Step` | ⚡ CACHE. Current active approver step; 0 = with requestor. |
| E | 5 | `Date of Filing` | Set on creation. |
| F | 6 | `Project Title` | |
| G | 7 | `Requestor` | requestor_email. Server-captured from logged-in user. |
| H | 8 | `Requestor's Designation` | |
| I | 9 | `Group` | ⚡ **FK → `GRP.GROUP_ID`** — a `group_id` (e.g. `G001`), NOT a name. |
| J | 10 | `Accountable Person` | (free text — NOT guaranteed an email; a known data-quality gap) |
| K | 11 | `Department` | |
| L | 12 | `Location` | Predefined dropdown (AGT/GCP/EGP/TWS…) + "Other" free-text. |
| M | 13 | `PC Name` | |
| N | 14 | `PRISM` | Optional → "N/A" in COC. |
| O | 15 | `Purchase Order` | Optional → "N/A". |
| P | 16 | `IHelp Number` | Optional → "N/A". |
| Q | 17 | `Product Type` | (free text — Hardware/Software) |
| R | 18 | `Product Name` | |
| S | 19 | `Type of Purchase` | New / Renewal / Replacement |
| T | 20 | `Type of License` | |
| U | 21 | `Contract Start Date` | |
| V | 22 | `Contract End Date` | drives expiry (#10) |
| W | 23 | `Supplier Name` | |
| X | 24 | `Requestor's Remark` | Purpose of the request. |
| Y | 25 | `Resubmit_Count` | ⚡ CACHE. Resubmit cycles; default 0. |

**GONE from this sheet** (now derived from `Activity_Log`): `App1/2/3_Remark` & `_Date`, `Expected_Attachments`, `Resubmit_History`, `Previous_Approvals`, `Last_Action_By`. (These column names appear in older session history — treat as historical.)

### `STATUS` enum (`STATUS.*` in Constants.js — exact strings, a frozen DTO contract)

| Value | Meaning |
|---|---|
| `"Pending Approver 1"` | Routed to Approver 1 (every new + resubmitted request starts here). |
| `"Pending Approver 2"` | Routed to Approver 2. |
| `"Pending Approver 3"` | Routed to Approver 3. |
| `"Fully Approved"` | Final approval done → COC PDF generated. |
| `"Declined"` | Rejected (terminal; requestor must file anew). |
| `"Returned to Requestor"` | Sent back for revision (Step→0). |

> `"Syncing Files"` was **removed** (Phase 8). **Never add `"Expired"`** — expiry is a derived lens, not a status (see `05`/#10). These exact strings are compared in filters/badges/email subjects — a raw-string typo silently breaks routing.

### Step value reference
`0` = returned (with requestor) · `1/2/3` = pending Approver 1/2/3 · `"Fully Approved"`/`"Declined"` are terminal Status values, not Step.

---

## Sheet 2 — `Activity_Log` (`ACT`) · 9 cols · append-only timeline (SOURCE OF TRUTH)

One row per action; **never updated or deleted**; written **only** via `appendAction()`.

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `action_id` | KEY (e.g. `ACT-1A2B3C4D`). |
| B | 2 | `request_id` | FK → `CR.REQUEST_ID`. |
| C | 3 | `group_id` | FK → `GRP.GROUP_ID` (denormalized, so the log is self-sufficient for audit). |
| D | 4 | `resubmit_cycle` | 0 = first cycle; 1+ after each resubmit. |
| E | 5 | `approver_step` | Approver position 1/2/3 the action pertains to; blank for submit/resubmit. |
| F | 6 | `actor_email` | Who performed it. |
| G | 7 | `action` | `ACTION.*` enum (lowercase) — see below. |
| H | 8 | `remark` | Comment / decline reason / return reason. |
| I | 9 | `timestamp` | Server time. |

### `ACTION` enum
- **Workflow actions:** `submitted` · `approved` · `declined` · `returned` · `resubmitted`. These five drive derived status, history, who-acted, and N-of-M.
- **System actions (idempotency flags only):** `expiry_warning` · `expiry_notice` · `expiry_overdue` (written by the #10 expiry sweep). **`getApprovalView()` only branches on the 5 workflow actions and ignores these** — this is load-bearing: it lets system flags live in the timeline without corrupting history reconstruction. **Do not make `getApprovalView` branch on system actions.**

`getApprovalView(requestId)` reconstructs from this timeline: `byStep` (per-step date/remark), `previousApprovals` (current cycle), `priorApprovals` (earlier cycles → the re-review note), `approvedCount` (N-of-M), `latestRemark`, and the `resubmitHistory` string (`\n\n---\n\n`-separated, `[PENDING]`/`Resubmit #N`).

---

## Sheet 3 — `Groups` (`GRP`) · 4 cols

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `group_id` | KEY surrogate PK (e.g. `G001`). Referenced by `CR.GROUP` + `GAP.GROUP_ID`. |
| B | 2 | `group_name` | Unique display name. **Renameable without breaking routing** (that's the point of the surrogate key). |
| C | 3 | `active` | Soft-disable. ⚠️ Only gates the new-request dropdown — chain reads ignore it (deactivating is routing-safe). |
| D | 4 | `created_at` | |

## Sheet 4 — `Group_Approvers` (`GAP`) · 6 cols · the normalized chain

Composite key (group_id, sequence). **Unlimited approvers** (the 3-slot cap is gone in the schema).

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `id` | KEY (e.g. `GA-1A2B3C4D`). Stable across edits (in-place chain editing reuses rows). |
| B | 2 | `group_id` | FK → `GRP.GROUP_ID`. |
| C | 3 | `sequence` | 1-based order (1,2,3…N). **Server-assigned from array order — client numbers never trusted.** |
| D | 4 | `approver_email` | |
| E | 5 | `designation` | |
| F | 6 | `active` | Soft-disable a slot. |

> `getApprovers(groupId)` returns the legacy 6-field shape from the first 3 active sequences. `getApproverGroups()` (new-request dropdown) returns only groups that are `active` **AND** have ≥1 active approver row.

## Sheet 5 — `Request_Attachments` (`RA`) · 8 cols

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `Attachment ID` | KEY. |
| B | 2 | `Request ID` | FK → `CR.REQUEST_ID`. |
| C | 3 | `File` | Friendly filename (display). |
| D | 4 | `File_Link` | Drive URL — **server-side ONLY, never sent to frontend.** Served via gated `downloadAttachment()`. |
| E | 5 | `Description` | Human label, e.g. "Supplier Quotation". |
| F | 6 | `resubmit_cycle` | 0 = original submit; N = added on Resubmit #N. Drives the #6 Current/Previous grouping. |
| G | 7 | `uploaded_by` | |
| H | 8 | `uploaded_at` | |

## Sheet 6 — `Admins` (`ADM`) · 3 cols · allowlist

| Col | # | Name | Notes |
|---|---|---|---|
| A | 1 | `email` | KEY. `isAdmin()` checks this (active only). **Managed by hand — no UI** (so an admin can't mint admins). |
| B | 2 | `active` | |
| C | 3 | `added_at` | |

## Sheet 7 — `Admins_Log` (`ADL`) · 6 cols · append-only admin audit

`log_id | admin_email | action | target_group | details | timestamp`. Written **only** via `appendAdminLog()` (best-effort try/catch — **no-ops if the tab is missing**, so it never fails a committed mutation). Separate from `Activity_Log` because admin actions are config-scoped (no `request_id`) and must not pollute `getApprovalView`. ⚠️ **The tab must be created by hand** before the audit works.

### `ADMIN_ACTION` enum
`group_created | group_renamed | group_activated | group_deactivated | chain_changed`. (A granular-chain-label refinement — added/removed/reordered/replaced — was being wired in at the end of the Admin work; check `Constants.js` for the current set.) A `chain_changed` `details` value is a before→after approver diff.

## Sheet 8 — `COC_PDFs` (`COCPDF`) · 6 cols

`coc_id | request_id | control_number | pdf_link | drive_file_id | generated_at`. Appended by `generateCOC()` on full approval. `request_id` is the FK and is **not unique** — the system is **re-issuance capable** (regenerate on a typo fix → new row, old copies preserved). This is why COC links live in their own table, not a `Requests` column (a column would silently overwrite).

---

## Key relationships (JOINs — all encapsulated in `Accessors.js` / `Utils.js`)

```
Requests.Group (I) ──FK──> Groups.group_id (A)
                           Groups ──< Group_Approvers.group_id (B)     (one group : many ordered approvers)
Activity_Log.request_id (B) ──FK──> Requests.Request ID (A)            (one request : many actions)
Request_Attachments.Request ID (B) ──FK──> Requests.Request ID (A)     (one request : many files, across cycles)
COC_PDFs.request_id (B) ──FK──> Requests.Request ID (A)                (one request : 1+ generated PDFs)
Admins.email (A) ── checked by isAdmin()
```

## Manual-setup notes (sheets are hand-created, code matches)

- All 8 tabs must exist with the **exact** `SHEET_NAMES` names + matching headers — they are set up by hand, not by `clasp push`.
- `Groups` + `Group_Approvers` must be seeded (each request's `Requests.group` must hold a valid `group_id` FK; each group needs ≥1 active approver row).
- `Admins` must be seeded on the production spreadsheet (email + `ACTIVE=TRUE`) or the Admin console never appears.
- The `Admins_Log` tab **must be created by hand** (headers `log_id | admin_email | action | target_group | details | timestamp`).
- Request ID & Control Number columns must be formatted **Plain Text** (Apps Script reads numeric-looking strings as `Number`; all ID comparisons use `String()` coercion to avoid type mismatch).
- Project timezone is **`Asia/Manila`** in `appsscript.json` — all date math + the 8am triggers rely on it (never `"GMT+8"`).
