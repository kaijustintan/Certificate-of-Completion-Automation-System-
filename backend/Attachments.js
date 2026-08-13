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
  Phase 8 upload path: validateAttachmentPayload_ → uploadAttachmentFile_ (per
  file, throws on failure) → writeAttachmentRows_ (batched setValues). Called
  exclusively from submitNewRequest() in WebApp.js. Both carry a trailing
  underscore: they are internal primitives, and as bare globals they were
  reachable via google.script.run — uploadAttachmentFile_ writing arbitrary
  files into the corporate folder, writeAttachmentRows_ writing a
  caller-supplied Drive ID into RA.FILE_LINK that downloadAttachment then
  trusts. The legacy sync-finisher path is fully removed: addAttachment,
  checkAttachmentSync_, and deleteAttachment_ are all gone (see the REMOVED
  notes at their old locations below).

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  PHASE 8 — SUBMIT-TIME UPLOAD + GATED SERVING
    - validateAttachmentPayload_(files, requireAtLeastOne)  server-side payload guard
    - sanitizeAttachmentFilename_(name)    strip unsafe chars from uploaded filenames
    - uploadAttachmentFile_(file, driveName)  base64 → private DriveApp.createFile → {fileId, url}
    - buildAttachmentDriveName_(ctrl, n, fn)  "{control}__r{N}__{filename}" Drive name convention
    - writeAttachmentRows_(id, uploaded)   batch-write RA.* child rows (FILE = filename)
    - extractDriveId_(link)                pull a Drive file ID from a URL or bare id
    - downloadAttachment(attachmentId)    identity-gated file serving (base64) — no public link
*/


// ============================================================
// PHASE 8 — SUBMIT-TIME UPLOAD HELPERS
// Called by submitNewRequest() in WebApp.js.
// Flow: validate → upload all → write rows (all-or-nothing).
// Nothing touches either sheet until every Drive upload succeeds.
// ============================================================

/*
  ATTACHMENT_RULES_ — accepted file extensions and their magic-byte signatures.

  LAYMAN (Tropang Ex):
  Listahan ng mga file type na pinapayagan bilang supporting document, kasama ang
  "fingerprint" ng bawat isa. Yung fingerprint ay yung unang ilang byte sa loob ng
  file na nagsasabi kung ano talaga ito. Kaya kahit i-rename mo ang virus.exe
  papuntang resibo.pdf, mahuhuli pa rin kasi hindi nagsisimula sa %PDF ang laman.

  TECHNICAL:
  Extension (lowercase, no dot) → array of acceptable leading-byte signatures as
  uppercase hex. Checked by validateAttachmentPayload_ against fileSignatureHex_().
  Signature match is a PREFIX test, so a 3-byte signature (JPEG) and a 4-byte one
  (PDF) both work against the same 6-byte read.

  Note the collisions, which are correct and not a mistake:
    D0CF11E0 — OLE2 compound document, shared by legacy .doc and .xls
    504B0304 — ZIP container, shared by every OOXML format (.docx, .xlsx)
  So this proves the CONTAINER, not the document type. A .xlsx renamed to .docx
  passes, which is fine: both are accepted types and Drive stores the bytes as
  given. What it stops is an executable, script, or archive wearing a document
  extension.
*/
const ATTACHMENT_RULES_ = {
  pdf:  ["25504446"],   // %PDF
  doc:  ["D0CF11E0"],   // OLE2 compound document
  xls:  ["D0CF11E0"],   // OLE2 compound document
  docx: ["504B0304"],   // ZIP (OOXML)
  xlsx: ["504B0304"],   // ZIP (OOXML)
  jpg:  ["FFD8FF"],     // JPEG (SOI + marker)
  jpeg: ["FFD8FF"],
  png:  ["89504E47"],   // \x89PNG
};

