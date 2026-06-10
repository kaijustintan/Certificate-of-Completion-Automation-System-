# COC Template Spec — Phase 9 (Template 1)

**Status:** Build spec + repo record for the Google Docs COC template.
**Why this file exists:** We chose **Option B** (manually-built Google Doc) for the certificate
template. The real layout lives in Google Drive, not the repo — so this file is the version-controlled
record of *what* that Doc must contain (placeholders, formatting, structure) and *why*. If the Doc is
ever lost or corrupted, rebuild it from this spec.

> Source of truth for the look: the original AppSheet template ("Image 6" in
> `E-Certificate Automation Documentation.pdf`).

---

## ⚠️ AS-BUILT NOTE (read this first)

The actual template was built by **recreating the AppSheet layout verbatim**, so it keeps the original
AppSheet expressions (`<<[Group]>>`, `<<TEXT([Date of Filing], …)>>`, `<<IF(ISNOTBLANK([PRISM]), …)>>`,
`<<If: …>>`/`<<EndIf>>`). `generateCOC()` therefore matches **two token styles**:

1. **AppSheet `<<…>>` expressions** — the as-built default; matched by RE2 patterns in the rules array.
2. **Clean `{{tokens}}`** — used to fix any cell whose long AppSheet expression got **broken across a
   line break** (replaceText can't match across a hard break). Short `{{tokens}}` never wrap, so they
   always match. In the current Doc these are used for: `{{prism}}`, `{{po_no}}`, `{{ihelp}}`,
   `{{prepared_date}}`, and the Approver 2/3 signatory cells (`{{approver2/3}}`, `{{desig2/3}}`,
   `{{app2_date}}`, `{{app3_date}}`).

The placeholder tables below list the `{{token}}` form; either style works per cell.

**Signatory table:** taken as the **LAST table in the doc**. Unused Approver 2/3 columns are cleared
automatically (no `<<If>>` needed). Build it as a 1-row-of-labels + 1-row-of-values, 4 columns:
Prepared By · Approver 1 · Approver 2 · Approver 3.

**Archive folder:** `COC.ARCHIVE_FOLDER_ID` is currently a **dev folder** (the user's Drive). For
production, swap it for the Megaworld-account folder `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y` (the executing
account must have write access).

---

## How it works (Layman → Technical)

**Layman:** Gumawa ka ng minsanang Google Doc na mukhang certificate, pero imbis na tunay na datos,
mga `{{placeholder}}` ang nakalagay. Pag may request na "Fully Approved", kokopyahin ng code ang Doc na
ito, papalitan ang bawat `{{placeholder}}` ng totoong datos, gagawing PDF, at ie-email sa requestor.

**Technical:** `generateCOC(requestId)` in `backend/Certificate.js` does
`DriveApp.getFileById(COC_TEMPLATE_DOC_ID).makeCopy()` → `DocumentApp.openById()` →
`body.replaceText("{{token}}", value)` for every token → exports the copy as `application/pdf` →
archives the PDF to `COC_ARCHIVE_FOLDER_ID` → deletes the temp Doc copy → returns the PDF blob + file URL.

---

## ⚠️ Hard build requirements (the code depends on these)

1. **Placeholder spelling is a contract.** Every token below must be typed EXACTLY (case-sensitive,
   double curly braces, no spaces inside: `{{control_number}}` not `{{ control_number }}`).
   A typo = a blank or a literal `{{token}}` left in the PDF.
2. **The signatory area MUST be a 1-row × 4-column table.** The code hides unused approver columns by
   clearing a *table cell* (`getCell(0, 2)` / `getCell(0, 3)`). If you build the four signatory columns
   with tabs/spaces instead of a real table, the conditional hide breaks. See the layout table below.
3. The code finds this table by searching for the literal token `{{approver1}}`. So `{{approver1}}`
   must physically live inside that 4-column signatory table.

### Signatory table layout (important)

The AppSheet original had 4 signatory columns visually: Prepared By, Approved By 1, Approved By 2,
Approved By 3. To keep the conditional-hide logic simple (clear whole cells for missing approvers 2/3),
build the signatory table as **1 row × 4 columns**:

| Cell | Contents | Conditional? |
|---|---|---|
| (0,0) Prepared By | `{{requestor}}` / `{{requestor_desig}}` / Date: `{{prepared_date}}` | always |
| (0,1) Approved By  | `{{approver1}}` / `{{desig1}}` / Signed: `{{app1_date}}` | always |
| (0,2) Approved By  | `{{approver2}}` / `{{desig2}}` / Signed: `{{app2_date}}` | **cleared if no Approver 2** |
| (0,3) Approved By  | `{{approver3}}` / `{{desig3}}` / Signed: `{{app3_date}}` | **cleared if no Approver 3** |

> So it's a **1×4 table**. The code clears cell (0,2) and/or (0,3). `{{approver1}}` lives in cell (0,1),
> which is what the table-finder searches for.

---

## Placeholder reference (token → source → port-logic)

Most sources are 1-based `CR.*` columns from `Constants.js` / `COLUMN_MAP (1).md`, read via
`getRequestRowData(requestId)` (returns a 25-col 0-indexed array — the whole `Requests` row). Approver
names/designations come from `getApprovers(group)` (the `Group_Approvers` join), NOT from the request row.
Approver **action dates** are no longer request columns — they come from the timeline via
`getApprovalView(requestId).byStep[n].date`.

### Header
| Token | Source | Port-logic |
|---|---|---|
| `{{group}}` | CR.GROUP (9) | direct |
| `{{control_number}}` | CR.CONTROL_NUMBER (2) | direct (also in footer) |
| `{{date_of_filing_long}}` | CR.DATE_OF_FILING (5) | format `"MMMM dd, yyyy"` |
| `{{generated_at}}` | `new Date()` at generation time | PH time, `"MMMM dd, yyyy hh:mm:ss a"` — ports `UTCNOW()+"008:00:00"` |

### Info block
| Token | Source | Port-logic |
|---|---|---|
| `{{project_title}}` | CR.PROJECT_TITLE (6) | direct |
| `{{requestor}}` | CR.REQUESTOR (7) | direct |
| `{{requestor_desig}}` | CR.REQUESTOR_DESIG (8) | direct |
| `{{accountable_person}}` | CR.ACCOUNTABLE_PERSON (10) | direct |
| `{{department}}` | CR.DEPARTMENT (11) | direct |
| `{{location}}` | CR.LOCATION (12) | direct |
| `{{pc_name}}` | CR.PC_NAME (13) | direct |

### Item details table
| Token | Source | Port-logic |
|---|---|---|
| `{{prism}}` | CR.PRISM (14) | **blank → "N/A"** (ports `IF(ISNOTBLANK(...))`) |
| `{{po_no}}` | CR.PURCHASE_ORDER (15) | **blank → "N/A"** |
| `{{ihelp}}` | CR.IHELP_NUMBER (16) | **blank → "N/A"** |
| `{{product_type}}` | CR.PRODUCT_TYPE (17) | direct |
| `{{product_name}}` | CR.PRODUCT_NAME (18) | direct |
| `{{type_purchase}}` | CR.TYPE_OF_PURCHASE (19) | direct |
| `{{type_license}}` | CR.TYPE_OF_LICENSE (20) | direct |
| `{{contract_period}}` | CR.CONTRACT_START (21) + CR.CONTRACT_END (22) | `"MMM dd, yyyy"` each, joined `" - "`; blank → "N/A" |
| `{{supplier}}` | CR.SUPPLIER_NAME (23) | direct |
| `{{requestor_remark}}` | CR.REQUESTOR_REMARK (24) | direct |

### Signatory table (see layout above)
| Token | Source | Port-logic |
|---|---|---|
| `{{prepared_date}}` | CR.DATE_OF_FILING (5) | format `"MM-dd-yyyy"` |
| `{{approver1}}` | `getApprovers(group).approver1` | direct |
| `{{desig1}}` | `getApprovers(group).designation1` | direct |
| `{{app1_date}}` | `getApprovalView(requestId).byStep[1].date` | format `"MM-dd-yyyy HH:mm:ss"` |
| `{{approver2}}` | `getApprovers(group).approver2` | cell cleared if null |
| `{{desig2}}` | `getApprovers(group).designation2` | cell cleared if null |
| `{{app2_date}}` | `getApprovalView(requestId).byStep[2].date` | format `"MM-dd-yyyy HH:mm:ss"` |
| `{{approver3}}` | `getApprovers(group).approver3` | cell cleared if null |
| `{{desig3}}` | `getApprovers(group).designation3` | cell cleared if null |
| `{{app3_date}}` | `getApprovalView(requestId).byStep[3].date` | format `"MM-dd-yyyy HH:mm:ss"` |

---

## Build steps (you, in Drive)

1. Create a new Google Doc, title it e.g. `COC Template 1`.
2. Recreate the certificate layout from the AppSheet screenshot (title, info block, item table, remarks,
   signatory table) — use the formatting you want (bold names, red signed dates, borders, etc.).
3. Replace every dynamic value with its `{{token}}` from the tables above. Type tokens EXACTLY.
4. Build the signatory area as a **1×4 table** per the layout note.
5. **Share the Doc** so the executing account can read it (and confirm the archive folder
   `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y` is writable by that account).
6. Copy the Doc ID from its URL (`docs.google.com/document/d/<DOC_ID>/edit`).
7. Paste `<DOC_ID>` into `COC_TEMPLATE_DOC_ID` in `backend/Constants.js`.
8. `clasp push`, then in the Apps Script editor run `_testGenerateCOC("<an existing requestId>")` and
   open the logged PDF URL to verify.

---

## Gotchas

- **Dates may come back as `Date` objects or strings** from the sheet — the formatter guards both and
  falls back to `"N/A"` (contract dates) or `""` for unparseable values.
- **`replaceText` uses regex** under the hood, and `{` / `}` ARE regex metacharacters — so the code
  escapes every token before replacing (`coc_escapeToken_`). You don't need to do anything in the Doc;
  just don't add other regex-special chars (`.`, `*`, `(`, etc.) to token names.
- **Execute-as / permissions:** the account running the script must have read access to the template Doc
  and write access to the archive folder. In dev this is your gmail; in production it's the Megaworld
  account (see CLAUDE.md production checklist).
- **No new fields for the COC itself.** Every token maps to a `Requests` column, the `Group_Approvers`
  join (`getApprovers`), or the `Activity_Log`-derived action dates (`getApprovalView`) — this is the
  whole reason Template 1 was chosen over Template 2. (The 2026-06-10 normalization moved where the
  approver dates live, but did not add any token-facing field.) Each generated PDF is now also logged to
  the `COC_PDFs` sheet.
