# Phase 1 — Column Map Reference
**Source file:** `ECertificate_Automation.xlsx`  
**Purpose:** Ground truth for all Apps Script code. Every column referenced in code must use the index numbers from this file — not the ARCHITECTURE.md, not assumptions. This file is the truth.

---

## Important discoveries from the actual file

Before the maps, here are things that matter for your migration:

### 1. `_RowNumber` does NOT exist in the Sheet
The Architecture doc lists it as Column 1. It is not in the real spreadsheet. It's an AppSheet internal system value that never gets written to Sheets. Ignore it entirely in Apps Script.

### 2. `Certificate_Requests` and `Request_Attachments` are currently empty
Zero data rows. The app is set up but hasn't processed any real requests yet. This is actually ideal — clean slate for migration.

### 3. `Approver_Settings` has 5 groups, but only Approver 1 is configured
Approver 2 and Approver 3 are blank (NaN) for all 5 groups. This means the current workflow only routes to one approver. Your migration needs to handle the case where Approver 2 and/or Approver 3 are blank.

### 4. `Expected_Attachments` is a REAL stored column, not virtual
The Architecture doc labeled it as virtual with a COUNT formula. In the actual Sheet it exists as a real column (AB/28). This means the requestor enters a number ("I plan to upload 2 files") and the Sync Finisher Bot compares the actual uploaded count against this stored number.

### 5. Virtual columns that do NOT exist in the Sheet
These are computed by AppSheet and must be replicated as JavaScript functions in Apps Script:

| Virtual Column | Which Sheet | What it computes |
|---|---|---|
| `Current Approver` | Certificate_Requests | IFS on Step → looks up approver email from Approver_Settings |
| `Related Request_Attachments` | Certificate_Requests | List of matching rows in Request_Attachments |
| `Related Certificate_Requests` | Approver_Settings | List of matching rows in Certificate_Requests |
| `File_Hyperlink` | Request_Attachments | HYPERLINK of File_Link + Description |
| `Description_Link` | Request_Attachments | HTML anchor tag for email templates |

---

## Sheet 1: `Approver_Settings`

**Total columns:** 7  
**Total data rows:** 5 (groups configured)  
**Sheet tab name (exact):** `Approver_Settings`

| Col Letter | Col # | Column Name | Type | KEY? | Notes |
|---|---|---|---|---|---|
| A | 1 | `Group` | Text | ✅ KEY | Department/group identifier. This is what Certificate_Requests.Group references. |
| B | 2 | `Approver 1` | Email | – | Can be blank if group has no approver. Currently all 5 groups have only this filled. |
| C | 3 | `App 1 Designation` | Text | – | Job title of Approver 1 |
| D | 4 | `Approver 2` | Email | – | ⚠️ Currently blank for all 5 groups |
| E | 5 | `App 2 Designation` | Text | – | ⚠️ Currently blank for all 5 groups |
| F | 6 | `Approver 3` | Email | – | ⚠️ Currently blank for all 5 groups |
| G | 7 | `App 3 Designation` | Text | – | ⚠️ Currently blank for all 5 groups |

**Current groups in the sheet (Group column values):**
```
Row 2: "Information System Management"
Row 3: "ISM - InfoSec"
Row 4: "ISM Data Center Operations"
Row 5: "ISM Solutions Architect"
Row 6: "ISM Technical Services"
```

**Apps Script lookup pattern for this table:**
```javascript
// To find the approvers for a given group name:
const settingsSheet = ss.getSheetByName("Approver_Settings");
const settingsData  = settingsSheet.getDataRange().getValues();
// settingsData[0] = header row
// settingsData[1] = first group row (Row 2 in Sheets = index 1 after skipping header)

// Column indices (0-based for array access):
// [0] = Group, [1] = Approver1, [2] = App1Designation
// [3] = Approver2, [4] = App2Designation
// [5] = Approver3, [6] = App3Designation

function getApprovers(groupName) {
  const rows = settingsData.slice(1); // skip header
  const match = rows.find(row => row[0] === groupName);
  if (!match) return null;
  return {
    approver1: match[1] || null,
    designation1: match[2] || null,
    approver2: match[3] || null,
    designation2: match[4] || null,
    approver3: match[5] || null,
    designation3: match[6] || null,
  };
}
```

---

## Sheet 2: `Certificate_Requests`

**Total columns:** 33  
**Total data rows:** 0 (no requests submitted yet)  
**Sheet tab name (exact):** `Certificate_Requests`

