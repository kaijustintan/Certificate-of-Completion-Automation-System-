// Attachments.js
// ============================================================
// Attachments.js
// Handles file attachment validation and the sync finisher logic.
// Replaces AppSheet's Sync Finisher Bot (Event_ConfirmAttachments).
//
// AppSheet behavior:
//   - Bot watched Request_Attachments for new rows (Adds only)
//   - Condition: COUNT(attachments) >= Expected_Attachments
//   - Action: Set parent request Status to "Pending Approver 1"
// ============================================================


// ============================================================
// SYNC FINISHER
// Called every time a new attachment row is added.
// Checks if the required attachment count has been met.
// If yes — unlocks the parent request and starts approval routing.
// ============================================================
function checkAttachmentSync(requestId) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`checkAttachmentSync(): Parent request not found — ${requestId}`);
    return;
  }

  const rowData            = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const currentStatus      = rowData[CR.STATUS - 1];
  const expectedAttachments = rowData[CR.EXPECTED_ATTACHMENTS - 1];

  // Only act if the request is still waiting for files
  // If it's already past Syncing Files, do nothing
  if (currentStatus !== STATUS.SYNCING) {
    Logger.log(`checkAttachmentSync(): ${requestId} is not in Syncing Files — skipping`);
    return;
  }

  // Count how many files have actually been uploaded
  const actualCount = countAttachments(requestId);

  Logger.log(`checkAttachmentSync(): ${requestId} — ${actualCount}/${expectedAttachments} files uploaded`);

  // If required count is met — unlock the request
  if (actualCount >= expectedAttachments) {
    sheet.getRange(rowNum, CR.STATUS).setValue(STATUS.PENDING_1);
    sheet.getRange(rowNum, CR.STEP).setValue(1);

    Logger.log(`checkAttachmentSync(): ${requestId} — attachment count met, routing to Approver 1`);

    // Trigger the first approval email now that the request is unlocked
    sendApprovalRequest(requestId);
  }
}


// ============================================================
// ADD ATTACHMENT ROW
// Writes a new attachment record to the Request_Attachments sheet.
// Called when a requestor uploads a file through the portal.
// Replaces AppSheet's automatic child row creation on file upload.
// ============================================================
function addAttachment(requestId, fileLink, description) {
  // Only the requestor who owns the parent request may attach files to it.
  const caller    = Session.getActiveUser().getEmail();
  const parentRow = getRequestRowData(requestId);
  if (!parentRow) return { success: false, error: "Request not found." };
  if (!sameEmail(parentRow[CR.REQUESTOR - 1], caller)) {
    return { success: false, error: "Unauthorized" };
  }

  const sheet       = getSheet(SHEET_NAMES.REQUEST_ATTACHMENTS);
  const attachmentId = generateRequestId() + "-ATT"; // e.g. A3F-ATT

  const newRow = [];
  newRow[RA.ATTACHMENT_ID - 1] = attachmentId;
  newRow[RA.REQUEST_ID    - 1] = requestId;
  newRow[RA.FILE          - 1] = fileLink;   // Google Drive file ID or URL
  newRow[RA.FILE_LINK     - 1] = fileLink;
  newRow[RA.DESCRIPTION   - 1] = description;

  sheet.appendRow(newRow);

  Logger.log(`addAttachment(): Added ${attachmentId} for request ${requestId}`);

  // After adding the row, immediately check if sync is complete
  checkAttachmentSync(requestId);
}


// ============================================================
// DELETE ATTACHMENT ROW
// Removes an attachment record.
// Called if a requestor removes a file before resubmitting.
// ============================================================
function deleteAttachment(attachmentId) {
  const caller  = Session.getActiveUser().getEmail();
  const sheet   = getSheet(SHEET_NAMES.REQUEST_ATTACHMENTS);
  const allData = getAllData(SHEET_NAMES.REQUEST_ATTACHMENTS);

  for (let i = 1; i < allData.length; i++) {
    if (allData[i][RA.ATTACHMENT_ID - 1] === attachmentId) {
      // Only the requestor who owns the parent request may delete its files.
      const parentRow = getRequestRowData(allData[i][RA.REQUEST_ID - 1]);
      if (!parentRow || !sameEmail(parentRow[CR.REQUESTOR - 1], caller)) {
        return { success: false, error: "Unauthorized" };
      }
      sheet.deleteRow(i + 1); // +1 because sheet rows are 1-based
      Logger.log(`deleteAttachment(): Removed ${attachmentId}`);
      return { success: true };
    }
  }

  Logger.log(`deleteAttachment(): Attachment ID not found — ${attachmentId}`);
  return { success: false, message: "Attachment not found." };
}