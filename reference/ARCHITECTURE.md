# E-Certificate Automation — Architecture Document

**Project:** Migration from AppSheet to Google Apps Script
**Backend:** Google Sheets (3 sheet tabs in one workbook)
**Stack:** Apps Script + clasp + VS Code + GitHub
**Document purpose:** Living reference for the Apps Script implementation. Captures both the original AppSheet design (as historical context) and the target architecture being built. Real PII has been replaced with placeholder tokens.

> **Sanitization notes**
> - Real approver emails → `[approver1@company.com]`, etc.
> - Real group/department names → `[Department Group N]`
> - Real example data (request IDs, control numbers, project titles, supplier names, PO numbers, contract dates, requestor emails) → `[…]` placeholders
> - Expression literals like `"Pending Approver 1"`, `"Returned to Requestor"`, `"Fully Approved"` are state strings, preserved verbatim

---

> **📍 STATUS NOTE (added after Categories 1–4):** This document predates the Category 1–4 build rounds and the COC/admin decisions. Several "Known Gaps" listed below — intermediate-approver confirmation email (#3), requestor progress email (#4), and approver actioned-view (#5) — are now **IMPLEMENTED**. For the current authoritative build status and the forward roadmap (Phases 8–10, go-live), see **`reference/ROADMAP.md`**. This doc remains the best reference for the original AppSheet behavior and the migration design rationale.

## Table of Contents

1. [Overview](#1-overview)
2. [Design Decisions — Changes from AppSheet](#2-design-decisions--changes-from-appsheet)
3. [Workflow Logic — Target State](#3-workflow-logic--target-state)
4. [Data Structure](#4-data-structure)
5. [Email Notifications](#5-email-notifications)
6. [Roles & Visibility](#6-roles--visibility)
7. [Known Gaps & Pending Work](#7-known-gaps--pending-work)
8. [AppSheet Reference (Historical)](#8-appsheet-reference-historical)
9. [Migration Notes — Apps Script Equivalents](#9-migration-notes--apps-script-equivalents)

---

## 1. Overview

E-Certificate Automation is a multi-level approval workflow for processing certificate requests (software licenses, hardware, service contracts, etc.) at Megaworld. A requestor submits a request, the system routes it through up to 3 approvers in sequence, and emails are sent at every status change.

**Primary migration goal:** Improve the UI/UX over the AppSheet implementation. The business logic is already proven; the rebuild focuses on delivering a custom Megaworld-branded web portal that approvers and requestors will actually enjoy using.

**Three actors:**

| Actor | Role | Primary surface |
|---|---|---|
| **Requestor** | Files requests, uploads supporting documents, tracks status | Web portal |
| **Approver** | Reviews requests, decides Approve / Decline / Return | Web portal (notified by email) |
| **System** | Routes requests, sends emails, updates state | Behind the scenes |

---

## 2. Design Decisions — Changes from AppSheet

The Apps Script port intentionally diverges from the original AppSheet behavior in several places. These decisions were made jointly during planning and testing.

### 2.1 Attachment flow — upload BEFORE submission (changed)

**AppSheet behavior:** Requestor submitted first, then uploaded files. A `"Syncing Files"` state held the request in limbo until file count matched `Expected_Attachments`. The Sync Finisher Bot then unlocked the request.

**Target behavior:** Requestor must upload all required documents BEFORE clicking submit. The submit button is disabled until required files are attached. There is no `"Syncing Files"` state. Required documents are defined per product type and enforced by the form.

**Why changed:**
- AppSheet's two-step flow allowed requests to sit incomplete in the system
- Self-declared `Expected_Attachments` was an honor system with no enforcement
- Modern web forms (loan applications, college admissions) handle this inline as standard practice
- Cleaner state machine — one fewer status to handle

**Future required-documents matrix** (to be defined with supervisor):

| Product Type | Required Documents |
|---|---|
| Software License | Supplier quotation, Budget approval |
| Hardware Purchase | Supplier quotation, Technical specs, Budget approval |
| Service Contract | Vendor accreditation, Contract draft |
| Renewal | Existing contract, Renewal quotation |

### 2.2 Approval action — portal-only, not email-embedded (changed)

**AppSheet behavior:** Emails included an "interactive card" embedding the Certificate_Requests_Detail view. Approvers could Approve / Decline / Return directly from the email.

**Target behavior:** Approvers receive notification emails containing request details and a link to the portal. The Approve / Decline / Return action happens inside the portal. The email is for notification only.

**Why changed:**
- Better UI/UX — the stated migration goal
- Cleaner audit trail (every action logged via authenticated portal session)
- More secure (email links can be intercepted; logged-in portal sessions cannot)
- Allows richer review experience (full attachment access, approval history visualization, contextual info)

### 2.3 Return flow — hard return to Approver 1 (retained)

**AppSheet behavior:** Any approver returning a request sets `Step = 0`. On resubmit, `Step = 1` regardless of who returned it — the chain restarts from Approver 1.

**Target behavior:** Same. Hard return retained.

**Why retained:**
- Safer default — every approver re-sees the corrected request
- Matches AppSheet behavior, no migration confusion
- Light return (back to the returner) can be added later if requested

### 2.4 Approver dual-role (retained)

**AppSheet behavior:** An approver is also implicitly a requestor — they can submit their own requests in addition to approving others'.

**Target behavior:** Same. The approver dashboard includes a "My submitted requests" link to switch contexts.

---

## 3. Workflow Logic — Target State

### 3.1 Full request lifecycle

```
1. REQUESTOR fills the form
   - All required fields completed
   - All required supporting documents uploaded
   - Submit button disabled until requirements met

2. REQUESTOR clicks Submit
   - Status = "Pending Approver 1"
   - Step = 1
   - System sends notification email to Approver 1

3. APPROVER 1 receives email with request details + portal link
   - Opens portal, reviews full details + attachments
   - Three options: Approve / Decline / Return

4a. APPROVE
    - Step = 2, App1_Date = NOW()
    - Status = "Pending Approver 2" (or "Fully Approved" if no Approver 2)
    - Emails sent:
        • Approver 1 (confirmation of their decision)         [GAP — not implemented]
        • Requestor (progress update with portal link)         [GAP — not implemented]
        • Approver 2 (new request with full approval history)

4b. DECLINE
    - Status = "Declined"
    - Emails sent:
        • Approver who declined (confirmation)
        • Requestor (decline notification with reason)
    - Request is closed. Requestor must file a new request to retry.

4c. RETURN
    - Step = 0, Status = "Returned to Requestor"
    - Emails sent:
        • Approver who returned (confirmation)
        • Requestor (return notification with reason + edit link)

5. REQUESTOR resubmits (if returned)
    - Edits required fields and re-uploads any needed documents
    - Step = 1, all App_Date fields cleared, all Approver_Remark fields cleared
    - Status = "Pending Approver 1"
    - Flow restarts from step 2

6. APPROVER 2 and APPROVER 3 follow same pattern as Approver 1

7. FULL APPROVAL (after final approver approves)
    - Status = "Fully Approved"
    - Emails sent:
        • Final approver (confirmation)
        • Requestor (success notification with Certificate of Completion attached)
```

### 3.2 State machine

| Status Value | Set by | Triggers |
|---|---|---|
| `"Pending Approver 1"` | New submission | Approver 1 notification email |
| `"Pending Approver 2"` | Approve action at Step 1 | Approver 2 notification email + intermediate emails (gap) |
| `"Pending Approver 3"` | Approve action at Step 2 | Approver 3 notification email + intermediate emails (gap) |
| `"Fully Approved"` | Approve action at final step | Final approver + requestor success emails |
| `"Declined"` | Decline action (any step) | Decline confirmation + requestor decline emails |
| `"Returned to Requestor"` | Return action (any step) | Return confirmation + requestor return emails |

> **Removed:** `"Syncing Files"` — no longer needed under the new attachment flow.

### 3.3 Step value reference

| Step | Meaning |
|------|---------|
| `0` | Returned to requestor (awaiting resubmit) |
| `1` | Pending Approver 1 |
| `2` | Pending Approver 2 |
| `3` | Pending Approver 3 |
| — | `"Fully Approved"` / `"Declined"` are terminal Status values, not Step |

---

## 4. Data Structure

The app has **3 tables**, backed by Google Sheets tabs in one workbook.

### 4.1 Relationship diagram

```
Approver_Settings  (lookup table, keyed by Group)
        ▲
        │  Certificate_Requests.Group  ──►  Approver_Settings.Group
        │
Certificate_Requests  (parent / request header, keyed by Request ID)
        ▲
        │  Request_Attachments.Request ID  ──►  Certificate_Requests.Request ID
        │
Request_Attachments  (child / supporting files, keyed by Attachment ID)
```

### 4.2 Table: `Approver_Settings`

Lookup table mapping each department/group to up to three approvers with their designations.

| # | Column | Type | Key | Notes |
|---|--------|------|-----|-------|
| 1 | `Group` | Text | **KEY** | Department/group identifier |
| 2 | `Approver 1` | Email | – | Required |
| 3 | `App 1 Designation` | Text | – | Job title of Approver 1 |
| 4 | `Approver 2` | Email | – | Optional — leave blank if group has only one approver |
| 5 | `App 2 Designation` | Text | – | Optional |
| 6 | `Approver 3` | Email | – | Optional |
| 7 | `App 3 Designation` | Text | – | Optional |

**Current state:** All 5 configured groups only have Approver 1 filled. Approvers 2 and 3 are blank across the board. The system handles this gracefully — requests skip null approvers and auto-advance to terminal states.

### 4.3 Table: `Certificate_Requests`

Main request/approval header. **31 columns total.**

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `Request ID` | Text | **KEY** — 3-character unique ID |
| 2 | `Control Number` | Text | Human-readable ID, e.g. `EC-2026-00001-A3F` |
| 3 | `Status` | Text | Workflow state — drives all routing |
| 4 | `Step` | Number | Workflow counter (0/1/2/3) |
| 5 | `Date of Filing` | Date | Set on submit |
| 6 | `Project Title` | LongText | LABEL column |
| 7 | `Requestor` | Email | Auto-captured from session |
| 8 | `Requestor's Designation` | Text | |
| 9 | `Group` | Text | **Foreign key** to Approver_Settings.Group |
| 10 | `Accountable Person` | Text | |
| 11 | `Department` | Text | |
| 12 | `Location` | Text | |
| 13 | `PC Name` | Text | |
| 14 | `PRISM` | Text | Optional |
| 15 | `Purchase Order` | Text | |
| 16 | `IHelp Number` | Text | Optional |
| 17 | `Product Type` | Enum | |
| 18 | `Product Name` | Text | |
| 19 | `Type of Purchase` | Enum | |
| 20 | `Type of License` | Text | e.g., "3-year Subscription" |
| 21 | `Contract Start Date` | Date | |
| 22 | `Contract End Date` | Date | |
| 23 | `Supplier Name` | Text | |
| 24 | `Requestor's Remark` | LongText | Purpose of request |
| 25 | `Approver 1's Remark` | LongText | Filled by Approver 1 when actioning |
| 26 | `Approver 2's Remark` | LongText | Filled by Approver 2 when actioning |
| 27 | `Approver 3's Remark` | LongText | Filled by Approver 3 when actioning |
| 28 | `Expected_Attachments` | Number | Legacy field — to be deprecated in attachment flow redesign |
| 29 | `App1_Date` | DateTime | Timestamp of Approver 1's action |
| 30 | `App2_Date` | DateTime | Timestamp of Approver 2's action |
| 31 | `App3_Date` | DateTime | Timestamp of Approver 3's action |

**Note on `_RowNumber`:** AppSheet listed this as Column 1. It does NOT exist in the actual Sheet — it was an AppSheet internal value. Apps Script does not reference it.

### 4.4 Table: `Request_Attachments`

Child table for files attached to a request. **5 columns total.**

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `Attachment ID` | Text | **KEY** — unique per file |
| 2 | `Request ID` | Text | **Foreign key** to Certificate_Requests |
| 3 | `File` | Text | Google Drive file ID (post-Phase 8) |
| 4 | `File_Link` | Url | Google Drive shareable link (post-Phase 8) |
| 5 | `Description` | LongText | Human-readable label, e.g. "Supplier Quotation" |

### 4.5 Virtual columns (computed by Apps Script, not stored in Sheets)

| Column | Computed by | Replaces AppSheet |
|---|---|---|
| `Current Approver` | `getCurrentApprover(step, group)` | Virtual IFS formula |
| Attachments list per request | `getAttachmentsForRequest(requestId)` | `REF_ROWS()` |
| Attachment count per request | `countAttachments(requestId)` | `COUNT([Related Request_Attachments])` |
| File hyperlinks in emails | Inline template literal | `HYPERLINK()` and `Description_Link` |

---

## 5. Email Notifications

### 5.1 Email matrix — what should fire on each event

| Event | Approver who acted | Other approvers | Requestor |
|---|---|---|---|
| Submit → Pending Approver 1 | — | Approver 1 (notification) | — |
| Approve at Step 1 → Pending Approver 2 | ✉ confirmation **[GAP]** | Approver 2 (notification) | ✉ progress update **[GAP]** |
| Approve at Step 2 → Pending Approver 3 | ✉ confirmation **[GAP]** | Approver 3 (notification) | ✉ progress update **[GAP]** |
| Approve at final step → Fully Approved | ✉ final confirmation | — | ✉ success notification with COC attached |
| Decline (any step) | ✉ confirmation | — | ✉ decline notice with reason |
| Return (any step) | ✉ confirmation | — | ✉ return notice with reason + edit link |

### 5.2 Implementation status (as of testing)

| Email | Status |
|---|---|
| Notification to next approver | ✅ Implemented (`sendApprovalRequest`) |
| Confirmation to declining approver | ✅ Implemented (`sendDeclineToApprover`) |
| Decline notice to requestor | ✅ Implemented (`sendDeclineToRequestor`) |
| Confirmation to returning approver | ✅ Implemented (`sendReturnConfirmToApprover`) |
| Return notice to requestor | ✅ Implemented (`sendReturnToRequestor`) |
| Final confirmation to last approver | ✅ Implemented (`sendFullyApprovedToApprover`) |
| Success notification to requestor | ✅ Implemented (`sendFullyApprovedToRequestor`) |
| **Confirmation to intermediate approver** | ❌ **GAP — not implemented** |
| **Progress update to requestor** | ❌ **GAP — not implemented** |

---

## 6. Roles & Visibility

### 6.1 Role detection

`detectRole(email)` queries `Approver_Settings`:
- If email appears as Approver 1, 2, or 3 in any group → returns `"approver"`
- Otherwise → returns `"requestor"`

### 6.2 Approver visibility rules

**Implemented correctly:** Approvers only see requests where they are the **current** approver based on Step.

- Step = 1 → only Approver 1 sees the request as pending
- Step = 2 → only Approver 2 sees it (Approver 1 sees it as already-actioned history if such a view existed)
- Step = 3 → only Approver 3 sees it

Backed by `getPendingApprovals()` filter: `getCurrentApprover(step, group) === email`

### 6.3 Action visibility

| Action | Visible to |
|---|---|
| Approve / Decline / Return | Only the current step's approver |
| Resubmit | Only the requestor, only when Status = "Returned to Requestor" |
| Submit new request | Anyone (approvers can also be requestors) |

---

## 7. Known Gaps & Pending Work

### 7.1 Implementation gaps

| # | Gap | Severity | Plan |
|---|---|---|---|
| 1 | `Accountable Person` field not displaying on RequestDetail / ReviewDetail | Medium | Field name mismatch — investigate during cleanup pass |
| 2 | Contract Start/End dates display time component (e.g., "03:00 PM") | Low | Format as date-only in render helpers |
| 3 | Intermediate approver confirmation email not sent | **Medium** | Add `sendApproveConfirmation()` to Emails.js + wire in handleApprove |
| 4 | Requestor progress update email not sent after each approver acts | **Medium** | Add `sendProgressUpdateToRequestor()` to Emails.js + wire in handleApprove |
| 5 | No approver history view (already-actioned requests) | Low | Add `getMyActionedRequests()` + history tab |

### 7.2 Architecture changes pending

| # | Item | Phase | Status |
|---|---|---|---|
| 6 | Replace post-submit attachment upload with mandatory inline upload | Phase 8 | ✅ Done — submit-time upload-first, private files, gated serving |
| 7 | Define required-documents matrix per Product Type with supervisor | Phase 8 | ✅ Resolved — "basta ≥1 file," no per-type matrix needed |
| 8 | Drop `"Syncing Files"` status + sync-finisher logic | Phase 8 | ✅ Done — deprecated-dormant (legacy code kept but off the live path) |
| 9 | Google Drive integration for attachment storage (private + gated) | Phase 8 | ✅ Done — `downloadAttachment()` identity-gated; no bearer links |
| 10 | Replace placeholder Miga images with finalized mascot PNGs | Phase 12 | ⏳ Pending licensed/transparent art — pure drop-in re-encode |

### 7.3 Known schema design debt (post-go-live refactor)

`Certificate_Requests` has 35 columns that conflate three separate concerns. This works today but carries debt that will compound over time.

**The core problem — approval state as a repeating group:**

| Concern | Columns | Problem |
|---|---|---|
| Request core (project, requestor, product, contract…) | 1–24 | ✅ Fine — one entity |
| Approval state (App1/2/3_Date, App1/2/3_Remark, Step, Status) | 25–31 + CR.STATUS/STEP | ❌ One-to-many relationship flattened into fixed columns |
| Resubmit/audit (Resubmit_Count, History, Previous_Approvals, Last_Action_By) | 32–35 | ⚠️ Mixed-in audit data, some cleared on resubmit |

**The fix — extract approval state into an append-only `Approvals` table:**

```
Approvals: request_id | step | approver | decision | remark | timestamp
```

One row per action, never cleared, never overwritten. This single change would:
1. **Remove ~8 columns** from `Certificate_Requests` (App1/2/3 date+remark, Previous_Approvals, Last_Action_By).
2. **Lift the hard 3-approver cap** — N approvers, free.
3. **Deliver Phase 11 (Audit Log) for free** — the append-only `Approvals` table IS the audit timeline. Same instinct as ChainCert's `LogVerification` / `LogIssuerStatusChange` — Sheet rows don't give you an audit log; you have to write one explicitly.
4. **Fix resubmit data loss** — approval history no longer cleared each cycle.

`Request_Attachments` is already normalized (correct). `Approver_Settings` has the same flat-columns smell (`Approver_1/2/3`) but is low-stakes.

**Why not now:** massive regression surface (every getter, `Approvals.js`, emails, the trigger, frontend approval-chain rendering, and column-contract docs all assume the flat layout). Wrong timing for a working, nearly-deployed system. Do this:
- When a group needs **more than 3 approvers**.
- When a genuine **audit/compliance requirement** lands (build `Approvals` table *instead of* a bolt-on audit log).
- When the resubmit history loss actually hurts someone.

Until then: note it, don't pay it down. See `ROADMAP.md` for the post-go-live entry.

### 7.4 Open questions for supervisor

1. Was the AppSheet version actually live or just pilot-tested? (Determines rollout urgency.)
2. What are the standard required documents per request type?
3. Should the return flow be hard-return (current) or light-return (back to the returner)?
4. Should intermediate approver and requestor progress emails be added? (Gaps #3 and #4)
5. Is an approver history view needed at launch or can it ship later?

---

## 8. AppSheet Reference (Historical)

This section documents the original AppSheet implementation. Useful for verifying behavior parity but no longer the target state.

### 8.1 The 5 AppSheet bots

| Bot | Watched | Condition | What it did |
|---|---|---|---|
| Next Approver Bot | `Certificate_Requests` | Status changed to contain "Pending Approver" AND attachments met | Sent approval email to Current Approver |
| Decline Notification Bot | `Certificate_Requests` | Status changed to "Declined" | Sent 2 emails: confirmation + decline notice |
| Fully Approved Notification Bot | `Certificate_Requests` | Status changed to "Fully Approved" | Sent 2 emails: final confirmation + success notice |
| Return Notification Bot | `Certificate_Requests` | Status changed to starts-with "Returned to" | Sent 2 emails: return notice + confirmation |
| Sync Finisher Bot | `Request_Attachments` | New attachment + count ≥ Expected_Attachments | Flipped parent Status to "Pending Approver 1" |

All 5 bots have been replaced by a single Apps Script `onSheetChange()` handler in `Triggers.js` that routes by Status value. The Sync Finisher equivalent will be removed as part of the attachment redesign in Phase 8.

### 8.2 AppSheet email templates

The original email body templates are preserved verbatim in `Emails.js` as JavaScript template literals, with AppSheet's `<<[ColumnName]>>` syntax replaced by `${variable}` interpolation and `<<If: ISNOTBLANK(...)>>` blocks replaced by JS conditionals.

### 8.3 AppSheet actions

The 4 user-facing actions (Approve, Decline, Return Request, Resubmit Request) and the 1 hidden action (Set Status to Pending Approver) have been ported to JavaScript functions in `Approvals.js`. The hidden Sync Finisher action will be removed in Phase 8 along with the Syncing Files status.

### 8.4 AppSheet security rules

| Rule | Apps Script equivalent |
|---|---|
| Approver email visibility (admin only) | Handled by role-based view rendering in `WebApp.js` |
| Requestor field lock after submit | Handled by `getRequestDetail` returning read-only DTOs |
| Remark editability per approver step | Handled by action gating in `handleApprove/Decline/Return` |
| Action visibility (current approver only) | Handled by `getPendingApprovals` filter and frontend route guards |
| Resubmit visibility | Handled in frontend `Dashboard.html` render logic |

---

## 9. Migration Notes — Apps Script Equivalents

### 9.1 AppSheet bots → Apps Script triggers

All 5 bots collapse into one `onSheetChange()` handler in `backend/Triggers.js`:

```js
function onSheetChange(e) {
  const sheet     = e.source.getActiveSheet();
  const sheetName = sheet.getName();

  if (sheetName === SHEET_NAMES.CERTIFICATE_REQUESTS) {
    handleCertificateRequestChange(e, sheet);
  }
  if (sheetName === SHEET_NAMES.REQUEST_ATTACHMENTS) {
    handleAttachmentChange(e, sheet);  // To be removed in Phase 8
  }
}
```

### 9.2 AppSheet actions → JavaScript functions

| AppSheet Action | Apps Script function | File |
|---|---|---|
| Approve | `approve(requestId)` + `handleApprove()` | `Approvals.js` + `WebApp.js` |
| Decline | `decline(requestId, remark)` + `handleDecline()` | `Approvals.js` + `WebApp.js` |
| Return Request | `returnRequest(requestId, remark)` + `handleReturn()` | `Approvals.js` + `WebApp.js` |
| Resubmit Request | `resubmit(requestId)` + `handleResubmit()` | `Approvals.js` + `WebApp.js` |

### 9.3 Ref column lookups → manual sheet lookups

| AppSheet | Apps Script |
|---|---|
| `[Group].[Approver 1]` | `getApprovers(group).approver1` |
| `[Current Approver]` (virtual IFS) | `getCurrentApprover(step, group)` |
| `[Related Request_Attachments]` | `getAttachmentsForRequest(requestId)` |
| `COUNT([Related Request_Attachments])` | `countAttachments(requestId)` |

### 9.4 Email template syntax conversion

```js
// AppSheet: "New request by <<[Requestor]>> from <<[Group]>>"
// Apps Script:
const subject = `[COC] New E-Certificate Request from ${requestor} from ${group}: "${projectTitle}" (${controlNumber})`;
```

`<<If: ISNOTBLANK([X])>>...<<EndIf>>` blocks become standard JS conditionals or template-literal expressions.

### 9.5 Timezone handling

AppSheet uses `UTCNOW() + "008:00:00"` for Philippine time (UTC+8). Apps Script equivalent:

```js
function formatPHTime(date) {
  return Utilities.formatDate(date, "Asia/Manila", "MMMM dd, yyyy hh:mm:ss a");
}
```

### 9.6 Certificate of Completion (COC) attachment

The Fully Approved email attaches a COC file. Implementation plan:
1. A Google Docs template with placeholders
2. Apps Script copies the template, fills in values via `DocumentApp`
3. Exports as PDF blob via `DriveApp.createFile().getAs("application/pdf")`
4. Passes the blob to `GmailApp.sendEmail()` via the `attachments` option

```js
GmailApp.sendEmail(requestorEmail, subject, body, {
  attachments: [pdfBlob],
  name: "E-Certificate Automation"
});
```

### 9.7 Type coercion gotcha

Apps Script reads numeric-looking strings as `Number` from Sheets. All Request ID and Attachment ID comparisons use `String()` coercion to prevent type mismatch:

```js
function getRowNumberByRequestId(requestId) {
  const target = String(requestId);
  // ...
  if (String(allData[i][CR.REQUEST_ID - 1]) === target) { ... }
}
```

Request ID and Control Number columns in the Sheet must be formatted as **Plain Text** to prevent auto-conversion.

---

*Last updated: reflecting design discussions and testing findings as of Phase 7 completion. Living document — update as gaps close and architecture evolves.*