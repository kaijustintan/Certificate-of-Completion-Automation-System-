# E-Certificate Automation — Architecture Extraction

**Source app:** AppSheet app `E-Certificate Automation`  
**Backend:** Google Sheets (one workbook, three sheet tabs)  
**Target:** Migration to Google Apps Script (clasp + VS Code + GitHub)  
**Document purpose:** Foundation reference for the Apps Script port. Every real data value (emails, names, groups, request IDs, suppliers, PO numbers, project titles, contract amounts) has been replaced with placeholder tokens. Only formulas, state strings, and structural names are reproduced verbatim.

> **Sanitization notes**
> - All real approver emails → `[approver1@company.com]`, etc.
> - All real group/department names → `[Department Group N]`
> - All real example data (request IDs, control numbers, project titles, supplier names, PO numbers, contract dates, requestor emails) → `[…]` placeholders
> - AppSheet expression literals (e.g., `"Pending Approver 1"`, `"Returned to Requestor"`, `"Fully Approved"`) are preserved verbatim — those are state strings, not user data

---

## Table of Contents

1. [Data Structure](#1-data-structure)
2. [Automation / Bots](#2-automation--bots)
3. [Actions](#3-actions)
4. [Views](#4-views)
5. [Slices](#5-slices)
6. [Security Rules](#6-security-rules)
7. [Workflow Logic Summary](#7-workflow-logic-summary)
8. [Migration Notes — Apps Script Equivalents](#8-migration-notes--apps-script-equivalents)

---

## 1. Data Structure

The app has **3 tables**, all backed by Google Sheets tabs in the same workbook.

### 1.1 Relationship Diagram

```
Approver_Settings  (lookup table, keyed by Group)
        ▲
        │  Ref: Certificate_Requests.Group  ──►  Approver_Settings.Group
        │
Certificate_Requests  (parent / request header, keyed by Request ID)
        ▲
        │  Ref: Request_Attachments.Request ID  ──►  Certificate_Requests.Request ID
        │
Request_Attachments  (child / supporting files, keyed by Attachment ID)
```

Virtual back-references (computed by AppSheet, not stored in Sheets):
- `Approver_Settings.[Related Certificate_Requests]` → list of child Certificate_Requests rows
- `Certificate_Requests.[Related Request_Attachments]` → list of child Request_Attachments rows

---

### 1.2 Table: `Approver_Settings`

Lookup table that maps a department/group to up to three approvers with their designations.

| # | Column | Type | Key | Virtual / App Formula | Notes |
|---|--------|------|-----|-----------------------|-------|
| 1 | `_RowNumber` | Number | – | – | System column |
| 2 | `Group` | Text | **KEY + LABEL** | – | Department/group identifier |
| 3 | `Approver 1` | Email | – | – | PII. Show only if `USERROLE() = "Admin"` |
| 4 | `App 1 Designation` | Text | – | – | Required if `ISNOTBLANK([Approver 1])` |
| 5 | `Approver 2` | Email | – | – | PII. Show only if `USERROLE() = "Admin"` |
| 6 | `App 2 Designation` | Text | – | – | Required if `ISNOTBLANK([Approver 2])` |
| 7 | `Approver 3` | Email | – | – | PII. Show only if `USERROLE() = "Admin"` |
| 8 | `App 3 Designation` | Text | – | – | Required if `ISNOTBLANK([Approver 3])` |
| 9 | `Related Certificate_Requests` | List | – | `REF_ROWS("Certificate_Requests", "Group")` | **Virtual** reverse-reference |

> Live rows contain real department names `[Department Group 1…N]` and real approver emails `[approver1@company.com]`. Not reproduced here.

---

### 1.3 Table: `Certificate_Requests`

Main request/approval header. **34 columns total** (33 user + `_RowNumber`).

| # | Column | Type | Key | Virtual / App Formula | Initial Value | Notes |
|---|--------|------|-----|-----------------------|---------------|-------|
| 1 | `_RowNumber` | Number | – | – | – | System |
| 2 | `Request ID` | Text | **KEY** | – | `LEFT(UNIQUEID(), 3)` | 3-char unique tail |
| 3 | `Control Number` | Text | – | – | `CONCATENATE("EC-", YEAR(TODAY()), "-", RIGHT("00000" & (COUNT(Certificate_Requests[Request ID]) + 1), 5), "-", [Request ID])` | Human-readable ID, set on creation |
| 4 | `Status` | Text | – | – | `IF([Expected_Attachments] > 0, "Syncing Files", "Pending Approver 1")` | **Workflow state driver** |
| 5 | `Step` | Number | – | – | `1` | 0=returned, 1/2/3=approver step, terminal="Fully Approved"/"Declined" |
| 6 | `Date of Filing` | Date | – | – | `TODAY()` | Editable only by requestor on initial submit or resubmit |
| 7 | `Project Title` | LongText | – | – | – | **LABEL** column |
| 8 | `Requestor` | Email | – | – | `USEREMAIL()` | Auto-captured, not editable |
| 9 | `Requestor's Designation` | Text | – | – | – | |
| 10 | `Group` | Ref → `Approver_Settings` | – | – | – | **Foreign key** to Approver_Settings.Group |
| 11 | `Accountable Person` | Text | – | – | – | |
| 12 | `Department` | Text | – | – | – | |
| 13 | `Location` | Text | – | – | – | |
| 14 | `PC Name` | Text | – | – | – | Required |
| 15 | `PRISM` | Text | – | – | `""` | Optional |
| 16 | `Purchase Order` | Text | – | – | `""` | Display name: "Purchase Order (PO)" |
| 17 | `IHelp Number` | Text | – | – | `""` | Optional |
| 18 | `Product Type` | Enum | – | – | – | Required |
| 19 | `Product Name` | Text | – | – | – | Required |
| 20 | `Type of Purchase` | Enum | – | – | – | Required |
| 21 | `Type of License` | Text | – | – | – | e.g., "3-year Subscription" |
| 22 | `Contract Start Date` | Date | – | – | `TODAY()` | |
| 23 | `Contract End Date` | Date | – | – | – | Required |
| 24 | `Supplier Name` | Text | – | – | – | Required |
| 25 | `Requestor's Remark` | LongText | – | – | `""` | Display name: "Requestor's Remark (Purpose of Issuance of Certificate)" |
| 26 | `Approver 1's Remark` | LongText | – | – | `""` | Editable only by Approver 1 when Status = "Pending Approver 1" |
| 27 | `Approver 2's Remark` | LongText | – | – | `""` | Editable only by Approver 2 when Status = "Pending Approver 2" |
| 28 | `Approver 3's Remark` | LongText | – | – | `""` | Editable only by Approver 3 when Status = "Pending Approver 3" |
| 29 | `Expected_Attachments` | Number | – | `COUNT([Related Request_Attachments])` | – | **Virtual**. Display name: "Attachment Count" |
| 30 | `App1_Date` | DateTime | – | – | – | Set by Approve action at Step 1 |
| 31 | `App2_Date` | DateTime | – | – | – | Set by Approve action at Step 2 |
| 32 | `App3_Date` | DateTime | – | – | – | Set by Approve action at Step 3 |
| 33 | `Current Approver` | Email | – | `IFS([Step]=0, "Returned to Requestor", [Step]=1, [Group].[Approver 1], [Step]=2, [Group].[Approver 2], [Step]=3, [Group].[Approver 3], TRUE, "Approved")` | – | **Virtual** — drives email routing |
| 34 | `Related Request_Attachments` | List | – | `REF_ROWS("Request_Attachments", "Request ID")` | – | **Virtual** reverse-reference. Display name: "Upload Supporting Documents" |

**Edit rule pattern (columns 6–25):** Most request fields are editable only when:
```
AND(
  USEREMAIL() = [Requestor],
  OR(CONTEXT("ViewType") = "Form", [Status] = "Returned to Requestor")
)
```
Meaning: a requestor can only edit fields during initial submission (Form context) or after a return. Once routed to approvers, the fields lock.

**Step value reference:**

| Step | Meaning |
|------|---------|
| `0` | Returned to requestor |
| `1` | Pending Approver 1 |
| `2` | Pending Approver 2 |
| `3` | Pending Approver 3 |
| — | `"Fully Approved"` (Status, not Step) |
| — | `"Declined"` (Status, not Step) |

---

### 1.4 Table: `Request_Attachments`

Child table for files attached to a request. **9 columns total**.

| # | Column | Type | Key | Virtual / App Formula | Notes |
|---|--------|------|-----|-----------------------|-------|
| 1 | `_RowNumber` | Number | – | – | System |
| 2 | `Attachment ID` | Text | **KEY** | – | Initial value: `UNIQUEID()` |
| 3 | `Request ID` | Ref → `Certificate_Requests` | – | – | **Foreign key** to parent request |
| 4 | `File` | File | – | – | The uploaded file blob |
| 5 | `File_Link` | Url | – | – | Direct URL to the file |
| 6 | `Description` | LongText | – | – | **LABEL** column. Display name: "Attachment Label" |
| 7 | `Related Request_Attachments` | List | – | `REF_ROWS("Request_Attachments", "Request ID")` | **Virtual** self-referential helper |
| 8 | `File_Hyperlink` | Url | – | `HYPERLINK([File_Link], [Description])` | **Virtual** |
| 9 | `Description_Link` | Text | – | `CONCATENATE("<a href=""", "https://www.appsheet.com/template/gettablefileurl?appName=…&tableName=Request_Attachments&fileName=", ENCODEURL([File]), """>", [Description], "</a>")` | **Virtual** — used in email templates to render a clickable filename |

> Note: `Description_Link` embeds the AppSheet `appName` and `appId` in the URL. When migrating to Apps Script, replace with a Google Drive share link or a web app URL pointing to the file.

---

## 2. Automation / Bots

There are **5 bots** watching two tables.

---

### 2.1 Bot: `Next Approver Bot`

| Property | Value |
|---|---|
| Watches | `Certificate_Requests` |
| Event name | `Event_NextApprover` |
| Trigger | Data change — **Adds + Updates** |
| Condition | `AND([_THISROW_BEFORE].[Status] <> [_THISROW_AFTER].[Status], CONTAINS([Status], "Pending Approver"), OR([Expected_Attachments] = 0, COUNT([Related Request_Attachments]) >= [Expected_Attachments]))` |
| Process | `Process_SendApprovalRequest` |

**Email step — `Step_Update_To_Requestor`**

| Field | Value |
|---|---|
| To | `[Current Approver]` |
| Subject | `[COC] New E-Certificate Request from <<[Requestor]>> from <<[Group]>> : "<<[Project Title]>>"(<<[Control Number]>>)` |

**Body:**
```
Hi,

You have a new e-certificate request by <<[Requestor]>> from the <<[Group]>> department
titled "<<[Project Title]>>" that requires your review and action.

SUPPORTING DOCUMENTS:
<<Start: [Related Request_Attachments]>>
‣ <<[Description_Link]>>
<<End>>
(You can also copy and paste the link above into your browser if you cannot click the link directly.)

APPROVAL PROGRESS:
<<If: ISNOTBLANK([App1_Date])>>Approver 1: <<[Group].[Approver 1]>>
Approved Date: <<TEXT([App1_Date], "MMMM dd, yyyy hh:mm:ss AM/PM")>>
<<EndIf>><<If: ISNOTBLANK([App2_Date])>>
Approver 2: <<[Group].[Approver 2]>>
Approved Date: <<TEXT([App2_Date], "MMMM dd, yyyy hh:mm:ss AM/PM")>>
<<EndIf>><<If: ISNOTBLANK([App3_Date])>>
Approver 3: <<[Group].[Approver 3]>>
Approved Date: <<TEXT([App3_Date], "MMMM dd, yyyy hh:mm:ss AM/PM")>>
<<EndIf>>

Please find the Request Details from the interactive card below.
You can also Approve, Decline, or Return this request directly from the interactive card.
```

---

### 2.2 Bot: `Decline Notification Bot`

| Property | Value |
|---|---|
| Watches | `Certificate_Requests` |
| Event name | `Event_RequestDeclined` |
| Trigger | Data change — **Updates** |
| Condition | `AND([_THISROW_BEFORE].[Status] <> "Declined", [Status] = "Declined")` |

**Step 1 — `Confirm_Decline_To_Approver`** (to the approver who declined)

| Field | Value |
|---|---|
| To | `USEREMAIL()` |
| Subject | `[COC] DECLINE CONFIRMATION: You have declined "<<[Project Title]>>" (<<[Control Number]>>)` |

```
Hello,

This is a confirmation that you have successfully Declined the request:
"<<[Project Title]>>" (<<[Control Number]>>).

Date of Action: <<TEXT(UTCNOW() + "008:00:00", "MM-DD-YYYY HH:mm")>>

The requestor has been notified that this request is now closed and cannot be resubmitted.
```

**Step 2 — `Process_NotifyDecline`** (to the requestor)

| Field | Value |
|---|---|
| To | `[Requestor]` |
| Subject | `[COC] DECLINED: "<<[Project Title]>>" (<<[Control Number]>>)` |

```
Hello,

We regret to inform you that your request for "<<[Project Title]>>"
(<<[Control Number]>>) has been Declined.

Reason for Decline: <<IFS(
  ISNOTBLANK([Approver 3's Remark]), [Approver 3's Remark],
  ISNOTBLANK([Approver 2's Remark]), [Approver 2's Remark],
  TRUE, [Approver 1's Remark]
)>>
Actioned by: <<USEREMAIL()>>
Date: <<TEXT(UTCNOW() + "008:00:00", "MMMM dd, yyyy hh:mm:ss AM/PM")>>

Note: If you would like to try again, you must create a brand new request.
```

---

### 2.3 Bot: `Fully Approved Notification Bot`

| Property | Value |
|---|---|
| Watches | `Certificate_Requests` |
| Event name | `Event_FullyApproved` |
| Trigger | Data change — **Updates** |
| Condition | `AND([_THISROW_BEFORE].[Status] <> "Fully Approved", [Status] = "Fully Approved")` |

**Step 1 — `Step_Final_Receipt_To_Approver`** (to the last approver)

| Field | Value |
|---|---|
| To | `IFS(ISNOTBLANK([Group].[Approver 3]), [Group].[Approver 3], ISNOTBLANK([Group].[Approver 2]), [Group].[Approver 2], TRUE, [Group].[Approver 1])` |
| Subject | `[COC] Final Confirmation: You have Approved "<<[Project Title]>>" (<<[Control Number]>>)` |

```
Hi,

This is a confirmation that you provided the final approval for "<<[Project Title]>>"
on <<TEXT(IFS(
  ISNOTBLANK([App3_Date]), [App3_Date],
  ISNOTBLANK([App2_Date]), [App2_Date],
  TRUE, [App1_Date]
), "MMMM dd, yyyy hh:mm:ss AM/PM")>>.

The request is now fully approved, and the requestor has been notified. Thank you!
```

**Step 2 — `Process_Notify_Success`** (to the requestor, with Certificate of Completion attached)

| Field | Value |
|---|---|
| To | `[Requestor]` |
| Subject | `[COC] Approved: Your E-Certificate for "<<[Project Title]>>" (<<[Control Number]>>) is ready and fully approved!` |

```
Congratulations!

Your request for "<<[Project Title]>>" (<<[Control Number]>>) has been fully approved.

FINAL SIGNATORY LOG
<<If: ISNOTBLANK([App1_Date])>>Approver 1: <<[Group].[Approver 1]>> | Approved: <<TEXT([App1_Date], "MMMM dd, yyyy hh:mm:ss AM/PM")>>
<<EndIf>><<If: ISNOTBLANK([App2_Date])>>Approver 2: <<[Group].[Approver 2]>> | Approved: <<TEXT([App2_Date], "MMMM dd, yyyy hh:mm:ss AM/PM")>>
<<EndIf>><<If: ISNOTBLANK([App3_Date])>>Approver 3: <<[Group].[Approver 3]>> | Approved: <<TEXT([App3_Date], "MMMM dd, yyyy hh:mm:ss AM/PM")>>
<<EndIf>>

Your Certificate of Completion is attached to this email.
Thank you for using the E-Certificate Automation system!
```

---

### 2.4 Bot: `Return Notification Bot`

| Property | Value |
|---|---|
| Watches | `Certificate_Requests` |
| Event name | `Event_RequestReturned` |
| Trigger | Data change — **Updates** |
| Condition | `AND([_THISROW_BEFORE].[Status] <> [_THISROW_AFTER].[Status], STARTSWITH([Status], "Returned to"))` |

**Step 1 — `Process_NotifyReturn`** (to the recipient of the return)

| Field | Value |
|---|---|
| To | `IFS([Status] = "Returned to Requestor", [Requestor], STARTSWITH([Status], "Returned to "), SUBSTITUTE([Status], "Returned to ", ""), TRUE, [Requestor])` |
| Subject | `[COC] REQUEST RETURNED: "<<[Project Title]>>" (<<[Control Number]>>) has been returned to you for updates` |

```
Hello,

Your request, "<<[Project Title]>>", with the control number <<[Control Number]>>
has been sent back to you for updates.

Returned by: <<USEREMAIL()>>
Return Date: <<TEXT(UTCNOW() + "008:00:00", "MMMM dd, yyyy hh:mm:ss AM/PM")>>
Reason for Return: <<IFS(
  ISNOTBLANK([Approver 3's Remark]), [Approver 3's Remark],
  ISNOTBLANK([Approver 2's Remark]), [Approver 2's Remark],
  TRUE, [Approver 1's Remark]
)>>

Next Step:
Please review the comments provided above. You must click the link below to open the
official request form where you can make the necessary changes and resubmit for approval.

CLICK HERE TO EDIT AND RESUBMIT YOUR REQUEST:
<<CONCATENATE("https://www.appsheet.com/start/[APP_ID]&mode=edit")>>
```

**Step 2 — `Confirm_Return_To_Approver`** (confirmation to the approver who returned it)

| Field | Value |
|---|---|
| To | `USEREMAIL()` |
| Subject | `[COC] RETURN CONFIRMATION: "<<[Project Title]>>" (<<[Control Number]>>) has been Returned` |

```
Hello,

This is a confirmation that you have successfully RETURNED the following request
for further updates.

Returned To: <<[Requestor]>>
Date of Action: <<TEXT(UTCNOW() + "008:00:00", "MM-DD-YYYY HH:mm")>>

The recipient has been notified to review your comments and take the necessary next steps.
```

---

### 2.5 Bot: `Sync Finisher Bot`

| Property | Value |
|---|---|
| Watches | `Request_Attachments` |
| Event name | `Event_ConfirmAttachments` |
| Trigger | Data change — **Adds only** |
| Condition | `COUNT([Request ID].[Related Request_Attachments]) >= [Request ID].[Expected_Attachments]` |
| Process | `Process_UpdateParentStatus` |

**Action: Run action on referenced rows**

| Field | Value |
|---|---|
| Referenced table | `Certificate_Requests` |
| Referenced rows | `LIST([Request ID])` |
| Action to run | `Set Status to Pending Approver` |

**Purpose:** When the last required attachment is uploaded, flip the parent request from `"Syncing Files"` → `"Pending Approver 1"`, which in turn triggers the Next Approver Bot.

---

## 3. Actions

### 3.1 `Approver_Settings` Actions (6)

| Action | Type | Condition | Position |
|---|---|---|---|
| `Add` | Open add form | — | System |
| `Edit` | Open edit form | — | System |
| `Delete` | Delete row | — | Prominent |
| `Compose Email (Approver 1)` | External: compose email | `NOT(ISBLANK([Approver 1]))` | Inline |
| `Compose Email (Approver 2)` | External: compose email | `NOT(ISBLANK([Approver 2]))` | Inline |
| `Compose Email (Approver 3)` | External: compose email | `NOT(ISBLANK([Approver 3]))` | Inline |

---

### 3.2 `Certificate_Requests` Actions (11)

| Action | Type | Columns Set | Values Set | Condition | Confirmation | Position |
|---|---|---|---|---|---|---|
| `Add` | Open add form | — | — | — | — | System |
| `Edit` | Open edit form | — | — | — | — | System |
| `Delete` | Delete row | — | — | — | — | System |
| `Approve` | Set column values | `Step`, `App1_Date` / `App2_Date` / `App3_Date`, `Status` | `Step = [Step] + 1`; date = `NOW()`; Status = next pending or "Fully Approved" | `USEREMAIL() = [Current Approver]` | Yes | Prominent |
| `Decline` | Set column values | `Status`, `Step` | `Status = "Declined"` | `USEREMAIL() = [Current Approver]` | Yes | Prominent |
| `Return Request` | Set column values | `Step`, `Status` | `Step = 0`, `Status = "Returned to Requestor"` | `USEREMAIL() = [Current Approver]` | Yes | Prominent |
| `Resubmit Request` | Set column values | `Step`, `App1_Date`, `App2_Date`, `App3_Date`, `Approver 1's Remark`, `Approver 2's Remark` | All reset to blank; `Step = 1` | `AND(USEREMAIL() = [Requestor], [Status] = "Returned to Requestor")` | Yes | Prominent |
| `Set Status to Pending Approver` | Set column values | `Step` | `Step = 1` | — | No | **Hidden** — called programmatically by Sync Finisher Bot |
| `Compose Email (Current Approver)` | External: compose email | — | — | `NOT(ISBLANK([Current Approver]))` | — | Inline |
| `Compose Email (Requestor)` | External: compose email | — | — | — | — | Inline |
| `View Ref (Group)` | Navigate to related row | — | — | — | — | Inline |

---

### 3.3 `Request_Attachments` Actions (6)

All system-generated: `Add`, `Edit`, `Delete`, plus standard reference navigation actions for the parent `Certificate_Requests` row.

---

## 4. Views

### 4.1 Primary Navigation Views (user-facing tabs)

| View Name | Type | Source | Intended User |
|---|---|---|---|
| `Approver Settings` | Table | `Approver_Settings` | Admin only |
| `Certificate Requests` | Table | `Certificate_Requests` | All users |

### 4.2 Reference Views (embedded / popup)

| View Name | Type | Source | Purpose |
|---|---|---|---|
| `Return_Form_Slice` | Form | `Return_Form_Slice` (slice of `Certificate_Requests`) | Popup form used when an approver returns a request — shows only the relevant return fields |

### 4.3 System-Generated Views (auto-created by AppSheet)

| Group | Views |
|---|---|
| `Approver_Settings` (2) | Detail view + Edit form |
| `Certificate_Requests` (3) | Detail view + Edit form + inline child list |
| `Request_Attachments` (3) | Detail view + Edit form + inline ref |
| `Return_Form_Slice` (2) | Form + Detail |

---

## 5. Slices

### 5.1 `Return_Form_Slice`

| Property | Value |
|---|---|
| Source table | `Certificate_Requests` |
| Purpose | Filtered view used in the Return popup form — shows only requests in a returned state |
| Row filter | `STARTSWITH([Status], "Returned to")` |
| Columns | Subset of `Certificate_Requests` — only return-relevant fields (Remark fields, Status, Project Title, Control Number) |

---

## 6. Security Rules

| Rule | Detail |
|---|---|
| Approver email visibility | `Approver 1`, `Approver 2`, `Approver 3` columns in `Approver_Settings` are shown only when `USERROLE() = "Admin"` |
| Request field editability | Requestor fields locked after submission — editable only during Form context or when `Status = "Returned to Requestor"` |
| Remark editability | Each approver remark is editable only by the matching approver (`USEREMAIL() = [Group].[Approver N]`) and only while the request is at their step |
| Action visibility | `Approve`, `Decline`, `Return Request` buttons only appear when `USEREMAIL() = [Current Approver]` |
| `Resubmit Request` | Only visible when `USEREMAIL() = [Requestor]` AND `Status = "Returned to Requestor"` |

---

## 7. Workflow Logic Summary

### Full end-to-end flow

```
1. REQUESTOR submits a new Certificate Request
   │
   ├─ If Expected_Attachments > 0
   │      Status = "Syncing Files"
   │      → Requestor uploads files one by one
   │      → On each upload: Sync Finisher Bot checks count
   │      → When count met: runs "Set Status to Pending Approver" action
   │         → Status = "Pending Approver 1"
   │
   └─ If Expected_Attachments = 0
          Status = "Pending Approver 1" immediately (set by Initial Value formula)

2. Next Approver Bot fires (Status contains "Pending Approver")
   → Sends email to [Current Approver] (resolved via IFS on Step)

3. APPROVER 1 reviews
   ├─ Approve  → Step = 2, App1_Date = NOW()
   │              Status = "Pending Approver 2"
   │              → Next Approver Bot fires → emails Approver 2
   │
   ├─ Decline → Status = "Declined"
   │              → Decline Notification Bot fires
   │                 Step 1: confirmation email to Approver 1
   │                 Step 2: decline email to Requestor (request closed, no resubmit)
   │
   └─ Return  → Step = 0, Status = "Returned to Requestor"
                  → Return Notification Bot fires
                     Step 1: return email to Requestor with edit link
                     Step 2: confirmation email to Approver 1

4. REQUESTOR resubmits (if returned)
   → Clicks "Resubmit Request" action
   → Step = 1, App1_Date / App2_Date / App3_Date cleared, remarks cleared
   → Status = "Pending Approver 1"
   → Flow restarts from step 2

5. APPROVER 2 reviews (same options: Approve / Decline / Return)
   ├─ Approve → Step = 3, App2_Date = NOW()
   │             Status = "Pending Approver 3"
   │             → Next Approver Bot fires → emails Approver 3
   │
   ├─ Decline → same Decline flow as above
   └─ Return  → same Return flow as above

6. APPROVER 3 reviews (final approver)
   ├─ Approve → Step = 4 (or Status = "Fully Approved")
   │             App3_Date = NOW()
   │             → Fully Approved Bot fires
   │                Step 1: final confirmation to last approver
   │                Step 2: approval email to Requestor
   │                        with Certificate of Completion attached
   │
   ├─ Decline → same Decline flow
   └─ Return  → same Return flow
```

### State machine (Status values)

| Status Value | Set by | Triggers |
|---|---|---|
| `"Syncing Files"` | Initial value formula (when attachments required) | Nothing — waits for Sync Finisher Bot |
| `"Pending Approver 1"` | Sync Finisher Bot or Initial value (no attachments) | Next Approver Bot |
| `"Pending Approver 2"` | Approve action at Step 1 | Next Approver Bot |
| `"Pending Approver 3"` | Approve action at Step 2 | Next Approver Bot |
| `"Fully Approved"` | Approve action at Step 3 | Fully Approved Notification Bot |
| `"Declined"` | Decline action (any step) | Decline Notification Bot |
| `"Returned to Requestor"` | Return action (any step) | Return Notification Bot |

---

## 8. Migration Notes — Apps Script Equivalents

### Bots → Apps Script triggers

| AppSheet Bot | Apps Script Equivalent |
|---|---|
| Next Approver Bot (on update, status contains "Pending Approver") | Installable `onChange` trigger on the Sheet → check `[Status]` column for "Pending Approver" → `GmailApp.sendEmail()` |
| Decline Notification Bot (status = "Declined") | Same `onChange` trigger → branch on `Status === "Declined"` → two sequential `GmailApp.sendEmail()` calls |
| Fully Approved Notification Bot (status = "Fully Approved") | Same trigger → branch on `Status === "Fully Approved"` → send two emails; attach generated COC PDF via `GmailApp.sendEmail(..., {attachments: [pdfBlob]})` |
| Return Notification Bot (status starts with "Returned to") | Same trigger → `status.startsWith("Returned to")` → two emails |
| Sync Finisher Bot (on attachment row added, count >= expected) | Separate `onChange` trigger on `Request_Attachments` sheet tab → count matching rows → if count met, update parent row Status in `Certificate_Requests` sheet |

### Actions → Apps Script functions

| AppSheet Action | Apps Script Equivalent |
|---|---|
| `Approve` | `function approve(rowIndex)` → `sheet.getRange(row, stepCol).setValue(currentStep + 1)` + set the correct `AppN_Date` cell + update Status |
| `Decline` | `function decline(rowIndex)` → `setValue("Declined")` on Status column |
| `Return Request` | `function returnRequest(rowIndex)` → `setValue(0)` on Step, `setValue("Returned to Requestor")` on Status |
| `Resubmit Request` | `function resubmit(rowIndex)` → reset Step=1, clear App1/2/3_Date, clear Remark fields |
| `Set Status to Pending Approver` | `function setStatusPending(rowIndex)` → `setValue("Pending Approver 1")` on Status (called by Sync Finisher equivalent) |

### Ref column lookups → manual sheet lookups

| AppSheet Ref | Apps Script Equivalent |
|---|---|
| `[Group].[Approver 1]` | Find the row in `Approver_Settings` where Column A = `[Group]` value → read Approver 1 column |
| `[Current Approver]` (virtual IFS) | Replicate the IFS logic in JS: `step===1 ? approver1 : step===2 ? approver2 : ...` |
| `[Related Request_Attachments]` | `attachmentsSheet.getDataRange().getValues().filter(row => row[requestIdCol] === requestId)` |
| `COUNT([Related Request_Attachments])` | `.filter(...).length` |

### Virtual columns → computed in code

| Virtual Column | Compute in Apps Script as |
|---|---|
| `Control Number` | Construct string on row creation: `"EC-" + year + "-" + paddedCount + "-" + requestId` |
| `Current Approver` | Function that reads Step + Group, looks up approver from `Approver_Settings` |
| `Expected_Attachments` | Count rows in `Request_Attachments` sheet where `Request ID` matches |
| `Description_Link` | Replace with Google Drive `getFileById(fileId).getUrl()` wrapped in an HTML anchor |
| `File_Hyperlink` | Same as above |

### Email templates → Apps Script strings

AppSheet's `<<[ColumnName]>>` merge syntax → JavaScript template literals:

```js
// AppSheet template:
// "New request by <<[Requestor]>> from <<[Group]>>"

// Apps Script equivalent:
const subject = `[COC] New E-Certificate Request from ${requestor} from ${group} : "${projectTitle}" (${controlNumber})`;
```

All 5 email templates in Section 2 above should be converted to JS template literal strings. The `<<If: ISNOTBLANK(...)>>...<<EndIf>>` blocks become standard JS `if` conditionals.

### Timezone note

AppSheet uses `UTCNOW() + "008:00:00"` for Philippine time (UTC+8). In Apps Script:

```js
const phTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
const formatted = Utilities.formatDate(phTime, "Asia/Manila", "MMMM dd, yyyy hh:mm:ss a");
```

### File attachment (COC PDF)

The `Fully Approved` bot attaches a "Certificate of Completion" file. In Apps Script this will be:
1. A Google Docs template with placeholders
2. Script copies the template, fills in values, exports as PDF blob
3. PDF blob passed to `GmailApp.sendEmail()` via the `attachments` option

```js
GmailApp.sendEmail(requestorEmail, subject, body, {
  attachments: [pdfBlob],
  name: "E-Certificate Automation"
});
```

---

*Last updated: 2026 — Living document. Update as migration progresses.*