| Col Letter | Col # | Column Name | Type | KEY? | Notes |
|---|---|---|---|---|---|
| A | 1 | `Request ID` | Text | ✅ KEY | Short unique ID. AppSheet set this with `LEFT(UNIQUEID(), 3)`. In Apps Script you generate this. |
| B | 2 | `Control Number` | Text | – | Human-readable full ID e.g. `EC-2026-00001-ABC`. Computed on creation. |
| C | 3 | `Status` | Text | – | ⚡ **The most important column.** Drives all bot triggers. See status values below. |
| D | 4 | `Step` | Number | – | ⚡ **The workflow counter.** 0=returned, 1/2/3=approver step. |
| E | 5 | `Date of Filing` | Date | – | Set to today on creation. |
| F | 6 | `Project Title` | LongText | – | What the request is for. |
| G | 7 | `Requestor` | Email | – | Who submitted. Auto-captured from logged-in user. |
| H | 8 | `Requestor's Designation` | Text | – | Job title of requestor. |
| I | 9 | `Group` | Text | – | Name of the approver group. Must match a value in Approver_Settings.Group (Col A). This is the foreign key. |
| J | 10 | `Accountable Person` | Text | – | Person accountable for the request. |
| K | 11 | `Department` | Text | – | |
| L | 12 | `Location` | Text | – | |
| M | 13 | `PC Name` | Text | – | |
| N | 14 | `PRISM` | Text | – | Internal reference number. Optional. |
| O | 15 | `Purchase Order` | Text | – | PO number. |
| P | 16 | `IHelp Number` | Text | – | Helpdesk ticket reference. Optional. |
| Q | 17 | `Product Type` | Text | – | e.g., Software, Hardware |
| R | 18 | `Product Name` | Text | – | |
| S | 19 | `Type of Purchase` | Text | – | e.g., New, Renewal |
| T | 20 | `Type of License` | Text | – | e.g., 3-year Subscription |
| U | 21 | `Contract Start Date` | Date | – | |
| V | 22 | `Contract End Date` | Date | – | |
| W | 23 | `Supplier Name` | Text | – | |
| X | 24 | `Requestor's Remark` | LongText | – | Purpose of the request. |
| Y | 25 | `Approver 1's Remark` | LongText | – | Filled by Approver 1 when actioning. |
| Z | 26 | `Approver 2's Remark` | LongText | – | Filled by Approver 2 when actioning. |
| AA | 27 | `Approver 3's Remark` | LongText | – | Filled by Approver 3 when actioning. |
| AB | 28 | `Expected_Attachments` | Number | – | ✅ REAL stored column. Requestor enters how many files they will upload. 0 = no files needed. |
| AC | 29 | `App1_Date` | DateTime | – | Timestamp of Approver 1's action. Set by Approve action. |
| AD | 30 | `App2_Date` | DateTime | – | Timestamp of Approver 2's action. |
| AE | 31 | `App3_Date` | DateTime | – | Timestamp of Approver 3's action. |
| AF | 32 | `Resubmit_Count` | Number | – | Number of times the requestor has resubmitted. Default 0. Incremented by Resubmit action. |
| AG | 33 | `Resubmit_History` | LongText | – | Append-only audit log of each resubmit (timestamp, returning approver, their remark). Entries separated by `\n\n---\n\n`. |

### Status values (all possible states for Col C)

| Status Value | Meaning | What triggers it |
|---|---|---|
| `"Syncing Files"` | Waiting for required attachments | Set on row creation when Expected_Attachments > 0 |
| `"Pending Approver 1"` | Waiting for Approver 1 | Set on creation (no attachments) OR by Sync Finisher when files complete |
| `"Pending Approver 2"` | Waiting for Approver 2 | Set by Approve action at Step 1 |
| `"Pending Approver 3"` | Waiting for Approver 3 | Set by Approve action at Step 2 |
| `"Fully Approved"` | Final approval done | Set by Approve action at Step 3 |
| `"Declined"` | Request rejected | Set by Decline action |
| `"Returned to Requestor"` | Sent back for revision | Set by Return action |

### Apps Script column constants (use this block in every script file)

