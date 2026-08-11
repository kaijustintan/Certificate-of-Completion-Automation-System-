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
    - getSpreadsheet_()          bound spreadsheet handle
    - getSheet_(name)            one tab by name
    - getAllData_(name)          all rows incl. header (2D array)
    - getDataRows_(name)         data rows only (header sliced off)

  APPROVER LOOKUP — MOVED to Accessors.js (now keyed by group_id, reads
    Groups / Group_Approvers). getApprovers_() / getCurrentApprover_() live there.

  ATTACHMENT HELPERS
    - getAttachmentsForRequest_(id)      attachment rows for one request
    - countAttachments_(id)              how many were uploaded

  ROW FINDER
    - getRowNumberByRequestId_(id)       array index → real Sheet row number

  DATE + TIME   (PH time, Asia/Manila)
    - formatPHTime_(date)                format a Date
    - nowFormatted_()                    formatted "now"

  ID GENERATORS
    - generateRequestId_()               short 3-char unique ID
    - generateControlNumber_(reqId)      EC-YYYY-NNNNN-XXX
*/


// =========================================================================================================
// SHEET ACCESS
// =========================================================================================================

/*
  Function Name: getSpreadsheet_
  LAYMAN    : Kunin ang buong Google Sheet file na naka-attach sa script.
  TECHNICAL : Returns the container-bound spreadsheet.
  PARAMS    : (none)
  RETURNS   : Spreadsheet object.
*/
function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}


/*
  Function Name: getSheet_
  LAYMAN    : Kunin ang isang partikular na tab (hal. "Certificate_Requests").
  TECHNICAL : Returns the Sheet for the given tab name.
  PARAMS    : sheetName — exact tab name (use SHEET_NAMES.*).
  RETURNS   : Sheet object, or null if no tab matches.
*/
function getSheet_(sheetName) {
  return getSpreadsheet_().getSheetByName(sheetName);
}


/*
  Function Name: getAllData_
  LAYMAN    : Kunin LAHAT ng laman ng tab, kasama ang header row, bilang 2D
              array (data[0] = header, data[1] = unang record).
  TECHNICAL : getDataRange().getValues() — the full used range as a 2D array.
  PARAMS    : sheetName — tab to read.
  RETURNS   : 2D array (rows × cells); index 0 is the header row.
  NOTE      : Use this (not getDataRows_) when you need the header or the true
              1-based Sheet row numbers.
*/
function getAllData_(sheetName) {
  return getSheet_(sheetName).getDataRange().getValues();
}


/*
  Function Name: getDataRows_
  LAYMAN    : Parang getAllData_ pero tinanggal na ang header — yung mga tunay
              na records na lang ang natitira, madaling i-loop.
  TECHNICAL : getAllData_(name).slice(1) — drops the header row.
  PARAMS    : sheetName — tab to read.
  RETURNS   : 2D array of data rows only (0-based; index 0 = first record).
  ⚠️ NOTE   : Header is gone, so array index i maps to Sheet row i+2. If you
              need the real row number, use getRowNumberByRequestId_().
*/
function getDataRows_(sheetName) {
  return getAllData_(sheetName).slice(1);
}


// =========================================================================================================
// APPROVER LOOKUP — moved to Accessors.js
// getApprovers_(groupId) and getCurrentApprover_(step, groupId) now live in
// Accessors.js, keyed by the surrogate group_id and reading the normalized
// Groups / Group_Approvers sheets. (One global scope — defining them here too
// would collide.)
// =========================================================================================================


// =========================================================================================================
// ATTACHMENT HELPERS
// Replaces AppSheet's REF_ROWS("Request_Attachments", "Request ID")
// and COUNT([Related Request_Attachments])
// =========================================================================================================

/*
  Function Name: getAttachmentsForRequest_
  LAYMAN    : Kunin lahat ng files na naka-attach sa isang request.
  TECHNICAL : Filters Request_Attachments by REQUEST_ID (string-compared to
              survive numeric/string ID drift between sheets).
  PARAMS    : requestId — the parent request's ID.
  RETURNS   : Array of attachment rows (empty array if none).
*/
function getAttachmentsForRequest_(requestId) {
  const rows   = getDataRows_(SHEET_NAMES.REQUEST_ATTACHMENTS);
  const target = String(requestId);
  return rows.filter(row => String(row[RA.REQUEST_ID - 1]) === target);
}