/*
  ATTACHMENT_MIMES_ — accepted browser-reported MIME types.

  LAYMAN    : Yung sinasabi ng browser kung anong klaseng file ito. Advisory lang
              ito, hindi ito ang tunay na bantay, kasi kayang palitan ng kahit sino
              ang halagang ito bago ipadala.
  TECHNICAL : Client-supplied and therefore ADVISORY. "application/octet-stream"
              is deliberately allowed because browsers genuinely misreport valid
              PDFs and Office files that way, which is exactly why the magic-byte
              check exists as the real backstop.
*/
const ATTACHMENT_MIMES_ = {
  "application/pdf": true,
  "application/msword": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
  "application/vnd.ms-excel": true,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
  "image/jpeg": true,
  "image/jpg": true,
  "image/png": true,
  "application/octet-stream": true,   // browser fallback; magic bytes still decide
};

/*
  Function Name: fileSignatureHex_

  LAYMAN (Tropang Ex):
  Kinukuha ang unang ilang byte ng file (hindi buo, para mabilis) at ginagawang
  hex text para maihambing sa listahan ng fingerprints sa itaas.

  TECHNICAL:
  Decodes only the first 8 base64 characters, which is exactly 6 bytes with no
  padding involved, then renders them as uppercase hex. 6 bytes covers every
  signature in ATTACHMENT_RULES_ (longest is 4).

  ⚠️ Utilities.base64Decode returns Java SIGNED bytes (-128..127), so each value
  is masked with 0xFF before hexing. Without the mask, any leading byte above
  0x7F (which includes PNG's 0x89 and JPEG's 0xFF) would render negative and
  never match.

  PARAMS  : base64 — the raw base64 body (a data: prefix is tolerated).
  RETURNS : Uppercase hex string, or "" if there is not enough input to read.

  EXAMPLE
    fileSignatureHex_("JVBERi0xLjQ...")  → "255044462D312E"   // %PDF-1.
    fileSignatureHex_("iVBORw0KGgo...")  → "89504E470D0A1A"   // PNG
*/
function fileSignatureHex_(base64) {
  const head = String(base64 || "").replace(/^data:[^;]+;base64,/, "").substring(0, 8);
  if (head.length < 8) return "";
  const bytes = Utilities.base64Decode(head);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += ("0" + (bytes[i] & 0xFF).toString(16)).slice(-2);
  }
  return hex.toUpperCase();
}

