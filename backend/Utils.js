// Utils.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Utils.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Toolbox ng buong project. Lahat ng paulit-ulit na gawain — kunin ang sheet,
  hanapin kung sinong approver ng isang group, bilangin ang attachments,
  gumawa ng bagong ID, i-format ang oras sa PH time — nandito. Yung dating
  AppSheet "virtual columns" at "Ref lookups" ay dito na nakasalin bilang
  functions.

  TECHNICAL:
  Shared, dependency-free helpers used across every other backend file (one
  global Apps Script scope, no imports). Replaces AppSheet virtual columns /
  Ref lookups with explicit Sheet-API reads.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  SHEET ACCESS
    - getSpreadsheet()          bound spreadsheet handle
    - getSheet(name)            one tab by name
    - getAllData(name)          all rows incl. header (2D array)
    - getDataRows(name)         data rows only (header sliced off)

  APPROVER LOOKUP   (was AppSheet Ref: CR.Group → AS.Group)
    - getApprovers(group)               all 3 approver slots for a group
    - getCurrentApprover(step, group)   who must act right now

  ATTACHMENT HELPERS
    - getAttachmentsForRequest(id)      attachment rows for one request
    - countAttachments(id)              how many were uploaded

  ROW FINDER
    - getRowNumberByRequestId(id)       array index → real Sheet row number

  DATE + TIME   (PH time, Asia/Manila)
    - formatPHTime(date)                format a Date
    - nowFormatted()                    formatted "now"

  ID GENERATORS
    - generateRequestId()               short 3-char unique ID
    - generateControlNumber(reqId)      EC-YYYY-NNNNN-XXX
*/


// =========================================================================================================
// SHEET ACCESS
// =========================================================================================================

/*
  Function Name: getSpreadsheet
  LAYMAN    : Kunin ang buong Google Sheet file na naka-attach sa script.
  TECHNICAL : Returns the container-bound spreadsheet.
  PARAMS    : (none)
  RETURNS   : Spreadsheet object.
*/
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}


/*
  Function Name: getSheet
  LAYMAN    : Kunin ang isang partikular na tab (hal. "Certificate_Requests").
  TECHNICAL : Returns the Sheet for the given tab name.
  PARAMS    : sheetName — exact tab name (use SHEET_NAMES.*).
  RETURNS   : Sheet object, or null if no tab matches.
*/
function getSheet(sheetName) {
  return getSpreadsheet().getSheetByName(sheetName);
}


/*
  Function Name: getAllData
  LAYMAN    : Kunin LAHAT ng laman ng tab, kasama ang header row, bilang 2D
              array (data[0] = header, data[1] = unang record).
  TECHNICAL : getDataRange().getValues() — the full used range as a 2D array.
  PARAMS    : sheetName — tab to read.
  RETURNS   : 2D array (rows × cells); index 0 is the header row.
  NOTE      : Use this (not getDataRows) when you need the header or the true
              1-based Sheet row numbers.
*/
function getAllData(sheetName) {
  return getSheet(sheetName).getDataRange().getValues();
}


/*
  Function Name: getDataRows
  LAYMAN    : Parang getAllData pero tinanggal na ang header — yung mga tunay
              na records na lang ang natitira, madaling i-loop.
  TECHNICAL : getAllData(name).slice(1) — drops the header row.
  PARAMS    : sheetName — tab to read.
  RETURNS   : 2D array of data rows only (0-based; index 0 = first record).
  ⚠️ NOTE   : Header is gone, so array index i maps to Sheet row i+2. If you
              need the real row number, use getRowNumberByRequestId().
*/
function getDataRows(sheetName) {
  return getAllData(sheetName).slice(1);
}


// =========================================================================================================
// APPROVER LOOKUP
// Replaces AppSheet's Ref: Certificate_Requests.Group → Approver_Settings.Group
// =========================================================================================================