/*
  Function Name: countAttachments_
  LAYMAN    : Ilang files ba ang na-upload para sa request na ito?
  TECHNICAL : Length of getAttachmentsForRequest_(requestId).
  PARAMS    : requestId — the parent request's ID.
  RETURNS   : Number — count of attachments.
*/
function countAttachments_(requestId) {
  return getAttachmentsForRequest_(requestId).length;
}


// =========================================================================================================
// ROW FINDER
// Gets the actual Sheet row number for a given Request ID
// Needed because getRange() requires a row number, not an array index
// =========================================================================================================

/*
  Function Name: getRowNumberByRequestId_
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
      Technical : getAllData_() keeps the header, so allData[i] = Sheet row i+1.
    Step 2 — Loop from the first data row
      Layman    : Simula sa i=1 (laktawan ang header), hanapin ang tugma.
      Technical : for i = 1..n-1; string-compare REQUEST_ID.
    Step 3 — Return the Sheet row number
      Layman    : Pag tugma, ibalik i+1 (kasi 1-based ang Sheets).
      Technical : return i + 1; fall through to -1 if no match.

  EXAMPLE
    // REQ-9b1 is stored in Sheet row 5 (header is row 1)
    getRowNumberByRequestId_("REQ-9b1")  →  5
    getRowNumberByRequestId_("nope")     →  -1
*/
function getRowNumberByRequestId_(requestId) {
  const allData = getAllData_(SHEET_NAMES.REQUESTS);
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
  Function Name: formatPHTime_
  LAYMAN    : Gawing readable na PH-time text ang isang Date
              (hal. "May 26, 2026 02:30:00 PM").
  TECHNICAL : Utilities.formatDate(date, "Asia/Manila",
              "MMMM dd, yyyy hh:mm:ss a").
  PARAMS    : date — a JS Date object.
  RETURNS   : Formatted PH-time string.
*/
function formatPHTime_(date) {
  return Utilities.formatDate(date, "Asia/Manila", "MMMM dd, yyyy hh:mm:ss a");
}

/*
  Function Name: nowFormatted_
  LAYMAN    : Ang oras NGAYON, naka-format na sa PH time.
  TECHNICAL : formatPHTime_(new Date()).
  PARAMS    : (none)
  RETURNS   : Current timestamp as a PH-time string.
*/
function nowFormatted_() {
  return formatPHTime_(new Date());
}

/*
  Function Name: isContractExpired_
  LAYMAN    : Lapsed na ba ang contract ng request? Oo kung may Contract End
              Date at lumipas na ito. Blangko ang end date → hindi expired.
  TECHNICAL : Server-side comparison so the frontend never parses date strings.
              Compares end-of-day (23:59:59.999) of the contract-end date against
              now — a contract is NOT expired on its own end date, only after it.
              Invalid/unparseable values → false (treated as no end date).
  PARAMS    : rawEnd — the raw CR.CONTRACT_END cell value (Date, string, or blank).
  RETURNS   : Boolean.
*/
function isContractExpired_(rawEnd) {
  if (!rawEnd) return false;
  const end = new Date(rawEnd);
  if (isNaN(end.getTime())) return false;
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
}

/*
  Function Name: daysUntilContractEnd_
  LAYMAN    : Ilang araw bago (o pagkatapos) mag-expire ang contract? Positibo =
              hindi pa, 0 = expires today, negatibo = lumipas na. Blangko/invalid
              na petsa → null. Ginagamit ng daily expiry-reminder sweep (#10).
  TECHNICAL : Whole CALENDAR-day delta in Asia/Manila (not a raw ms/86.4M floor,
              which would drift with the time-of-day component). Both "today" and
              the contract-end date are reduced to their Manila yyyy-MM-dd, parsed
              as UTC midnights, then differenced — DST/tz-safe and stable
              regardless of when in the day the trigger runs.
  PARAMS    : rawEnd — the raw CR.CONTRACT_END cell value (Date, string, or blank).
  RETURNS   : Integer day delta (end − today), or null if blank/unparseable.

  EXAMPLE
    // today (Manila) = 2026-06-10
    daysUntilContractEnd_("2026-06-17")  → 7
    daysUntilContractEnd_("2026-06-10")  → 0
    daysUntilContractEnd_("2026-06-08")  → -2
    daysUntilContractEnd_("")            → null
*/
function daysUntilContractEnd_(rawEnd) {
  if (!rawEnd) return null;
  const end = new Date(rawEnd);
  if (isNaN(end.getTime())) return null;
  // Reduce both dates to a Manila calendar day, then to a UTC midnight, so the
  // subtraction is a clean integer count of days with no time-of-day component.
  const toManilaMidnightUTC = function (d) {
    const ymd = Utilities.formatDate(d, "Asia/Manila", "yyyy-MM-dd");
    return new Date(ymd + "T00:00:00Z").getTime();
  };
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const diff = toManilaMidnightUTC(end) - toManilaMidnightUTC(new Date());
  return Math.round(diff / MS_PER_DAY);
}


// =========================================================================================================
// ID GENERATORS
// Replaces AppSheet's UNIQUEID() and Control Number formula
// =========================================================================================================

/*
  Function Name: generateRequestId_
  LAYMAN    : Gumawa ng natatanging Request ID. Dating 3-char lang (4096 lang ang
              posible, kaya nagbabanggaan pagdami ng request). Ngayon buong UUID
              na, may "REQ-" prefix para hindi mabasang numero ng Sheets.
  TECHNICAL : "REQ-" + a dash-stripped, upper-cased UUID (32 hex chars). The
              prefix makes the value non-numeric so Sheets never coerces it
              (e.g. "1E3" -> 1000). The full width removes the birthday-collision
              risk that the old 3-char form had. submitNewRequest also
              regenerate-until-unique as a final guard.
  PARAMS    : (none)
  RETURNS   : Unique ID string (e.g. "REQ-A1B2C3D4E5F6...").
*/
function generateRequestId_() {
  return "REQ-" + Utilities.getUuid().replace(/-/g, "").toUpperCase();
}

/*
  Function Name: generateControlNumber_
  LAYMAN    : Buuin ang opisyal na control number ng request, format na
              EC-TAON-BILANG-XXX (hal. EC-2026-00001-9B1).
  TECHNICAL : Composes EC-<year>-<5-digit running count>-<requestId>, using the
              current row count as the sequence number.
  PARAMS    : requestId — the request's unique ID; its last 3 chars become the
              human-facing display suffix.
  RETURNS   : Control-number string.

  STEPS
    Step 1 — Compute the running sequence
      Layman    : Bilangin ilan nang request (minus header), +1 ang bago.
      Technical : count = lastRow > 1 ? lastRow - 1 : 0; sequence = count + 1.
    Step 2 — Zero-pad to 5 digits
      Layman    : Gawing 5-digit (00001, 00042 …).
      Technical : String(count + 1).padStart(5, "0").
    Step 3 — Assemble the parts
      Layman    : Pagdugtungin: EC + taon + bilang + huling 3 char ng requestId.
      Technical : `EC-${year}-${padded}-${suffix}`.

  EXAMPLE
    // 41 requests already exist; requestId ends in "9B1"
    generateControlNumber_("REQ-...9B1")  →  "EC-2026-00042-9B1"

  NOTE: the running count is derived from getLastRow(), so two truly-simultaneous
     submits could compute the same count. That is now cosmetic only: the suffix
     comes from the UNIQUE requestId, so the full control number still differs
     between the two. (A script lock on the count could remove even the cosmetic
     repeat, but is not needed for correctness now that the suffix is unique.)
*/
function generateControlNumber_(requestId) {
  const sheet = getSheet_(SHEET_NAMES.REQUESTS);
  const lastRow = sheet.getLastRow();
  const count = lastRow > 1 ? lastRow - 1 : 0; // subtract header row
  const padded = String(count + 1).padStart(5, "0");
  const year = new Date().getFullYear();
  const suffix = String(requestId).slice(-3).toUpperCase(); // human-facing display suffix
  return `EC-${year}-${padded}-${suffix}`;
}
