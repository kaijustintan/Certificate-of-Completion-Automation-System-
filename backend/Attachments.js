// Attachments.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Attachments.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Lahat ng galaw ng attachments — mag-validate, mag-upload sa Drive,
  magsulat ng rows sa sheet, mag-delete — nandito. Phase 8 ang nagdagdag ng
  tatlong bagong functions para sa submit-time upload flow: bago may malikha
  na request row, lahat ng files ay ina-upload muna sa Drive; kung may pumalpak,
  awtomatikong nata-trash yung mga naunang naka-upload, at walang request na
  nalilikha. Kapalit ito ng lumang "honor-system" na Syncing Files flow.

  TECHNICAL:
  Phase 8 upload path: validateAttachmentPayload → uploadAttachmentFile (per
  file, throws on failure) → writeAttachmentRows (batched setValues). Called
  exclusively from submitNewRequest() in WebApp.js. The legacy sync-finisher
  path (checkAttachmentSync / addAttachment → checkAttachmentSync) remains in
  place but is deprecated-by-Phase-8; the new submit flow bypasses addAttachment
  entirely, so checkAttachmentSync is no longer on any live code path.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  PHASE 8 — SUBMIT-TIME UPLOAD + GATED SERVING (new)
    - validateAttachmentPayload(files, requireAtLeastOne)  server-side payload guard
    - sanitizeAttachmentFilename(name)    strip unsafe chars from uploaded filenames
    - uploadAttachmentFile(file, driveName)  base64 → private DriveApp.createFile → {fileId, url}
    - buildAttachmentDriveName(ctrl, n, fn)  "{control}__r{N}__{filename}" Drive name convention
    - writeAttachmentRows(id, uploaded)   batch-write RA.* child rows (FILE = filename)
    - extractDriveId(link)                pull a Drive file ID from a URL or bare id
    - downloadAttachment(attachmentId)    identity-gated file serving (base64) — no public link

  LEGACY SYNC-FINISHER (deprecated by Phase 8 — kept dormant)
    - checkAttachmentSync(id)             [DEPRECATED] unlock SYNCING → PENDING_1
    - addAttachment(id, link, desc)       [DEPRECATED] write row + call checkAttachmentSync
    - deleteAttachment(attachId)          remove attachment row (owner-only); still active
*/


// ============================================================
// PHASE 8 — SUBMIT-TIME UPLOAD HELPERS
// Called by submitNewRequest() in WebApp.js.
// Flow: validate → upload all → write rows (all-or-nothing).
// Nothing touches either sheet until every Drive upload succeeds.
// ============================================================

/*
  Function Name: validateAttachmentPayload
  LAYMAN    : Bago mag-upload ng kahit ano sa Drive, sinisiguro muna natin na
              valid ang lahat ng files: may laman, may description bawat isa,
              hindi sobrang laki. Ito ang "bouncer" bago pumasok sa Drive.
  TECHNICAL : Pure validation — no I/O. Called server-side before any upload
              attempt. Estimates decoded byte size from base64.length * 3/4.
              Returns { ok: true } or { ok: false, error: string }.
  PARAMS    : files — Array<{ base64, filename, mimeType, description }>.
              requireAtLeastOne — bool (default true). New-request submit requires
              ≥1 file; resubmit passes false (added files are optional there).
  RETURNS   : { ok: true } or { ok: false, error: string }.

  EXAMPLE
    validateAttachmentPayload([])
    → { ok: false, error: "At least one supporting document is required." }
    validateAttachmentPayload([], false)   // resubmit, no new files
    → { ok: true }
    validateAttachmentPayload([{ base64:"...", filename:"PO.pdf",
                                 mimeType:"application/pdf", description:"PO" }])
    → { ok: true }
*/
function validateAttachmentPayload(files, requireAtLeastOne) {
  if (requireAtLeastOne === undefined) requireAtLeastOne = true;
  const MAX_FILE_BYTES  = 5  * 1024 * 1024;   // 5 MB per file (decoded)
  const MAX_TOTAL_BYTES = 15 * 1024 * 1024;   // 15 MB total across all files
  const MAX_FILE_COUNT  = 10;

  if (!Array.isArray(files) || files.length === 0) {
    // Resubmit allows zero new files (the original attachments carry over).
    return requireAtLeastOne
      ? { ok: false, error: "At least one supporting document is required." }
      : { ok: true };
  }
  if (files.length > MAX_FILE_COUNT) {
    return { ok: false, error: "Maximum " + MAX_FILE_COUNT + " files allowed per request." };
  }

  var totalBytes = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || !f.base64 || !f.filename || !f.mimeType) {
      return { ok: false, error: "Malformed file payload — file " + (i + 1) + " is missing required fields." };
    }
    if (!f.description || !String(f.description).trim()) {
      return { ok: false, error: "Each file needs a description (file " + (i + 1) + ': "' + f.filename + '").' };
    }
    // Estimate decoded byte count from base64 string length (~75% of base64 length)
    var approxBytes = Math.floor(f.base64.length * 3 / 4);
    if (approxBytes > MAX_FILE_BYTES) {
      return { ok: false, error: '"' + f.filename + '" exceeds the 5 MB file size limit.' };
    }
    totalBytes += approxBytes;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return { ok: false, error: "Total file size exceeds 15 MB. Remove some files and try again." };
  }
  return { ok: true };
}


