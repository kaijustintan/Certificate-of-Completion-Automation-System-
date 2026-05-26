// Utils.js
// ============================================================
// Utils.js
// Shared helper functions used by every other file.
// These replace AppSheet's virtual columns and Ref lookups.
// ============================================================


// Get the spreadsheet this script is bound to
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}


// Get a specific sheet tab by name
function getSheet(sheetName) {
  return getSpreadsheet().getSheetByName(sheetName);
}


// Get ALL rows including the header row — returns a 2D array
// Each inner array = one row. Each element = one cell value.
// Example: data[0] = header row, data[1] = first data row
function getAllData(sheetName) {
  return getSheet(sheetName).getDataRange().getValues();
}


// Get data rows ONLY — header row removed
// Use this when you want to loop through actual records
function getDataRows(sheetName) {
  return getAllData(sheetName).slice(1);
}


// ============================================================
// APPROVER LOOKUP
// Replaces AppSheet's Ref: Certificate_Requests.Group
// → Approver_Settings.Group
// ============================================================

// Given a group name (e.g. "ISM - InfoSec"),
// find its row in Approver_Settings and return all 3 approvers.
// Returns null if group not found.
// Returns null for approver slots that are blank (currently all groups
// only have Approver 1 filled).
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


// ============================================================
// CURRENT APPROVER
// Replaces AppSheet's virtual column: Current Approver
// Formula was: IFS([Step]=1, Approver1, [Step]=2, Approver2, ...)
// ============================================================

// Given a Step value and group name, return the email of whoever
// should be acting on the request right now.
// Returns null if no approver is configured for that step.
function getCurrentApprover(step, groupName) {
  if (step === 0) return null; // returned to requestor, no approver
  const approvers = getApprovers(groupName);
  if (!approvers) return null;
  if (step === 1) return approvers.approver1;
  if (step === 2) return approvers.approver2;
  if (step === 3) return approvers.approver3;
  return null;
}


// ============================================================
// ATTACHMENT HELPERS
// Replaces AppSheet's REF_ROWS("Request_Attachments", "Request ID")
// and COUNT([Related Request_Attachments])
// ============================================================

// Get all attachment rows that belong to a specific request
function getAttachmentsForRequest(requestId) {
  const rows = getDataRows(SHEET_NAMES.REQUEST_ATTACHMENTS);
  return rows.filter(row => row[RA.REQUEST_ID - 1] === requestId);
}

// Count how many attachments have been uploaded for a request
function countAttachments(requestId) {
  return getAttachmentsForRequest(requestId).length;
}


// ============================================================
// ROW FINDER
// Gets the actual Sheet row number for a given Request ID
// Needed because getRange() requires a row number, not an array index
// ============================================================

// Returns the Sheet row number (1-based) for a given Request ID.
// Returns -1 if not found.
// Example: if REQ-001 is in row 5 of the sheet, this returns 5.
function getRowNumberByRequestId(requestId) {
  const allData = getAllData(SHEET_NAMES.CERTIFICATE_REQUESTS);
  for (let i = 1; i < allData.length; i++) {  // start at 1 to skip header
    if (allData[i][CR.REQUEST_ID - 1] === requestId) {
      return i + 1;  // +1 because Sheets rows are 1-based
    }
  }
  return -1;
}


// ============================================================
// DATE + TIME
// Replaces AppSheet's UTCNOW() + "008:00:00" (Philippine time)
// ============================================================

// Format any Date object to Philippine time string
// Example output: "May 26, 2026 02:30:00 PM"
function formatPHTime(date) {
  return Utilities.formatDate(date, "Asia/Manila", "MMMM dd, yyyy hh:mm:ss a");
}

// Get current timestamp as a formatted PH time string
function nowFormatted() {
  return formatPHTime(new Date());
}


// ============================================================
// ID GENERATORS
// Replaces AppSheet's UNIQUEID() and Control Number formula
// ============================================================

// Generate a short unique Request ID (3 uppercase characters)
// Matches AppSheet's LEFT(UNIQUEID(), 3) behavior
function generateRequestId() {
  return Utilities.getUuid().replace(/-/g, "").substring(0, 3).toUpperCase();
}

// Generate the full Control Number
// Format: EC-YYYY-NNNNN-XXX
// Example: EC-2026-00001-A3F
function generateControlNumber(requestId) {
  const sheet = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const lastRow = sheet.getLastRow();
  const count = lastRow > 1 ? lastRow - 1 : 0; // subtract header row
  const padded = String(count + 1).padStart(5, "0");
  const year = new Date().getFullYear();
  return `EC-${year}-${padded}-${requestId}`;
}