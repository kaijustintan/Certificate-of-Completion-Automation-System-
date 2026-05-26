// Triggers.js
// ============================================================
// Triggers.js
// The nervous system — watches the Sheet for changes and
// calls the right functions in response.
//
// Replaces all 5 AppSheet bots:
//   - Next Approver Bot
//   - Decline Notification Bot
//   - Fully Approved Notification Bot
//   - Return Notification Bot
//   - Sync Finisher Bot
//
// HOW TRIGGERS WORK IN APPS SCRIPT:
// This file defines the functions. But you also need to
// register them as installable triggers in Apps Script.
// That is done once manually — instructions at the bottom.
// ============================================================


// ============================================================
// MAIN CHANGE HANDLER
// This is the function Google calls every time the Sheet changes.
// The 'e' parameter is the event object — it tells us what changed.
// ============================================================
function onSheetChange(e) {
  try {
    const sheet     = e.source.getActiveSheet();
    const sheetName = sheet.getName();

    // ── Route based on which sheet tab changed ──────────────

    if (sheetName === SHEET_NAMES.CERTIFICATE_REQUESTS) {
      handleCertificateRequestChange(e, sheet);
    }

    if (sheetName === SHEET_NAMES.REQUEST_ATTACHMENTS) {
      handleAttachmentChange(e, sheet);
    }

    // Approver_Settings changes don't trigger any automation

  } catch (err) {
    Logger.log(`onSheetChange() ERROR: ${err.message}`);
  }
}


// ============================================================
// CERTIFICATE REQUESTS CHANGE HANDLER
// Watches for Status column changes — same as AppSheet's
// [_THISROW_BEFORE].[Status] <> [_THISROW_AFTER].[Status] condition
// ============================================================
function handleCertificateRequestChange(e, sheet) {
  const range = e.range;
  const row   = range.getRow();

  // Ignore the header row
  if (row === 1) return;

  // Only care about changes in the Status column (Col C = column 3)
  const col = range.getColumn();
  if (col !== CR.STATUS) return;

  const newStatus = range.getValue();
  const rowData   = sheet.getRange(row, 1, 1, 31).getValues()[0];
  const requestId = rowData[CR.REQUEST_ID - 1];

  Logger.log(`handleCertificateRequestChange(): ${requestId} → Status = "${newStatus}"`);

  // ── Route based on new Status value ────────────────────────

  // Replaces: Next Approver Bot
  // Condition: CONTAINS([Status], "Pending Approver")
  if (newStatus.includes("Pending Approver")) {
    const expectedAttachments = rowData[CR.EXPECTED_ATTACHMENTS - 1];
    const actualCount         = countAttachments(requestId);

    // Only send approval email if attachments are satisfied
    // Replaces: OR([Expected_Attachments]=0,
    //              COUNT([Related Request_Attachments])>=[Expected_Attachments])
    if (expectedAttachments === 0 || actualCount >= expectedAttachments) {
      sendApprovalRequest(requestId);
    }
    return;
  }

  // Replaces: Decline Notification Bot
  // Condition: [Status] = "Declined"
  if (newStatus === STATUS.DECLINED) {
    sendDeclineToApprover(requestId);
    sendDeclineToRequestor(requestId);
    return;
  }

  // Replaces: Fully Approved Notification Bot
  // Condition: [Status] = "Fully Approved"
  if (newStatus === STATUS.APPROVED) {
    sendFullyApprovedToApprover(requestId);
    sendFullyApprovedToRequestor(requestId);
    return;
  }

  // Replaces: Return Notification Bot
  // Condition: STARTSWITH([Status], "Returned to")
  if (newStatus.startsWith("Returned to")) {
    sendReturnToRequestor(requestId);
    sendReturnConfirmToApprover(requestId);
    return;
  }
}


// ============================================================
// REQUEST ATTACHMENTS CHANGE HANDLER
// Watches for new rows added to Request_Attachments.
// Replaces: Sync Finisher Bot (Data Change Type: Adds only)
// ============================================================
function handleAttachmentChange(e, sheet) {
  const range     = e.range;
  const row       = range.getRow();

  // Ignore header row
  if (row === 1) return;

  // Only care about new rows being added — not edits to existing rows
  // A new row add will always start at column 1
  if (range.getColumn() !== 1) return;

  const rowData  = sheet.getRange(row, 1, 1, 5).getValues()[0];
  const requestId = rowData[RA.REQUEST_ID - 1];

  if (!requestId) return;

  Logger.log(`handleAttachmentChange(): New attachment detected for ${requestId}`);
  checkAttachmentSync(requestId);
}


// ============================================================
// TRIGGER REGISTRATION
// Run this function ONCE manually to register onSheetChange()
// as an installable trigger on the Sheet.
//
// HOW TO RUN IT:
//   1. Open Apps Script editor
//   2. Select "registerTrigger" from the function dropdown
//   3. Click Run
//   4. Done — you only need to do this once
//
// After registration, onSheetChange() fires automatically
// every time anyone edits the Sheet.
// ============================================================
function registerTrigger() {
  // Remove any existing triggers first to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "onSheetChange") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Register the new trigger
  ScriptApp.newTrigger("onSheetChange")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  Logger.log("registerTrigger(): onSheetChange trigger registered successfully.");
}