/*
  Function Name: getApprovers
  LAYMAN    : Bigyan mo ng pangalan ng group (hal. "ISM - InfoSec"), ibabalik
              nito kung sinong approver(s) nito. Kapalit ito ng AppSheet "Ref"
              lookup mula CR.Group papuntang Approver_Settings.
  TECHNICAL : Finds the Approver_Settings row whose GROUP equals groupName and
              returns all 3 approver/designation slots. Blank cells → null.
  PARAMS    : groupName — must match an Approver_Settings.GROUP value exactly.
  RETURNS   : { approver1, designation1, approver2, designation2, approver3,
              designation3 } with null for blank slots — OR null if the group
              row itself isn't found.

  STEPS
    Step 1 — Load all approver-settings rows
      Layman    : Kunin lahat ng laman ng Approver_Settings.
      Technical : getDataRows(SHEET_NAMES.APPROVER_SETTINGS).
    Step 2 — Find the matching group
      Layman    : Hanapin ang row na tugma ang group name.
      Technical : rows.find(GROUP === groupName); return null if none.
    Step 3 — Project the 3 slots (blank → null)
      Layman    : Ibalik ang 3 approver slots; kapag walang laman, null.
      Technical : `|| null` normalizes empty cells so callers can null-check.

  EXAMPLE
    getApprovers("ISM - InfoSec")
    → { approver1: "kyle_justin_tan@dlsu.edu.ph", designation1: "InfoSec Head",
        approver2: null, designation2: null, approver3: null, designation3: null }
    getApprovers("Nonexistent Group")  →  null
*/
function getApprovers(groupName) {
  const rows = getDataRows(SHEET_NAMES.APPROVER_SETTINGS);
  const match = rows.find(row => row[AS.GROUP - 1] === groupName);
  if (!match) return null;

  return {
    approver1:    match[AS.APPROVER_1 - 1] || null,
    designation1: match[AS.DESIG_1 - 1]    || null,
    approver2:    match[AS.APPROVER_2 - 1] || null,
    designation2: match[AS.DESIG_2 - 1]    || null,
    approver3:    match[AS.APPROVER_3 - 1] || null,
    designation3: match[AS.DESIG_3 - 1]    || null,
  };
}


// =========================================================================================================
// CURRENT APPROVER
// Replaces AppSheet's virtual column: Current Approver
// Formula was: IFS([Step]=1, Approver1, [Step]=2, Approver2, ...)
// =========================================================================================================

/*
  Function Name: getCurrentApprover
  LAYMAN    : Sino ang dapat kumilos sa request NGAYON? Base sa Step (1/2/3) at
              group, ibabalik kung kaninong email ang nasa pila. Kapalit ng
              AppSheet virtual column na "Current Approver".
  TECHNICAL : Maps a workflow step to the configured approver email for the
              group. Step 0 (returned to requestor) and unconfigured steps → null.
  PARAMS    : step — 0..3 workflow counter (CR.STEP).
              groupName — the request's group (CR.GROUP).
  RETURNS   : Approver email string, or null (no one is currently due to act).

  STEPS
    Step 1 — Short-circuit step 0
      Layman    : Kapag 0 ang step, nasa requestor pa — walang approver.
      Technical : step === 0 → return null immediately.
    Step 2 — Resolve the group's approvers
      Layman    : Kunin ang approver slots ng group.
      Technical : getApprovers(groupName); null group → null.
    Step 3 — Pick the slot matching the step
      Layman    : Step 1 → approver1, step 2 → approver2, atbp.
      Technical : Return approverN keyed by step; out-of-range → null.

  EXAMPLE
    getCurrentApprover(1, "ISM - InfoSec")  →  "kyle_justin_tan@dlsu.edu.ph"
    getCurrentApprover(0, "ISM - InfoSec")  →  null   // returned to requestor
*/
function getCurrentApprover(step, groupName) {
  if (step === 0) return null; // returned to requestor, no approver
  const approvers = getApprovers(groupName);
  if (!approvers) return null;
  if (step === 1) return approvers.approver1;
  if (step === 2) return approvers.approver2;
  if (step === 3) return approvers.approver3;
  return null;
}


// =========================================================================================================
// ATTACHMENT HELPERS
// Replaces AppSheet's REF_ROWS("Request_Attachments", "Request ID")
// and COUNT([Related Request_Attachments])
// =========================================================================================================

/*
  Function Name: getAttachmentsForRequest
  LAYMAN    : Kunin lahat ng files na naka-attach sa isang request.
  TECHNICAL : Filters Request_Attachments by REQUEST_ID (string-compared to
              survive numeric/string ID drift between sheets).
  PARAMS    : requestId — the parent request's ID.
  RETURNS   : Array of attachment rows (empty array if none).
*/
function getAttachmentsForRequest(requestId) {
  const rows   = getDataRows(SHEET_NAMES.REQUEST_ATTACHMENTS);
  const target = String(requestId);
  return rows.filter(row => String(row[RA.REQUEST_ID - 1]) === target);
}

/*
  Function Name: countAttachments
  LAYMAN    : Ilang files ba ang na-upload para sa request na ito?
  TECHNICAL : Length of getAttachmentsForRequest(requestId).
  PARAMS    : requestId — the parent request's ID.
  RETURNS   : Number — count of attachments.
*/
function countAttachments(requestId) {
  return getAttachmentsForRequest(requestId).length;
}


// =========================================================================================================
// ROW FINDER
// Gets the actual Sheet row number for a given Request ID
// Needed because getRange() requires a row number, not an array index
// =========================================================================================================

