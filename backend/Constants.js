// Constants.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Constants.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung "diksyunaryo ng mga column at status" ng buong project. Sa halip
  na tandaan na ang "Status" ay nasa column 3, o i-type ang literal na
  "Fully Approved" sa kung saan-saang file (delikado sa typo), iisang
  sentral na listahan lang dito ang sinasandalan ng lahat. Kapag may
  nadagdag/nailipat na column sa sheet, dito lang babaguhin — minsan.

  TECHNICAL:
  Central column-index maps and status enums, sourced from COLUMN_MAP.md.
  Defined as top-level const objects; since Apps Script shares ONE global
  scope across all .gs/.js files, these are visible everywhere with no import.

  ⚠️ TWO NUMBER SYSTEMS (the #1 footgun here):
    1-based → Sheet API:    sheet.getRange(row, CR.STATUS)   // CR.STATUS = 3
    0-based → array index:  row[CR.STATUS - 1]               // subtract 1

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  SHEET_NAMES — exact tab names for the 3 sheets
  CR          — Certificate_Requests columns (35 cols, A–AI)
  AS          — Approver_Settings columns (7 cols)
  RA          — Request_Attachments columns (5 cols)
  STATUS      — the 7 allowed Certificate_Requests.Status values
  COC         — Certificate-of-Completion generation IDs (Phase 9)

  ────────────────────────────────────────────────────────────
  EXAMPLE (the 1-based vs 0-based gotcha)
  ────────────────────────────────────────────────────────────
  const rows  = getDataRows(SHEET_NAMES.CERTIFICATE_REQUESTS); // 0-based arrays
  const stat  = rows[0][CR.STATUS - 1];                  // ← array: subtract 1
  sheet.getRange(2, CR.STATUS).setValue(STATUS.APPROVED); // ← Sheet API: as-is
*/


/*
  SHEET_NAMES — exact sheet tab names.
  LAYMAN    : Para hindi mamali ng spelling ng tab name kapag tumatawag.
  TECHNICAL : Pass these to getSheet()/getDataRows(); never hardcode the raw
              tab string elsewhere, so a rename is a one-line change here.
*/
// Exact sheet tab names — always use these, never type the string directly
const SHEET_NAMES = {
  APPROVER_SETTINGS:    "Approver_Settings",
  CERTIFICATE_REQUESTS: "Certificate_Requests",
  REQUEST_ATTACHMENTS:  "Request_Attachments",
};


/*
  CR — Certificate_Requests column map (A=1 … AI=35).
  LAYMAN    : Bawat field ng isang request, anong column number sa sheet.
              Yung may "←" na note ang importante / may kasamang automation.
  TECHNICAL : 1-based column numbers. Key drivers: STATUS(3) drives all
              automation, STEP(4) is the workflow counter, GROUP(9) is the FK
              to Approver_Settings. Cols 32–35 were added across Cat 1 & 4
              (resubmit tracking, previous-approvals snapshot, audit stamp).
*/
// Certificate_Requests — column numbers (A=1, B=2, etc.)
const CR = {
  REQUEST_ID:           1,   // A
  CONTROL_NUMBER:       2,   // B
  STATUS:               3,   // C  ← drives all automation
  STEP:                 4,   // D  ← workflow counter
  DATE_OF_FILING:       5,   // E
  PROJECT_TITLE:        6,   // F
  REQUESTOR:            7,   // G
  REQUESTOR_DESIG:      8,   // H
  GROUP:                9,   // I  ← foreign key to Approver_Settings
  ACCOUNTABLE_PERSON:   10,  // J
  DEPARTMENT:           11,  // K
  LOCATION:             12,  // L
  PC_NAME:              13,  // M
  PRISM:                14,  // N
  PURCHASE_ORDER:       15,  // O
  IHELP_NUMBER:         16,  // P
  PRODUCT_TYPE:         17,  // Q
  PRODUCT_NAME:         18,  // R
  TYPE_OF_PURCHASE:     19,  // S
  TYPE_OF_LICENSE:      20,  // T
  CONTRACT_START:       21,  // U
  CONTRACT_END:         22,  // V
  SUPPLIER_NAME:        23,  // W
  REQUESTOR_REMARK:     24,  // X
  APP1_REMARK:          25,  // Y
  APP2_REMARK:          26,  // Z
  APP3_REMARK:          27,  // AA
  EXPECTED_ATTACHMENTS: 28,  // AB ← real stored column, not virtual
  APP1_DATE:            29,  // AC
  APP2_DATE:            30,  // AD
  APP3_DATE:            31,  // AE
  RESUBMIT_COUNT:       32,  // AF
  RESUBMIT_HISTORY:     33,  // AG
  PREVIOUS_APPROVALS:   34,  // AH — JSON array of approvers who had acted at time of last return
  LAST_ACTION_BY:       35,  // AI — email of whoever most recently approved/declined/returned (audit + actioned-list)
};


/*
  AS — Approver_Settings column map.
  LAYMAN    : Dito nakatala kung sinong approver(s) bawat group. Sa ngayon,
              iisa lang ang approver kada group — blangko pa ang slots 2 at 3.
  TECHNICAL : GROUP(1) is the key matched against CR.GROUP. APPROVER_2/3 +
              DESIG_2/3 are currently empty for all groups (single-approver
              chains), but the routing code already supports up to 3.
*/
// Approver_Settings — column numbers
const AS = {
  GROUP:      1,  // A  ← KEY, must match CR.GROUP value exactly
  APPROVER_1: 2,  // B
  DESIG_1:    3,  // C
  APPROVER_2: 4,  // D  ← currently blank for all 5 groups
  DESIG_2:    5,  // E  ← currently blank for all 5 groups
  APPROVER_3: 6,  // F  ← currently blank for all 5 groups
  DESIG_3:    7,  // G  ← currently blank for all 5 groups
};


/*
  RA — Request_Attachments column map.
  LAYMAN    : Listahan ng mga naka-attach na file, naka-link sa request.
  TECHNICAL : ATTACHMENT_ID(1) is the key; REQUEST_ID(2) is the FK back to
              Certificate_Requests.
*/
// Request_Attachments — column numbers
const RA = {
  ATTACHMENT_ID: 1,  // A  ← KEY
  REQUEST_ID:    2,  // B  ← foreign key to Certificate_Requests
  FILE:          3,  // C
  FILE_LINK:     4,  // D
  DESCRIPTION:   5,  // E
};


/*
  STATUS — the 7 allowed values of Certificate_Requests.Status (Col C).
  LAYMAN    : Buong "buhay" ng request: naghihintay ng files → routed sa
              approver 1/2/3 → tapos (approved / declined / returned).
  TECHNICAL : Canonical status strings. Always reference STATUS.* — these exact
              strings are compared in filters, email subjects, and frontend
              badge mapping, so a raw-string typo silently breaks routing.
*/
// All possible Status values for Certificate_Requests.Status (Col C)
// Never type these strings raw in other files — always use STATUS.whatever
const STATUS = {
  SYNCING:   "Syncing Files",          // waiting for attachments to be uploaded
  PENDING_1: "Pending Approver 1",     // routed to Approver 1
  PENDING_2: "Pending Approver 2",     // routed to Approver 2
  PENDING_3: "Pending Approver 3",     // routed to Approver 3
  APPROVED:  "Fully Approved",         // all approvers signed off
  DECLINED:  "Declined",               // rejected at any step
  RETURNED:  "Returned to Requestor",  // sent back for revision
};


/*
  COC — Certificate of Completion generation config (Phase 9).
  LAYMAN    : Dalawang "address" na kailangan ng PDF generator: (1) saan
              nakatago ang Google Docs template na may {{placeholders}}, at
              (2) saang Drive folder itatago ang mga na-generate na PDF.
  TECHNICAL : Used by generateCOC() in Certificate.js. TEMPLATE_DOC_ID is the
              file ID of the manually-built Doc template (Option B) — see
              reference/COC_TEMPLATE_SPEC.md for the placeholder contract.
              ARCHIVE_FOLDER_ID is the existing Drive folder for attachments/PDFs.
  ⚠️ SETUP  : TEMPLATE_DOC_ID is intentionally blank — paste the Doc ID after
              building the template Doc. generateCOC() throws a clear error
              while it is empty.
*/
// Certificate of Completion (Phase 9) — Drive IDs for the PDF generator
const COC = {
  TEMPLATE_DOC_ID:   "1FBf-l49w-z_3bey0NdxZ3VABevFb2_7gbGw-l111MSs",
  ARCHIVE_FOLDER_ID: "1dejYXLXXvV1FWHovNd6WmZxmipJl71h9",
};