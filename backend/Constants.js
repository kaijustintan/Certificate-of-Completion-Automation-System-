// Constants.js
// ============================================================
// Constants.js
// Column index maps — ground truth from COLUMN_MAP.md
//
// Two number systems used throughout this project:
//   1-based  → for getRange() and setValue()  e.g. sheet.getRange(row, CR.STATUS)
//   0-based  → for array access               e.g. row[CR.STATUS - 1]
// ============================================================


// Exact sheet tab names — always use these, never type the string directly
const SHEET_NAMES = {
  APPROVER_SETTINGS:    "Approver_Settings",
  CERTIFICATE_REQUESTS: "Certificate_Requests",
  REQUEST_ATTACHMENTS:  "Request_Attachments",
};


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
};


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


// Request_Attachments — column numbers
const RA = {
  ATTACHMENT_ID: 1,  // A  ← KEY
  REQUEST_ID:    2,  // B  ← foreign key to Certificate_Requests
  FILE:          3,  // C
  FILE_LINK:     4,  // D
  DESCRIPTION:   5,  // E
};


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