/*
  Function Name: getRowNumberByRequestId
  LAYMAN    : Sa anong Sheet row number (yung totoong nakikita sa Sheets, may
              header) nakaupo ang isang Request ID? Kailangan ito kasi ang
              getRange() ay row NUMBER ang hinihingi, hindi array index.
  TECHNICAL : Scans Certificate_Requests for the row whose REQUEST_ID matches
              and returns its 1-based Sheet row number.
  PARAMS    : requestId — the ID to locate.
  RETURNS   : 1-based Sheet row number, or -1 if not found.

  STEPS
    Step 1 — Read all data (header included)
      Layman    : Kunin lahat para tugma ang indexing sa totoong row numbers.
      Technical : getAllData() keeps the header, so allData[i] = Sheet row i+1.
    Step 2 — Loop from the first data row
      Layman    : Simula sa i=1 (laktawan ang header), hanapin ang tugma.
      Technical : for i = 1..n-1; string-compare REQUEST_ID.
    Step 3 — Return the Sheet row number
      Layman    : Pag tugma, ibalik i+1 (kasi 1-based ang Sheets).
      Technical : return i + 1; fall through to -1 if no match.

  EXAMPLE
    // REQ-9b1 is stored in Sheet row 5 (header is row 1)
    getRowNumberByRequestId("REQ-9b1")  →  5
    getRowNumberByRequestId("nope")     →  -1
*/
function getRowNumberByRequestId(requestId) {
  const allData = getAllData(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const target  = String(requestId);
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][CR.REQUEST_ID - 1]) === target) {
      return i + 1;
    }
  }
  return -1;
}


// =========================================================================================================
// DATE + TIME
// Replaces AppSheet's UTCNOW() + "008:00:00" (Philippine time)
// =========================================================================================================

/*
  Function Name: formatPHTime
  LAYMAN    : Gawing readable na PH-time text ang isang Date
              (hal. "May 26, 2026 02:30:00 PM").
  TECHNICAL : Utilities.formatDate(date, "Asia/Manila",
              "MMMM dd, yyyy hh:mm:ss a").
  PARAMS    : date — a JS Date object.
  RETURNS   : Formatted PH-time string.
*/
function formatPHTime(date) {
  return Utilities.formatDate(date, "Asia/Manila", "MMMM dd, yyyy hh:mm:ss a");
}

/*
  Function Name: nowFormatted
  LAYMAN    : Ang oras NGAYON, naka-format na sa PH time.
  TECHNICAL : formatPHTime(new Date()).
  PARAMS    : (none)
  RETURNS   : Current timestamp as a PH-time string.
*/
function nowFormatted() {
  return formatPHTime(new Date());
}


// =========================================================================================================
// ID GENERATORS
// Replaces AppSheet's UNIQUEID() and Control Number formula
// =========================================================================================================

/*
  Function Name: generateRequestId
  LAYMAN    : Gumawa ng maikling natatanging ID (3 malalaking character).
              Katumbas ng AppSheet na LEFT(UNIQUEID(), 3).
  TECHNICAL : First 3 chars of a dash-stripped UUID, upper-cased.
  PARAMS    : (none)
  RETURNS   : 3-character ID string (e.g. "9B1").
  NOTE      : Short → tiny collision risk; the control number adds a running
              counter so the full identifier stays unique.
*/
function generateRequestId() {
  return Utilities.getUuid().replace(/-/g, "").substring(0, 3).toUpperCase();
}

/*
  Function Name: generateControlNumber
  LAYMAN    : Buuin ang opisyal na control number ng request, format na
              EC-TAON-BILANG-XXX (hal. EC-2026-00001-9B1).
  TECHNICAL : Composes EC-<year>-<5-digit running count>-<requestId>, using the
              current row count as the sequence number.
  PARAMS    : requestId — the short ID appended as the suffix.
  RETURNS   : Control-number string.

  STEPS
    Step 1 — Compute the running sequence
      Layman    : Bilangin ilan nang request (minus header), +1 ang bago.
      Technical : count = lastRow > 1 ? lastRow - 1 : 0; sequence = count + 1.
    Step 2 — Zero-pad to 5 digits
      Layman    : Gawing 5-digit (00001, 00042 …).
      Technical : String(count + 1).padStart(5, "0").
    Step 3 — Assemble the parts
      Layman    : Pagdugtungin: EC + taon + bilang + requestId.
      Technical : `EC-${year}-${padded}-${requestId}`.

  EXAMPLE
    // 41 requests already exist; new short ID is "9B1"
    generateControlNumber("9B1")  →  "EC-2026-00042-9B1"

  ⚠️ NOTE: the sequence is derived from getLastRow() at call time. Two submits
     in the same instant could compute the same count — acceptable at current
     volume, but worth knowing if throughput grows.
*/
function generateControlNumber(requestId) {
  const sheet = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const lastRow = sheet.getLastRow();
  const count = lastRow > 1 ? lastRow - 1 : 0; // subtract header row
  const padded = String(count + 1).padStart(5, "0");
  const year = new Date().getFullYear();
  return `EC-${year}-${padded}-${requestId}`;
}
