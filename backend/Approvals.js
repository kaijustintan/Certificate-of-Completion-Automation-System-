// Approvals.js
// ============================================================
// Approvals.js
// Core approval workflow actions.
// These are the four buttons from AppSheet translated into
// JavaScript functions.
//
// All functions take a requestId (string) as input,
// find the correct row in the Sheet, and update it.
// ============================================================


// ============================================================
// APPROVE
// AppSheet equivalent: Approve action
//   - Step = Step + 1
//   - Sets the correct AppN_Date timestamp
//   - Updates Status to next pending state or Fully Approved
// ============================================================
function approve(requestId) {
  const ss        = getSpreadsheet();
  const sheet     = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum    = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`approve(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData   = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const step      = rowData[CR.STEP - 1];
  const group     = rowData[CR.GROUP - 1];
  const approvers = getApprovers(group);

  if (!approvers) {
    Logger.log(`approve(): No approver config found for group — ${group}`);
    return { success: false, message: "Approver group not configured." };
  }

  const newStep = step + 1;
  const now     = new Date();

  // Determine which date column to stamp and what the new Status should be
  let dateCol, newStatus;

  if (step === 1) {
    dateCol   = CR.APP1_DATE;
    // If Approver 2 exists, route to them. Otherwise skip to 3 or fully approve.
    if (approvers.approver2) {
      newStatus = STATUS.PENDING_2;
    } else if (approvers.approver3) {
      newStatus = STATUS.PENDING_3;
    } else {
      newStatus = STATUS.APPROVED;
    }
  } else if (step === 2) {
    dateCol   = CR.APP2_DATE;
    newStatus = approvers.approver3 ? STATUS.PENDING_3 : STATUS.APPROVED;
  } else if (step === 3) {
    dateCol   = CR.APP3_DATE;
    newStatus = STATUS.APPROVED;
  } else {
    return { success: false, message: `Unexpected Step value: ${step}` };
  }

  // Write Step, Status, and the approval timestamp
  sheet.getRange(rowNum, CR.STEP).setValue(newStep);
  sheet.getRange(rowNum, CR.STATUS).setValue(newStatus);
  sheet.getRange(rowNum, dateCol).setValue(now);
  sheet.getRange(rowNum, CR.LAST_ACTION_BY).setValue(Session.getActiveUser().getEmail());

  Logger.log(`approve(): ${requestId} approved at Step ${step} → ${newStatus}`);
  return { success: true, newStatus, step: newStep };
}


// ============================================================
// DECLINE
// AppSheet equivalent: Decline action
//   - Status = "Declined"
// Note: declined requests cannot be resubmitted — requestor
// must file a brand new request (same behavior as AppSheet)
// ============================================================
function decline(requestId, approverRemark) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`decline(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const step    = rowData[CR.STEP - 1];

  // Write the remark into the correct approver remark column
  if (step === 1 && approverRemark) {
    sheet.getRange(rowNum, CR.APP1_REMARK).setValue(approverRemark);
  } else if (step === 2 && approverRemark) {
    sheet.getRange(rowNum, CR.APP2_REMARK).setValue(approverRemark);
  } else if (step === 3 && approverRemark) {
    sheet.getRange(rowNum, CR.APP3_REMARK).setValue(approverRemark);
  }

  sheet.getRange(rowNum, CR.STATUS).setValue(STATUS.DECLINED);
  sheet.getRange(rowNum, CR.LAST_ACTION_BY).setValue(Session.getActiveUser().getEmail());

  Logger.log(`decline(): ${requestId} declined at Step ${step}`);
  return { success: true, newStatus: STATUS.DECLINED };
}


// ============================================================
// RETURN REQUEST
// AppSheet equivalent: Return Request action
//   - Step = 0
//   - Status = "Returned to Requestor"
// Requestor receives notification and can resubmit
// ============================================================
function returnRequest(requestId, approverRemark) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`returnRequest(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const step    = rowData[CR.STEP - 1];

  // Write the remark into the correct approver remark column
  if (step === 1 && approverRemark) {
    sheet.getRange(rowNum, CR.APP1_REMARK).setValue(approverRemark);
  } else if (step === 2 && approverRemark) {
    sheet.getRange(rowNum, CR.APP2_REMARK).setValue(approverRemark);
  } else if (step === 3 && approverRemark) {
    sheet.getRange(rowNum, CR.APP3_REMARK).setValue(approverRemark);
  }

  sheet.getRange(rowNum, CR.STEP).setValue(0);
  sheet.getRange(rowNum, CR.STATUS).setValue(STATUS.RETURNED);
  sheet.getRange(rowNum, CR.LAST_ACTION_BY).setValue(Session.getActiveUser().getEmail());

  Logger.log(`returnRequest(): ${requestId} returned at Step ${step}`);
  return { success: true, newStatus: STATUS.RETURNED };
}


// ============================================================
// RESUBMIT
// AppSheet equivalent: Resubmit Request action
// Clears all approval history and restarts from Step 1.
// Only callable by the original requestor.
// ============================================================
function resubmit(requestId) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`resubmit(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData        = sheet.getRange(rowNum, 1, 1, 34).getValues()[0];
  const currentCount   = parseInt(rowData[CR.RESUBMIT_COUNT - 1]) || 0;
  const currentHistory = String(rowData[CR.RESUBMIT_HISTORY - 1] || "").trim();
  const newCount       = currentCount + 1;

  // handleReturn() wrote a "[PENDING] …" entry at return time, while
  // Step and the active user still pointed at the actual returner.
  // Promote that placeholder to a numbered Resubmit entry now.
  const confirmedHistory = currentHistory.replace(
    "[PENDING]",
    `Resubmit #${newCount} —`
  );

  sheet.getRange(rowNum, CR.RESUBMIT_COUNT).setValue(newCount);
  sheet.getRange(rowNum, CR.RESUBMIT_HISTORY).setValue(confirmedHistory);

  // If attachments are required, go back to Syncing Files first.
  // Otherwise go straight to Pending Approver 1.
  const expectedAttachments = rowData[CR.EXPECTED_ATTACHMENTS - 1] || 0;
  const newStatus = expectedAttachments > 0 ? STATUS.SYNCING : STATUS.PENDING_1;

  // Clear all approval history — same as AppSheet's Resubmit action
  sheet.getRange(rowNum, CR.STEP).setValue(1);
  sheet.getRange(rowNum, CR.STATUS).setValue(newStatus);
  sheet.getRange(rowNum, CR.APP1_DATE).setValue("");
  sheet.getRange(rowNum, CR.APP2_DATE).setValue("");
  sheet.getRange(rowNum, CR.APP3_DATE).setValue("");
  sheet.getRange(rowNum, CR.APP1_REMARK).setValue("");
  sheet.getRange(rowNum, CR.APP2_REMARK).setValue("");
  sheet.getRange(rowNum, CR.APP3_REMARK).setValue("");
  // Previous approvals are only relevant during the "returned" phase.
  sheet.getRange(rowNum, CR.PREVIOUS_APPROVALS).setValue("");

  Logger.log(`resubmit(): ${requestId} resubmitted (count: ${newCount}) → ${newStatus}`);
  return { success: true, newStatus };
}