/*
  Function Name: sanitizeAttachmentFilename
  LAYMAN    : Tinatanggal ang mga "mapanganib" na karakter sa filename para
              hindi magcause ng problema sa Drive o sa sheet.
  TECHNICAL : Strips OS-unsafe characters (path separators, control chars,
              drive specifiers). Falls back to "attachment" if result is empty.
  PARAMS    : name — raw filename string from the browser.
  RETURNS   : Safe filename string.
*/
function sanitizeAttachmentFilename(name) {
  return String(name)
    .replace(/[\/\\<>:"|?*\x00-\x1f]/g, "_")
    .trim() || "attachment";
}


/*
  Function Name: uploadAttachmentFile
  LAYMAN    : I-upload ang isang file sa Google Drive. Ginagamit yung base64
              na napadala ng browser, gine-convert sa bytes, tapos ginagawa
              isang Drive file. Kapag may error, lumalabas ang exception para
              makapag-rollback ang caller.
  TECHNICAL : base64 → Utilities.base64Decode → Utilities.newBlob →
              DriveApp.getFolderById(COC.ATTACHMENTS_FOLDER_ID).createFile.
              The file is left PRIVATE — createFile() makes it owner-only by
              default, which is exactly the gated-serving model: no link sharing
              is set, so the file is reachable only via the identity-checked
              downloadAttachment() server function. Throws only on a real
              createFile failure (incl. empty ATTACHMENTS_FOLDER_ID) so the
              upload loop can catch + rollback in one place.
              Mirrors the DriveApp.createFile idiom in Certificate.js:257.
  PARAMS    : file — { base64, filename, mimeType } (one element of formData.files).
              driveName — optional Drive file name (e.g. the naming-convention
              name from buildAttachmentDriveName). Falls back to the sanitized
              original filename when omitted.
  RETURNS   : { fileId: string, url: string }.

  EXAMPLE
    uploadAttachmentFile({ base64:"JVBERi0...", filename:"PO.pdf",
                           mimeType:"application/pdf" }, "EC-2026-00042-9B1__r0__PO.pdf")
    → { fileId: "1abc...", url: "https://drive.google.com/…" }
*/
function uploadAttachmentFile(file, driveName) {
  if (!COC.ATTACHMENTS_FOLDER_ID) {
    throw new Error(
      "COC.ATTACHMENTS_FOLDER_ID is not configured. " +
      "Paste the supporting-docs Drive folder ID in Constants.js before accepting uploads."
    );
  }
  // Strip data:...;base64, prefix defensively — client should have done this already
  var base64Clean = file.base64.replace(/^data:[^;]+;base64,/, "");
  var bytes    = Utilities.base64Decode(base64Clean);
  var name     = driveName ? sanitizeAttachmentFilename(driveName)
                           : sanitizeAttachmentFilename(file.filename);
  var blob     = Utilities.newBlob(bytes, file.mimeType, name);
  var drv      = DriveApp.getFolderById(COC.ATTACHMENTS_FOLDER_ID).createFile(blob);

  // No setSharing — the file stays PRIVATE (owner-only). Access is exclusively
  // through the identity-gated downloadAttachment() server function. This removes
  // the bearer-link risk and works regardless of any domain sharing policy.

  return { fileId: drv.getId(), url: drv.getUrl() };
}


/*
  Function Name: buildAttachmentDriveName
  LAYMAN    : Gumagawa ng pangalan ng file sa Drive na may control number at
              resubmit cycle, para kapag tiningnan sa raw na Drive folder,
              madaling makita kung aling request at aling cycle galing — lalo
              na pag may luma at bagong kopya pagkatapos mag-resubmit.
  TECHNICAL : Returns "{controlNumber}__r{N}__{sanitized filename}". The display
              name in the sheet (RA.FILE) stays the friendly original filename;
              this convention is only the Drive object name for browsability.
  PARAMS    : controlNumber — request control number (e.g. EC-2026-00042-9B1).
              resubmitN — resubmit cycle (0 = first submit, 1+ = resubmits).
              filename — original filename.
  RETURNS   : Convention-formatted Drive file name string.

  EXAMPLE
    buildAttachmentDriveName("EC-2026-00042-9B1", 0, "Quotation.pdf")
    → "EC-2026-00042-9B1__r0__Quotation.pdf"
*/
function buildAttachmentDriveName(controlNumber, resubmitN, filename) {
  var safeCtrl = sanitizeAttachmentFilename(controlNumber || "EC");
  var safeName = sanitizeAttachmentFilename(filename || "attachment");
  return safeCtrl + "__r" + (parseInt(resubmitN) || 0) + "__" + safeName;
}


/*
  Function Name: writeAttachmentRows
  LAYMAN    : Isulat ang lahat ng attachment rows sa Request_Attachments sheet
              sa isang lakad — hindi isa-isa. Mas mabilis at mas atomic kaysa
              N na appendRow calls.
  TECHNICAL : Builds a 2D array of RA.* rows, then writes them all with a single
              sheet.getRange(...).setValues(rows2D). FILE stores the friendly
              original filename (for display); FILE_LINK stores the Drive URL
              (server-side only — never sent to the frontend; downloadAttachment
              extracts the fileId from it). APPENDS at getLastRow()+1, so resubmit
              re-uploads keep the existing rows.
  PARAMS    : requestId — the parent request ID.
              uploaded  — Array<{ fileId, url, filename, description }>.
  RETURNS   : (void).
*/
function writeAttachmentRows(requestId, uploaded) {
  if (!uploaded || uploaded.length === 0) return;
  var sheet   = getSheet(SHEET_NAMES.REQUEST_ATTACHMENTS);
  var rows2D  = uploaded.map(function(u) {
    var r = new Array(5).fill("");
    r[RA.ATTACHMENT_ID - 1] = generateRequestId() + "-ATT";
    r[RA.REQUEST_ID    - 1] = requestId;
    r[RA.FILE          - 1] = String(u.filename || "attachment");  // friendly name for display
    r[RA.FILE_LINK     - 1] = u.url;                               // Drive URL — server-side only
    r[RA.DESCRIPTION   - 1] = String(u.description).trim();
    return r;
  });
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows2D.length, 5).setValues(rows2D);
  Logger.log("writeAttachmentRows(): Wrote " + rows2D.length + " attachment rows for " + requestId);
}


/*
  Function Name: extractDriveId
  LAYMAN    : Kinukuha ang Drive file ID mula sa isang URL (o ibinabalik mismo
              kung ID na). Ginagamit para mahanap ang file kapag may magdo-download.
  TECHNICAL : Matches the first 25+ char [-\w] run — works for both a full Drive
              URL (.../d/<id>/view) and a bare file ID. Returns "" if none found.
  PARAMS    : link — a Drive URL or bare file ID.
  RETURNS   : The file ID string, or "" if not found.
*/
function extractDriveId(link) {
  var m = String(link || "").match(/[-\w]{25,}/);
  return m ? m[0] : "";
}


/*
  Function Name: downloadAttachment
  LAYMAN    : Ibinibigay ang laman ng isang attachment file — pero only kung ikaw
              ang requestor o isa sa mga approver ng request na iyon. Walang Drive
              link na ibinibigay kahit kanino; dumadaan lahat dito at sine-check
              muna ang pagkakakilanlan bago magbalik ng file. Ito ang nagpapanatili
              na private ang mga sensitive documents (e.g. NDAs).
  TECHNICAL : Identity-gated file serving. Scans Request_Attachments for the
              attachmentId, resolves the parent request, applies the SAME gate as
              getRequestDetail (requestor OR isChainApprover), then returns the
              file as base64 + mimeType + display filename. The 5 MB upload cap
              keeps the base64 payload within google.script.run limits.
  PARAMS    : attachmentId — the ATTACHMENT_ID value (e.g. "A3F-ATT").
  RETURNS   : { success:true, base64, mimeType, filename }
              { success:false, error } on not-found / unauthorized / read failure.

  STEPS
    Step 1 — Locate the attachment row
      Layman    : Hanapin ang attachment sa sheet gamit ang ID.
      Technical : getAllData(REQUEST_ATTACHMENTS) loop matching ATTACHMENT_ID.
    Step 2 — Authorize via parent request
      Layman    : Requestor ka ba o approver ng request? Kung hindi → Unauthorized.
      Technical : getRequestRowData(REQUEST_ID); sameEmail(REQUESTOR) || isChainApprover.
    Step 3 — Return the file bytes
      Layman    : Kunin ang file sa Drive, ibalik bilang base64.
      Technical : extractDriveId(FILE_LINK) → DriveApp.getFileById().getBlob().

  EXAMPLE
    downloadAttachment("A3F-ATT")
    → { success:true, base64:"JVBERi0…", mimeType:"application/pdf", filename:"PO.pdf" }
    downloadAttachment("A3F-ATT")  // called by an unrelated user
    → { success:false, error:"Unauthorized" }
*/
function downloadAttachment(attachmentId) {
  const caller  = Session.getActiveUser().getEmail();
  const allData = getAllData(SHEET_NAMES.REQUEST_ATTACHMENTS);

  for (let i = 1; i < allData.length; i++) {
    if (allData[i][RA.ATTACHMENT_ID - 1] === attachmentId) {
      const requestId = allData[i][RA.REQUEST_ID - 1];

      // Same gate as getRequestDetail: requestor or any chain approver only.
      const parentRow = getRequestRowData(requestId);
      if (!parentRow) return { success: false, error: "Request not found." };
      if (!sameEmail(parentRow[CR.REQUESTOR - 1], caller) && !isChainApprover(parentRow, caller)) {
        return { success: false, error: "Unauthorized" };
      }

      const fileId = extractDriveId(allData[i][RA.FILE_LINK - 1]);
      if (!fileId) return { success: false, error: "Attachment file reference is invalid." };

      try {
        const blob = DriveApp.getFileById(fileId).getBlob();
        return {
          success:  true,
          base64:   Utilities.base64Encode(blob.getBytes()),
          mimeType: blob.getContentType(),
          filename: allData[i][RA.FILE - 1] || blob.getName(),
        };
      } catch (err) {
        Logger.log("downloadAttachment(): read failed for " + attachmentId + " — " + err.message);
        return { success: false, error: "Could not read the file." };
      }
    }
  }

  return { success: false, error: "Attachment not found." };
}


// ============================================================
// LEGACY SYNC-FINISHER (deprecated by Phase 8)
// These functions implemented the old "submit-first, upload-later" flow
// where a request could sit in SYNCING status until files were attached.
// Phase 8 replaced this with mandatory upload-before-submit: every new
// request goes directly to PENDING_1 and arrives with all files already
// in Drive. checkAttachmentSync and the SYNCING branch are no longer
// on any live code path (submitNewRequest bypasses addAttachment entirely).
// They remain here for reference and will be removed in a future cleanup PR.
// The onSheetChange trigger (Triggers.js) is also DORMANT (unregistered);
// handleAttachmentChange → checkAttachmentSync is therefore never called.
// ============================================================

// ============================================================
// SYNC FINISHER
// Called every time a new attachment row is added.
// Checks if the required attachment count has been met.
// If yes — unlocks the parent request and starts approval routing.
// ============================================================
/*
  Function Name: checkAttachmentSync
  ⚠️ DEPRECATED by Phase 8 — no longer on any live code path. submitNewRequest()
  now uploads all files BEFORE creating the request row (no SYNCING state ever
  written). This function remains dormant pending a cleanup PR.

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
  ⚠️ DEPRECATED by Phase 8 — submitNewRequest() no longer calls this; it
  writes attachment rows directly via writeAttachmentRows(). This function
  remains available for any future post-submit attachment editing flow and
  pending cleanup. Do NOT call it from the new submit path.

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

function testDomainSharing() {
  var testBlob = Utilities.newBlob("test", "text/plain", "sharing-test.txt");
  var folder   = DriveApp.getFolderById(COC.ATTACHMENTS_FOLDER_ID);
  var file     = folder.createFile(testBlob);

  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log("✅ DOMAIN_WITH_LINK works — org-confidential sharing is available on this account.");
  } catch (e) {
    Logger.log("❌ DOMAIN_WITH_LINK failed: " + e.message);
    Logger.log("→ Files will fall back to ANYONE_WITH_LINK (anyone with the link can view).");
    Logger.log("→ Confirm with supervisor if this is acceptable for supporting documents.");
  } finally {
    file.setTrashed(true);
    Logger.log("Test file cleaned up.");
  }
}