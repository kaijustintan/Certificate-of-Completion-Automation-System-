// Attachments.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Attachments.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Lahat ng galaw ng attachments — mag-upload, mag-delete, at "sapat na ba
  yung na-upload?" — nandito. Kapalit ito ng AppSheet's Sync Finisher Bot na
  nagbabantay kung sapat na ang bilang ng files. Kapag nagdagdag ng attachment
  at naabot na ang expected count, ine-unlock nito ang request at ipinapadala
  na ang approval email sa unang approver.

  TECHNICAL:
  Manages Request_Attachments rows with owner-only guards (session identity),
  and implements the sync-finisher logic that unblocks SYNCING requests.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  - checkAttachmentSync(id)      unlock if actualCount >= expectedCount
  - addAttachment(id, link, desc) write attachment row + trigger sync check
  - deleteAttachment(attachId)    remove attachment row (owner-only)
*/


// ============================================================
// SYNC FINISHER
// Called every time a new attachment row is added.
// Checks if the required attachment count has been met.
// If yes — unlocks the parent request and starts approval routing.
// ============================================================
/*
  Function Name: checkAttachmentSync
  LAYMAN    : Tuwing may na-upload na file, tinitingnan kung sapat na bang lahat.
              Kapag natugunan na ang expected count, "ino-unlock" ang request —
              ibig sabihin nagsisimula na ang approval routing at inemail ang
              unang approver. Kapalit ng AppSheet Sync Finisher Bot.
  TECHNICAL : Reads currentStatus and expectedAttachments; no-ops if status ≠
              SYNCING; otherwise compares countAttachments() vs expected and on
              threshold sets STATUS=PENDING_1, STEP=1, triggers sendApprovalRequest.
  PARAMS    : requestId — the parent request to check.
  RETURNS   : (void)

  STEPS
    Step 1 — Locate parent row
      Layman    : Hanapin ang request; kung wala → log at exit.
      Technical : getRowNumberByRequestId; -1 → return.
    Step 2 — Guard: only act on SYNCING requests
      Layman    : Kung hindi "Syncing Files" ang status, wala na tayong gagawin.
      Technical : currentStatus !== STATUS.SYNCING → return.
    Step 3 — Compare actual vs expected
      Layman    : Bilang ng naka-upload vs bilang na kailangan.
      Technical : countAttachments(requestId) vs expectedAttachments.
    Step 4 — Unlock if threshold met
      Layman    : Sapat na → Pending Approver 1; padala ng email sa approver.
      Technical : setValue STATUS=PENDING_1, STEP=1; sendApprovalRequest.

  EXAMPLE
    // Request expects 2 files; 1 uploaded already; 2nd just added
    checkAttachmentSync("REQ-9b1")
    // → STATUS flips to "Pending Approver 1"; Approver 1 gets an email
*/
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
/*
  Function Name: addAttachment
  LAYMAN    : Idagdag ang isang file sa request. Requestor lang ng request
              ang pwede. Pagkatapos idagdag, agad ino-trigger ang sync check —
              baka ito na ang panghuli at makakapagsimula na ng approval.
  TECHNICAL : Owner-guard (session caller === REQUESTOR); appends a row to
              Request_Attachments; immediately calls checkAttachmentSync.
  PARAMS    : requestId — parent request; fileLink — Drive URL/ID;
              description — human label for the file.
  RETURNS   : { success:false, error } on guard failure; (void) on success.

  STEPS
    Step 1 — Authorize (owner-only)
      Layman    : Requestor ka ba ng request na ito? Kung hindi → Unauthorized.
      Technical : getRequestRowData; sameEmail(REQUESTOR, caller) gate.
    Step 2 — Build and append the attachment row
      Layman    : Gumawa ng bagong ID, isulat ang row sa Request_Attachments.
      Technical : attachmentId = generateRequestId() + "-ATT"; appendRow with RA.*
    Step 3 — Trigger sync check
      Layman    : Baka sapat na ang lahat — suriin agad.
      Technical : checkAttachmentSync(requestId).

  EXAMPLE
    addAttachment("REQ-9b1", "https://drive.google.com/…", "Purchase Order PDF")
    // → new row written; if this was the last required file, approval routing starts
*/
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
/*
  Function Name: deleteAttachment
  LAYMAN    : I-delete ang isang attachment. Para lang sa requestor ng parent
              request nito — ibang tao hindi pwede. Ginagamit pag nag-aalis
              ng file bago mag-resubmit.
  TECHNICAL : Scans Request_Attachments for the attachmentId, resolves its
              parent request, owner-guards, then deletes the row (+1 offset
              because sheet rows are 1-based).
  PARAMS    : attachmentId — the ATTACHMENT_ID value (e.g. "A3F-ATT").
  RETURNS   : { success:true } on delete; { success:false, error/message } on
              guard failure or not-found.

  STEPS
    Step 1 — Scan for the attachment row
      Layman    : Hanapin ang attachment row sa sheet.
      Technical : getAllData loop matching ATTACHMENT_ID; i → Sheet row i+1.
    Step 2 — Authorize via parent request
      Layman    : Kunin ang parent request; requestor ka ba? Kung hindi → Unauthorized.
      Technical : getRequestRowData(REQUEST_ID); sameEmail(REQUESTOR, caller) gate.
    Step 3 — Delete the row
      Layman    : Burahin ang row ng attachment.
      Technical : sheet.deleteRow(i + 1).

  EXAMPLE
    deleteAttachment("A3F-ATT")
    → { success:true }   // row deleted
    deleteAttachment("A3F-ATT")  // called by wrong user
    → { success:false, error:"Unauthorized" }
*/
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