```javascript
// Certificate_Requests column indices (1-based, for getRange/setValue)
const CR = {
  REQUEST_ID:          1,   // A
  CONTROL_NUMBER:      2,   // B
  STATUS:              3,   // C  ← most referenced
  STEP:                4,   // D  ← second most referenced
  DATE_OF_FILING:      5,   // E
  PROJECT_TITLE:       6,   // F
  REQUESTOR:           7,   // G
  REQUESTOR_DESIG:     8,   // H
  GROUP:               9,   // I
  ACCOUNTABLE_PERSON:  10,  // J
  DEPARTMENT:          11,  // K
  LOCATION:            12,  // L
  PC_NAME:             13,  // M
  PRISM:               14,  // N
  PURCHASE_ORDER:      15,  // O
  IHELP_NUMBER:        16,  // P
  PRODUCT_TYPE:        17,  // Q
  PRODUCT_NAME:        18,  // R
  TYPE_OF_PURCHASE:    19,  // S
  TYPE_OF_LICENSE:     20,  // T
  CONTRACT_START:      21,  // U
  CONTRACT_END:        22,  // V
  SUPPLIER_NAME:       23,  // W
  REQUESTOR_REMARK:    24,  // X
  APP1_REMARK:         25,  // Y
  APP2_REMARK:         26,  // Z
  APP3_REMARK:         27,  // AA
  EXPECTED_ATTACHMENTS: 28, // AB
  APP1_DATE:           29,  // AC
  APP2_DATE:           30,  // AD
  APP3_DATE:           31,  // AE
  RESUBMIT_COUNT:      32,  // AF
  RESUBMIT_HISTORY:    33,  // AG
};
```

---

## Sheet 3: `Request_Attachments`

**Total columns:** 5  
**Total data rows:** 0 (no attachments uploaded yet)  
**Sheet tab name (exact):** `Request_Attachments`

| Col Letter | Col # | Column Name | Type | KEY? | Notes |
|---|---|---|---|---|---|
| A | 1 | `Attachment ID` | Text | ✅ KEY | Unique ID per file. AppSheet used `UNIQUEID()`. Apps Script will generate this. |
| B | 2 | `Request ID` | Text | – | Foreign key → matches `Request ID` in Certificate_Requests (Col A). This is how you link a file to its request. |
| C | 3 | `File` | Text | – | In AppSheet this stored a file path/name. In Apps Script this will store a Google Drive file ID or URL. |
| D | 4 | `File_Link` | Url | – | Direct URL to the file. In Apps Script: Google Drive shareable link. |
| E | 5 | `Description` | LongText | – | Human label for the file e.g. "Supplier Quotation". |

**Apps Script column constants:**
```javascript
// Request_Attachments column indices (1-based)
const RA = {
  ATTACHMENT_ID: 1,  // A
  REQUEST_ID:    2,  // B  ← foreign key to Certificate_Requests
  FILE:          3,  // C
  FILE_LINK:     4,  // D
  DESCRIPTION:   5,  // E
};
```

---

## Summary: What exists in the Sheet vs what Apps Script must compute

| Column | Exists in Sheet? | Apps Script action |
|---|---|---|
| `Request ID` | ✅ Yes | Read + write |
| `Control Number` | ✅ Yes | **Compute on creation** then write |
| `Status` | ✅ Yes | Read + write (most critical) |
| `Step` | ✅ Yes | Read + write (second most critical) |
| All request fields (E–X) | ✅ Yes | Read + write |
| `Expected_Attachments` | ✅ Yes | Read (set by user in form) |
| `App1/2/3_Date` | ✅ Yes | Write when approver acts |
| `Current Approver` | ❌ Not in Sheet | **Compute in code** using Step + Approver_Settings lookup |
| `Related Request_Attachments` | ❌ Not in Sheet | **Compute in code** by filtering Request_Attachments by Request ID |
| `File_Hyperlink` | ❌ Not in Sheet | **Compute in code** when building email body |
| `Description_Link` | ❌ Not in Sheet | **Compute in code** when building email body |

---

## Key data relationships (how to do JOINs in Apps Script)

```
Certificate_Requests.Group (Col I)
        ↓ must match
Approver_Settings.Group (Col A)
→ From this match, get Approver 1/2/3 emails


Request_Attachments.Request ID (Col B)
        ↓ must match
Certificate_Requests.Request ID (Col A)
→ From this match, count how many attachments exist for a request
```

**In plain code:**
```javascript
// JOIN: get all attachments for a given request
function getAttachmentsForRequest(requestId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
                              .getSheetByName("Request_Attachments");
  const rows = sheet.getDataRange().getValues().slice(1); // skip header
  return rows.filter(row => row[RA.REQUEST_ID - 1] === requestId);
  // RA.REQUEST_ID = 2, minus 1 because arrays are 0-indexed
}

// COUNT: how many attachments uploaded so far
function countAttachments(requestId) {
  return getAttachmentsForRequest(requestId).length;
}
```

---

*Last updated: Phase 1 audit from ECertificate_Automation.xlsx*  
*Do not edit column numbers manually — re-run the audit script if the Sheet structure changes.*