/*
  Function Name: validateAttachmentPayload_

  LAYMAN (Tropang Ex):
  Ito ang "bouncer" bago makapasok ang kahit anong file sa Drive. Tinitingnan
  bawat file: may laman ba, may description ba, hindi ba sobrang laki, tama ba
  ang klase (PDF / Word / Excel / larawan), at ang pinaka-importante, tugma ba
  ang LAMAN sa extension. Kaya kung may mag-upload ng script na pinangalanang
  "resibo.pdf", tatanggihan ito dahil hindi naman talaga PDF ang laman.

  TECHNICAL:
  Pure validation, no I/O (base64Decode is in-memory). Called server-side before
  any upload attempt, so a rejection costs nothing and needs no rollback. Runs
  per file: required fields → description → extension allowlist → MIME allowlist
  → size floor/ceiling → magic-byte signature. Cheapest checks first.

  ⚠️ THE SIGNATURE CHECK IS THE ONLY REAL CONTROL. Filename, extension, and
  mimeType all arrive from the browser and can be anything the caller wants,
  because submitNewRequest/handleResubmit are reachable directly via
  google.script.run. The NewRequest.html accept= attribute and its client-side
  extension check are convenience, not security.

  ⚠️ Both entry points are covered automatically: submitNewRequest (requires
  ≥1 file) and handleResubmit (passes requireAtLeastOne = false).

  PARAMS:
  - files — Array<{ base64, filename, mimeType, description }>.
  - requireAtLeastOne — bool (default true). New-request submit requires ≥1 file;
    resubmit passes false (added files are optional there).

  RETURNS:
  { ok: true } or { ok: false, error: string } with a user-facing message.

  EXAMPLE
    validateAttachmentPayload_([])
    → { ok: false, error: "At least one supporting document is required." }
    validateAttachmentPayload_([], false)   // resubmit, no new files
    → { ok: true }
    validateAttachmentPayload_([{ base64:"JVBERi0...", filename:"PO.pdf",
                                 mimeType:"application/pdf", description:"PO" }])
    → { ok: true }
    // a .txt renamed to .pdf:
    validateAttachmentPayload_([{ base64:"aGVsbG8g...", filename:"PO.pdf", … }])
    → { ok: false, error: '"PO.pdf" does not appear to be a valid PDF file. …' }
*/
function validateAttachmentPayload_(files, requireAtLeastOne) {
  if (requireAtLeastOne === undefined) requireAtLeastOne = true;
  const MAX_FILE_BYTES  = 5  * 1024 * 1024;   // 5 MB per file (decoded)
  const MAX_TOTAL_BYTES = 15 * 1024 * 1024;   // 15 MB total across all files
  const MAX_FILE_COUNT  = 10;
  const MIN_FILE_BYTES  = 8;                  // enough bytes to read a signature

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
    // Formula-injection guard: the description is written into RA.DESCRIPTION.
    if (startsWithFormula_(f.description)) {
      return { ok: false, error: 'File descriptions must not start with "=" (file ' + (i + 1) + ': "' + f.filename + '").' };
    }

    // ── TYPE GATE (3 layers, cheapest first) ──────────────────────────────
    // Layers 1-2 are client-supplied and therefore advisory; layer 3 inspects
    // the actual bytes and is the real control.

    // Layer 1 — extension allowlist.
    var dot = String(f.filename).lastIndexOf(".");
    var ext = dot === -1 ? "" : String(f.filename).substring(dot + 1).toLowerCase();
    if (!ATTACHMENT_RULES_.hasOwnProperty(ext)) {
      return {
        ok: false,
        error: '"' + f.filename + '" is not an accepted file type. ' +
               "Allowed: PDF, Word (.doc/.docx), Excel (.xls/.xlsx), JPG, PNG.",
      };
    }

    // Layer 2 — browser-reported MIME allowlist.
    if (!ATTACHMENT_MIMES_.hasOwnProperty(String(f.mimeType).toLowerCase())) {
      return { ok: false, error: '"' + f.filename + '" has an unsupported content type (' + f.mimeType + ")." };
    }

    // Estimate decoded byte count from base64 string length (~75% of base64 length)
    var approxBytes = Math.floor(f.base64.length * 3 / 4);
    if (approxBytes > MAX_FILE_BYTES) {
      return { ok: false, error: '"' + f.filename + '" exceeds the 5 MB file size limit.' };
    }
    // Floor as well as ceiling: the signature read below needs real bytes, and a
    // near-empty file is a failed upload rather than a document worth storing.
    if (approxBytes < MIN_FILE_BYTES) {
      return { ok: false, error: '"' + f.filename + '" is empty or truncated.' };
    }

    // Layer 3 — magic bytes. This is what catches a .txt or .exe renamed to .pdf.
    // Decode is wrapped so malformed base64 surfaces as a clean validation error
    // instead of an uncaught throw inside a caller that has already uploaded files.
    var sig;
    try {
      sig = fileSignatureHex_(f.base64);
    } catch (sigErr) {
      return { ok: false, error: '"' + f.filename + '" could not be read. Please re-attach it.' };
    }
    var expected = ATTACHMENT_RULES_[ext];
    var signatureOk = false;
    for (var s = 0; s < expected.length; s++) {
      if (sig.indexOf(expected[s]) === 0) { signatureOk = true; break; }
    }
    if (!signatureOk) {
      return {
        ok: false,
        error: '"' + f.filename + '" does not appear to be a valid ' + ext.toUpperCase() +
               " file. Please re-save or re-export it and try again.",
      };
    }

    totalBytes += approxBytes;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return { ok: false, error: "Total file size exceeds 15 MB. Remove some files and try again." };
  }
  return { ok: true };
}


/*
  Function Name: sanitizeAttachmentFilename_
  LAYMAN    : Tinatanggal ang mga "mapanganib" na karakter sa filename para
              hindi magcause ng problema sa Drive o sa sheet.
  TECHNICAL : Strips OS-unsafe characters (path separators, control chars,
              drive specifiers). Falls back to "attachment" if result is empty.
  PARAMS    : name — raw filename string from the browser.
  RETURNS   : Safe filename string.
*/
function sanitizeAttachmentFilename_(name) {
  return String(name)
    .replace(/[\/\\<>:"|?*\x00-\x1f]/g, "_")
    .trim() || "attachment";
}


/*
  Function Name: uploadAttachmentFile_
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
              name from buildAttachmentDriveName_). Falls back to the sanitized
              original filename when omitted.
  RETURNS   : { fileId: string, url: string }.

  EXAMPLE
    uploadAttachmentFile_({ base64:"JVBERi0...", filename:"PO.pdf",
                           mimeType:"application/pdf" }, "EC-2026-00042-9B1__r0__PO.pdf")
    → { fileId: "1abc...", url: "https://drive.google.com/…" }
*/
function uploadAttachmentFile_(file, driveName) {
  // Resolved via Script Property with the Constants.js literal as fallback.
  // config_() throws a named error when neither is set — correct here, because
  // this function is documented to throw so submitNewRequest can roll back.
  var folderId = config_("ATTACHMENTS_FOLDER_ID");

  // Strip data:...;base64, prefix defensively — client should have done this already
  var base64Clean = file.base64.replace(/^data:[^;]+;base64,/, "");
  var bytes    = Utilities.base64Decode(base64Clean);
  var name     = driveName ? sanitizeAttachmentFilename_(driveName)
                           : sanitizeAttachmentFilename_(file.filename);
  var blob     = Utilities.newBlob(bytes, file.mimeType, name);
  var drv      = DriveApp.getFolderById(folderId).createFile(blob);

  // No setSharing — the file stays PRIVATE (owner-only). Access is exclusively
  // through the identity-gated downloadAttachment() server function. This removes
  // the bearer-link risk and works regardless of any domain sharing policy.

  return { fileId: drv.getId(), url: drv.getUrl() };
}


/*
  Function Name: buildAttachmentDriveName_
  LAYMAN    : Gumagawa ng pangalan ng file sa Drive na may control number at
              resubmit_ cycle, para kapag tiningnan sa raw na Drive folder,
              madaling makita kung aling request at aling cycle galing — lalo
              na pag may luma at bagong kopya pagkatapos mag-resubmit_.
  TECHNICAL : Returns "{controlNumber}__r{N}__{sanitized filename}". The display
              name in the sheet (RA.FILE) stays the friendly original filename;
              this convention is only the Drive object name for browsability.
  PARAMS    : controlNumber — request control number (e.g. EC-2026-00042-9B1).
              resubmitN — resubmit_ cycle (0 = first submit, 1+ = resubmits).
              filename — original filename.
  RETURNS   : Convention-formatted Drive file name string.

  EXAMPLE
    buildAttachmentDriveName_("EC-2026-00042-9B1", 0, "Quotation.pdf")
    → "EC-2026-00042-9B1__Original__Quotation.pdf"
    buildAttachmentDriveName_("EC-2026-00042-9B1", 2, "Quotation.pdf")
    → "EC-2026-00042-9B1__Resubmit-2__Quotation.pdf"
*/
function buildAttachmentDriveName_(controlNumber, resubmitN, filename) {
  var safeCtrl = sanitizeAttachmentFilename_(controlNumber || "EC");
  var safeName = sanitizeAttachmentFilename_(filename || "attachment");
  var n = parseInt(resubmitN) || 0;
  // Human-readable cycle label instead of a cryptic "r2": "Original" for the
  // first submission, "Resubmit-N" for the Nth resubmission.
  var label = (n === 0) ? "Original" : ("Resubmit-" + n);
  return safeCtrl + "__" + label + "__" + safeName;
}


/*
  Function Name: writeAttachmentRows_
  LAYMAN    : Isulat ang lahat ng attachment rows sa Request_Attachments sheet
              sa isang lakad — hindi isa-isa. Mas mabilis at mas atomic kaysa
              N na appendRow calls.
  TECHNICAL : Builds a 2D array of RA.* rows, then writes them all with a single
              sheet.getRange(...).setValues(rows2D). FILE stores the friendly
              original filename (for display); FILE_LINK stores the Drive URL
              (server-side only — never sent to the frontend; downloadAttachment
              extracts the fileId from it). APPENDS at getLastRow()+1, so resubmit_
              re-uploads keep the existing rows.
  PARAMS    : requestId — the parent request ID.
              uploaded  — Array<{ fileId, url, filename, description }>.
              cycle     — resubmit_ cycle the files belong to (0 = first submit).
  RETURNS   : (void).
*/
function writeAttachmentRows_(requestId, uploaded, cycle) {
  if (!uploaded || uploaded.length === 0) return;
  var sheet         = getSheet_(SHEET_NAMES.REQUEST_ATTACHMENTS);
  var uploader      = Session.getActiveUser().getEmail();
  var now           = new Date();
  var resubmitCycle = parseInt(cycle, 10) || 0;
  var rows2D = uploaded.map(function(u) {
    var r = new Array(8).fill("");
    r[RA.ATTACHMENT_ID  - 1] = generateRequestId_() + "-ATT";
    r[RA.REQUEST_ID     - 1] = requestId;
    r[RA.FILE           - 1] = String(u.filename || "attachment");  // friendly name for display
    r[RA.FILE_LINK      - 1] = u.url;                               // Drive URL — server-side only
    r[RA.DESCRIPTION    - 1] = String(u.description).trim();
    r[RA.RESUBMIT_CYCLE - 1] = resubmitCycle;
    r[RA.UPLOADED_BY    - 1] = uploader;
    r[RA.UPLOADED_AT    - 1] = now;
    return r;
  });
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows2D.length, 8).setValues(rows2D);
  // Sole writer of Request_Attachments → sole invalidation point for the
  // attachmentRows_() memo (Accessors.js). A new writer MUST invalidate too.
  invalidateAttachmentCache_();
  Logger.log("writeAttachmentRows_(): Wrote " + rows2D.length + " attachment rows for " + requestId);
}


/*
  Function Name: extractDriveId_
  LAYMAN    : Kinukuha ang Drive file ID mula sa isang URL (o ibinabalik mismo
              kung ID na). Ginagamit para mahanap ang file kapag may magdo-download.
  TECHNICAL : Matches the first 25+ char [-\w] run — works for both a full Drive
              URL (.../d/<id>/view) and a bare file ID. Returns "" if none found.
  PARAMS    : link — a Drive URL or bare file ID.
  RETURNS   : The file ID string, or "" if not found.
*/
function extractDriveId_(link) {
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
              getRequestDetail (requestor OR isChainApprover_ OR isAdmin_), then returns the
              file as base64 + mimeType + display filename. The 5 MB upload cap
              keeps the base64 payload within google.script.run limits.
  PARAMS    : attachmentId — the ATTACHMENT_ID value (e.g. "A3F-ATT").
  RETURNS   : { success:true, base64, mimeType, filename }
              { success:false, error } on not-found / unauthorized / read failure.

  STEPS
    Step 1 — Locate the attachment row
      Layman    : Hanapin ang attachment sa sheet gamit ang ID.
      Technical : attachmentRows_() memo scan matching ATTACHMENT_ID.
    Step 2 — Authorize via parent request
      Layman    : Requestor ka ba, approver ng request, o admin? Kung hindi → Unauthorized.
      Technical : getRequestRowData_(REQUEST_ID); sameEmail_(REQUESTOR) || isChainApprover_ || isAdmin_.
    Step 3 — Return the file bytes
      Layman    : Kunin ang file sa Drive, ibalik bilang base64.
      Technical : extractDriveId_(FILE_LINK) → DriveApp.getFileById().getBlob().

  EXAMPLE
    downloadAttachment("A3F-ATT")
    → { success:true, base64:"JVBERi0…", mimeType:"application/pdf", filename:"PO.pdf" }
    downloadAttachment("A3F-ATT")  // called by an unrelated user
    → { success:false, error:"Unauthorized" }
*/
function downloadAttachment(attachmentId) {
  const caller = Session.getActiveUser().getEmail();
  const rows   = attachmentRows_();   // memoized read — this is a pure lookup

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][RA.ATTACHMENT_ID - 1] === attachmentId) {
      const requestId = rows[i][RA.REQUEST_ID - 1];

      // Same gate as getRequestDetail: requestor, any chain approver, or admin.
      const parentRow = getRequestRowData_(requestId);
      if (!parentRow) return { success: false, error: "Request not found." };
      if (!sameEmail_(parentRow[CR.REQUESTOR - 1], caller) && !isChainApprover_(parentRow, caller) && !isAdmin_(caller)) {
        return { success: false, error: "Unauthorized" };
      }

      const fileId = extractDriveId_(rows[i][RA.FILE_LINK - 1]);
      if (!fileId) return { success: false, error: "Attachment file reference is invalid." };

      try {
        const blob = DriveApp.getFileById(fileId).getBlob();
        return {
          success:  true,
          base64:   Utilities.base64Encode(blob.getBytes()),
          mimeType: blob.getContentType(),
          filename: rows[i][RA.FILE - 1] || blob.getName(),
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
// LEGACY SYNC-FINISHER — REMOVED
// The old "submit-first, upload-later" flow (SYNCING status, expected
// attachment counts, checkAttachmentSync_) was replaced by Phase 8's
// mandatory upload-before-submit. checkAttachmentSync_ had become a
// permanent no-op and was deleted together with its only caller, the
// dormant onSheetChange trigger family in Triggers.js. Recover from git
// history (commit 06de263 and earlier) if ever needed.
// ============================================================

// ============================================================
// ADD ATTACHMENT ROW
// Writes a new attachment record to the Request_Attachments sheet.
// Called when a requestor uploads a file through the portal.
// Replaces AppSheet's automatic child row creation on file upload.
// ============================================================
// REMOVED: addAttachment(requestId, fileLink, description).
//
// Deprecated by Phase 8 (submitNewRequest writes rows via writeAttachmentRows_)
// and confirmed to have zero callers. Removed rather than kept-for-later because
// it was an active privilege-escalation path, not merely dead weight:
//
//   Its owner guard was correct — but it wrote the CALLER-SUPPLIED fileLink into
//   both RA.FILE and RA.FILE_LINK with no check that the ID points inside
//   ATTACHMENTS_FOLDER_ID. downloadAttachment() authorizes the *request*, then
//   trusts FILE_LINK. So on your OWN request you passed the guard and could then
//   read ANY file in the script owner's Drive, served with the owner's full
//   auth/drive scope. Ownership of a request is not ownership of a file.
//
// If a post-submit attachment flow is ever needed, reinstate it going through
// uploadAttachmentFile_ (which creates the file in the correct folder) — never by
// accepting a Drive ID from the client. Recover from git history for reference.


// REMOVED: deleteAttachment_(attachmentId) — row deletion for a requestor
// removing a file before resubmit. It had zero callers (the resubmit flow is
// deliberately append-only: prior files are kept as the audit trail and grouped
// as "Previous versions" in the UI), and a row-deleting primitive contradicts
// that design. Recover from git history (commit 06de263 and earlier) if a
// remove-before-resubmit flow is ever deliberately added.

// REMOVED: testDomainSharing() — a one-off diagnostic left over from the Phase 8
// sharing investigation. It had zero callers, no doc block, and as a callable
// global it let any authenticated user create + share + trash a file inside the
// production attachments folder on demand. The question it answered (does
// DOMAIN_WITH_LINK work on this account?) is now settled and recorded in the
// go-live runbook. Recover from git history if it is ever needed again.