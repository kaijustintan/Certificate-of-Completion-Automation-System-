// Certificate.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Certificate.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung "PDF machine" ng portal. Pag fully approved na ang isang request,
  kinukuha nito yung Google Docs template na puno ng mga placeholder, kinokopya,
  pinapalitan ang bawat placeholder ng totoong datos ng request, ginagawang PDF,
  itinatago sa Drive folder, at ibinabalik para maaaring i-email sa requestor.
  Ito ang Apps Script na kapalit ng dating AppSheet auto-generate-PDF na bot.

  TECHNICAL:
  Phase 9 COC generator. Single public entry point generateCOC(requestId):
  makeCopy() the template Doc → replaceText() each token via an ordered rules array
  → conditionally clear unused approver signatory cells → export application/pdf →
  archive to COC.ARCHIVE_FOLDER_ID → trash the temp copy → return { success, url,
  fileId, pdfBlob }. The Doc is built from the original AppSheet template, so the
  rules match BOTH the as-built AppSheet expressions (e.g. <<[Group]>>,
  <<TEXT(...)>>, <<IF(ISNOTBLANK(...))>>) AND clean {{tokens}} (used to fix any
  cell whose long expression broke across a line break). All AppSheet logic (TEXT
  formatting, IF ISNOTBLANK → "N/A", UTCNOW()+offset, <<If>> approver blocks) is
  ported here as plain JS. The signatory table is taken as the LAST table in the
  doc, and its approver-2/3 columns are cleared when those slots are unconfigured.
  Reads via getRequestRowData() (25-col Requests row) + getApprovers() (the
  Group_Approvers join) + getApprovalView() (action dates from Activity_Log).
  Identity/auth is NOT re-checked here — generateCOC runs after the approval
  flow has authorized + finalized the request; it is not a frontend-callable.

  ⚠️ SETUP: requires COC.TEMPLATE_DOC_ID set in Constants.js. See
  reference/COC_TEMPLATE_SPEC.md for the token contract + Doc build rules.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  PUBLIC
    - generateCOC(requestId)              copy template → fill → PDF → archive
  TEST
    - _testGenerateCOC()                  editor-run smoke test, logs the PDF URL
  HELPERS (private, coc_ prefix)
    - coc_orNA_(value)                    blank → "N/A" (ports IF ISNOTBLANK)
    - coc_fmtDate_(value, pattern, fb)    safe PH-time date format, blank → fallback
    - coc_clearCell_(table, r, c)         empty one table cell (hide approver col)
*/


// =========================================================================================================
// PUBLIC — COC GENERATION
// =========================================================================================================

/*
  Function Name: generateCOC

  LAYMAN (Tropang Ex):
  Bigyan mo ng requestId ng isang fully-approved na request, gagawa ito ng
  opisyal na Certificate of Completion PDF: kokopyahin ang template, papalitan
  ang mga {{placeholder}} ng totoong datos, itatago sa Drive folder, at ibabalik
  ang link + ang PDF mismo (para ma-attach sa email). Kung kulang ang approvers
  (hal. iisa lang), itatago nito ang hindi ginamit na signatory columns.

  TECHNICAL:
  Copies COC.TEMPLATE_DOC_ID, fills a token→value map via Body.replaceText(),
  clears signatory cells for unconfigured approvers 2/3, exports the copy as PDF,
  saves it to COC.ARCHIVE_FOLDER_ID, trashes the temp Doc, and returns a result
  object. On any failure the temp copy is trashed so no orphan Docs accumulate.
  Never throws to its caller — returns { success:false, error } instead, so a
  COC failure can be swallowed without blocking the approval that triggered it.

  PARAMS:
  - requestId — Request ID (CR.REQUEST_ID) of a fully-approved request.

  RETURNS:
  - On success: { success:true, fileId, url, fileName, pdfBlob } where pdfBlob is
    an application/pdf Blob ready for MailApp attachments.
  - On failure: { success:false, error } (template unset, request not found, or
    any Drive/Docs error).

  STEPS
    Step 1 — Guard: template configured
      Layman    : Kung wala pang naka-set na template Doc ID, huwag magpatuloy.
      Technical : Empty COC.TEMPLATE_DOC_ID → early { success:false } with a
                  setup hint. Avoids a cryptic Drive error.
    Step 2 — Load the request row + approvers
      Layman    : Kunin ang datos ng request at kung sinong approver(s) ng group.
      Technical : getRequestRowData (25-col Requests row) + getApprovers(group).
                  Missing row → { success:false }. Approvers default to {} so
                  token reads are null-safe.
    Step 3 — Copy the template Doc
      Layman    : Gumawa ng kopya ng template, pangalanan base sa control number.
      Technical : DriveApp.getFileById(TEMPLATE).makeCopy("COC - <ctrl>"). The
                  copy is the working document; the template stays untouched.
    Step 4 — Hide unused signatory columns (BEFORE replace)
      Layman    : Kung walang Approver 2/3, linisin ang kanilang column sa
                  signatory table para hindi lumabas na blangko.
      Technical : Take the LAST table in the body as the signatory table; clear
                  cells (row 0 + row 1) of column 3 and/or 2 when approver3/2 is
                  null. Done before replace so cleared cells carry no leftover text.
    Step 5 — Build the token→value rules
      Layman    : Itali ang bawat placeholder sa totoong datos, kasama ang
                  port-logic (N/A fallback, date formatting, PH timestamp).
      Technical : Ordered [pattern, value] array. Each field has an AppSheet-syntax
                  RE2 pattern (e.g. <<TEXT(\[Date of Filing\]…>>) AND a {{token}}
                  pattern. Dates via coc_fmtDate_; PRISM/PO/IHelp via coc_orNA_;
                  generated_at via formatPHTime(new Date()) (ports UTCNOW()+offset).
    Step 6 — Apply rules + strip leftover wrappers
      Layman    : Palitan ang bawat placeholder ng tamang value; tanggalin ang
                  natirang AppSheet <<If>>/<<EndIf>> sa signatory.
      Technical : For each rule, body.replaceText(pattern, value) (null → ""); then
                  replaceText "<<If:[^>]*>>" and "<<EndIf>>" with "".
    Step 7 — Export to PDF
      Layman    : Gawing PDF ang napunong Doc.
      Technical : saveAndClose(), then getFileById(copyId).getAs("application/pdf").
    Step 8 — Archive + clean up
      Layman    : Itago ang PDF sa Drive folder, tapos burahin ang pansamantalang
                  Doc copy.
      Technical : folder.createFile(pdfBlob); copy.setTrashed(true).

  EXAMPLE
    generateCOC("REQ-9b1")
    → { success:true, fileId:"1AbC…", url:"https://drive.google.com/…",
        fileName:"COC - EC-2026-00042-9B1.pdf", pdfBlob:Blob }
    generateCOC("REQ-9b1")  // before COC.TEMPLATE_DOC_ID is set
    → { success:false, error:"COC.TEMPLATE_DOC_ID is not set …" }
*/
function generateCOC(requestId) {
  // Step 1 — Guard: template configured
  if (!COC.TEMPLATE_DOC_ID) {
    return {
      success: false,
      error: "COC.TEMPLATE_DOC_ID is not set. Build the template Doc and paste its ID into Constants.js (see reference/COC_TEMPLATE_SPEC.md).",
    };
  }

  // Step 2 — Load the request row + approvers
  const row = getRequestRowData(requestId);
  if (!row) return { success: false, error: "Request not found: " + requestId };

  // Guard: only a chain approver of this request or an admin may generate or
  // re-issue its certificate, and only once it is fully approved. In the normal
  // flow the final approver triggers this via sendFullyApprovedToRequestor.
  const cocCaller = Session.getActiveUser().getEmail();
  if (!(isChainApprover(row, cocCaller) || isAdmin(cocCaller))) {
    return { success: false, error: "Unauthorized" };
  }
  if (row[CR.STATUS - 1] !== STATUS.APPROVED) {
    return { success: false, error: "Certificate can only be generated for a fully approved request." };
  }

  const group         = row[CR.GROUP - 1];           // group_id
  const groupName     = getGroupNameById(group);     // display name for the COC
  const approvers     = getApprovers(group) || {};
  const controlNumber = row[CR.CONTROL_NUMBER - 1] || requestId;
  const copyName      = "COC - " + controlNumber;

  // Per-step approval dates come from the Approval_Actions timeline (the request
  // is fully approved when this runs, so every configured step has an approved action).
  const _view   = getApprovalView(requestId);
  const appDate = function (n) { return (_view.byStep[n] && _view.byStep[n].date) || ""; };

  // Step 3 — Copy the template Doc (inside the try so a bad or inaccessible
  // template ID returns { success:false } instead of throwing, honoring the
  // never-throws contract the callers rely on).
  let copyId = null;

  try {
    copyId = DriveApp.getFileById(COC.TEMPLATE_DOC_ID).makeCopy(copyName).getId();
    const doc  = DocumentApp.openById(copyId);
    const body = doc.getBody();

    // Step 4 — Hide unused signatory columns (before replace).
    // The signatory table is the LAST table in the document (reliable regardless
    // of text content or token style). Unused approver columns (2/3) are cleared
    // when the group has no configured approver (ports the AppSheet <<If>> block).
    const allTables = body.getTables();
    const sigTable  = allTables.length > 0 ? allTables[allTables.length - 1] : null;
    if (sigTable) {
      // Clear both row 0 (label row) and row 1 (content row) for unused approver
      // columns — handles both single-row and two-row signatory table layouts.
      // coc_clearCell_ silently swallows out-of-range errors, so this is safe.
      if (!approvers.approver3) { coc_clearCell_(sigTable, 0, 3); coc_clearCell_(sigTable, 1, 3); }
      if (!approvers.approver2) { coc_clearCell_(sigTable, 0, 2); coc_clearCell_(sigTable, 1, 2); }
    }

    // Step 5 — Build the AppSheet-token → value rules.
    // Each pattern is an RE2 regex matching the original AppSheet expression as it
    // appears in the Doc, tolerant to spacing/quote variations via [^>]* and the
    // "." wildcard (e.g. for the apostrophe in "Requestor's"). All AppSheet logic
    // (TEXT formatting, IF ISNOTBLANK → "N/A", UTCNOW()+offset) is resolved here.
    const rules = [
      ["<<\\[Group\\]\\.\\[Approver 1\\]>>",        approvers.approver1],
      ["<<\\[Group\\]\\.\\[App 1 Designation\\]>>", approvers.designation1],
      ["<<\\[Group\\]\\.\\[Approver 2\\]>>",        approvers.approver2],
      ["<<\\[Group\\]\\.\\[App 2 Designation\\]>>", approvers.designation2],
      ["<<\\[Group\\]\\.\\[Approver 3\\]>>",        approvers.approver3],
      ["<<\\[Group\\]\\.\\[App 3 Designation\\]>>", approvers.designation3],
      ["<<\\[Group\\]>>",                           groupName],
      ["<<\\[Control Number\\]>>",                  controlNumber],
      ["<<TEXT\\(\\[Date of Filing\\][^>]*MMMM[^>]*>>",       coc_fmtDate_(row[CR.DATE_OF_FILING - 1], "MMMM dd, yyyy", "")],
      ["<<TEXT\\(\\[Date of Filing\\][^>]*MM-dd-yyyy[^>]*>>", coc_fmtDate_(row[CR.DATE_OF_FILING - 1], "MM-dd-yyyy", "")],
      ["<<UTCNOW\\(\\)[^>]*>>",                     formatPHTime(new Date())],
      ["<<\\[Project Title\\]>>",                   row[CR.PROJECT_TITLE - 1]],
      ["<<\\[Requestor.s Designation\\]>>",         row[CR.REQUESTOR_DESIG - 1]],
      ["<<\\[Requestor\\]>>",                       row[CR.REQUESTOR - 1]],
      ["<<\\[Accountable Person\\]>>",              row[CR.ACCOUNTABLE_PERSON - 1]],
      ["<<\\[Department\\]>>",                      row[CR.DEPARTMENT - 1]],
      ["<<\\[Location\\]>>",                        row[CR.LOCATION - 1]],
      ["<<\\[PC Name\\]>>",                         row[CR.PC_NAME - 1]],
      ["<<IF\\(ISNOTBLANK\\(\\[PRISM\\]\\)[^>]*>>",          coc_orNA_(row[CR.PRISM - 1])],
      ["<<IF\\(ISNOTBLANK\\(\\[Purchase Order\\]\\)[^>]*>>", coc_orNA_(row[CR.PURCHASE_ORDER - 1])],
      ["<<IF\\(ISNOTBLANK\\(\\[IHelp Number\\]\\)[^>]*>>",   coc_orNA_(row[CR.IHELP_NUMBER - 1])],
      ["<<\\[Product Type\\]>>",                    row[CR.PRODUCT_TYPE - 1]],
      ["<<\\[Product Name\\]>>",                    row[CR.PRODUCT_NAME - 1]],
      ["<<\\[Type of Purchase\\]>>",                row[CR.TYPE_OF_PURCHASE - 1]],
      ["<<\\[Type of License\\]>>",                 row[CR.TYPE_OF_LICENSE - 1]],
      ["<<\\[Contract Start Date\\]>>",             coc_fmtDate_(row[CR.CONTRACT_START - 1], "MMM dd, yyyy", "N/A")],
      ["<<\\[Contract End Date\\]>>",               coc_fmtDate_(row[CR.CONTRACT_END - 1], "MMM dd, yyyy", "N/A")],
      ["<<\\[Supplier Name\\]>>",                   row[CR.SUPPLIER_NAME - 1]],
      ["<<\\[Requestor.s Remark\\]>>",              row[CR.REQUESTOR_REMARK - 1]],
      ["<<TEXT\\(\\[App1_Date\\][^>]*>>",           coc_fmtDate_(appDate(1), "MM-dd-yyyy HH:mm:ss", "")],
      ["<<TEXT\\(\\[App2_Date\\][^>]*>>",           coc_fmtDate_(appDate(2), "MM-dd-yyyy HH:mm:ss", "")],
      ["<<TEXT\\(\\[App3_Date\\][^>]*>>",           coc_fmtDate_(appDate(3), "MM-dd-yyyy HH:mm:ss", "")],

      // ── Clean {{token}} equivalents ──────────────────────────────────────
      // Use these to fix any cell whose long AppSheet expression got broken
      // across a line break. Short tokens never wrap, so they always match.
      ["\\{\\{group\\}\\}",               group],
      ["\\{\\{control_number\\}\\}",      controlNumber],
      ["\\{\\{date_of_filing_long\\}\\}", coc_fmtDate_(row[CR.DATE_OF_FILING - 1], "MMMM dd, yyyy", "")],
      ["\\{\\{generated_at\\}\\}",        formatPHTime(new Date())],
      ["\\{\\{project_title\\}\\}",       row[CR.PROJECT_TITLE - 1]],
      ["\\{\\{requestor\\}\\}",           row[CR.REQUESTOR - 1]],
      ["\\{\\{requestor_desig\\}\\}",     row[CR.REQUESTOR_DESIG - 1]],
      ["\\{\\{accountable_person\\}\\}",  row[CR.ACCOUNTABLE_PERSON - 1]],
      ["\\{\\{department\\}\\}",          row[CR.DEPARTMENT - 1]],
      ["\\{\\{location\\}\\}",            row[CR.LOCATION - 1]],
      ["\\{\\{pc_name\\}\\}",             row[CR.PC_NAME - 1]],
      ["\\{\\{prism\\}\\}",               coc_orNA_(row[CR.PRISM - 1])],
      ["\\{\\{po_no\\}\\}",               coc_orNA_(row[CR.PURCHASE_ORDER - 1])],
      ["\\{\\{ihelp\\}\\}",               coc_orNA_(row[CR.IHELP_NUMBER - 1])],
      ["\\{\\{product_type\\}\\}",        row[CR.PRODUCT_TYPE - 1]],
      ["\\{\\{product_name\\}\\}",        row[CR.PRODUCT_NAME - 1]],
      ["\\{\\{type_purchase\\}\\}",       row[CR.TYPE_OF_PURCHASE - 1]],
      ["\\{\\{type_license\\}\\}",        row[CR.TYPE_OF_LICENSE - 1]],
      ["\\{\\{contract_start\\}\\}",      coc_fmtDate_(row[CR.CONTRACT_START - 1], "MMM dd, yyyy", "N/A")],
      ["\\{\\{contract_end\\}\\}",        coc_fmtDate_(row[CR.CONTRACT_END - 1], "MMM dd, yyyy", "N/A")],
      ["\\{\\{supplier\\}\\}",            row[CR.SUPPLIER_NAME - 1]],
      ["\\{\\{requestor_remark\\}\\}",    row[CR.REQUESTOR_REMARK - 1]],
      ["\\{\\{prepared_date\\}\\}",       coc_fmtDate_(row[CR.DATE_OF_FILING - 1], "MM-dd-yyyy", "")],
      ["\\{\\{approver1\\}\\}",           approvers.approver1],
      ["\\{\\{desig1\\}\\}",              approvers.designation1],
      ["\\{\\{app1_date\\}\\}",           coc_fmtDate_(appDate(1), "MM-dd-yyyy HH:mm:ss", "")],
      ["\\{\\{approver2\\}\\}",           approvers.approver2],
      ["\\{\\{desig2\\}\\}",              approvers.designation2],
      ["\\{\\{app2_date\\}\\}",           coc_fmtDate_(appDate(2), "MM-dd-yyyy HH:mm:ss", "")],
      ["\\{\\{approver3\\}\\}",           approvers.approver3],
      ["\\{\\{desig3\\}\\}",              approvers.designation3],
      ["\\{\\{app3_date\\}\\}",           coc_fmtDate_(appDate(3), "MM-dd-yyyy HH:mm:ss", "")],
    ];

    // Step 6 — Apply every rule, then strip any leftover AppSheet <<If:…>> /
    // <<EndIf>> conditional wrappers that remain in kept signatory columns.
    rules.forEach(function (rule) {
      const value = rule[1] == null ? "" : String(rule[1]);
      body.replaceText(rule[0], value);
    });
    body.replaceText("<<If:[^>]*>>", "");
    body.replaceText("<<EndIf>>", "");

    doc.saveAndClose();

    // Step 7 — Export to PDF
    const pdfBlob = DriveApp.getFileById(copyId)
      .getAs("application/pdf")
      .setName(copyName + ".pdf");

    // Step 8 — Archive + clean up
    const pdfFile = DriveApp.getFolderById(COC.ARCHIVE_FOLDER_ID).createFile(pdfBlob);
    DriveApp.getFileById(copyId).setTrashed(true);

    // Step 9 — Record the generated certificate in COC_PDFs (one row per issue).
    // Defensive: a logging failure must never block the COC/email side-effects.
    try {
      const cocSheet = getSheet(SHEET_NAMES.COC_PDFS);
      const cocRow = new Array(6).fill("");
      cocRow[COCPDF.COC_ID - 1]         = generateCocId();
      cocRow[COCPDF.REQUEST_ID - 1]     = requestId;
      cocRow[COCPDF.CONTROL_NUMBER - 1] = controlNumber;
      cocRow[COCPDF.PDF_LINK - 1]       = pdfFile.getUrl();
      cocRow[COCPDF.DRIVE_FILE_ID - 1]  = pdfFile.getId();
      cocRow[COCPDF.GENERATED_AT - 1]   = new Date();
      cocSheet.appendRow(cocRow);
    } catch (e) {
      Logger.log("generateCOC(): COC_PDFs log failed — " + e.message);
    }

    return {
      success:  true,
      fileId:   pdfFile.getId(),
      url:      pdfFile.getUrl(),
      fileName: pdfFile.getName(),
      pdfBlob:  pdfBlob,
    };
  } catch (err) {
    // Best-effort cleanup of the temp copy so failures don't orphan Docs
    if (copyId) { try { DriveApp.getFileById(copyId).setTrashed(true); } catch (e) {} }
    return { success: false, error: String(err) };
  }
}


// =========================================================================================================
// TEST — editor-run smoke test
// =========================================================================================================

/*
  Function Name: _testGenerateCOC
  LAYMAN    : Pang-test lang sa Apps Script editor. PALITAN mo ang TEST_REQUEST_ID
              sa baba ng totoong Request ID, i-Run ito (walang argument na kailangan
              kasi hindi makakapagpasa ng argument ang editor), tapos buksan ang
              naka-log na PDF link para tingnan kung tama lahat ng fields.
  TECHNICAL : No-arg wrapper around generateCOC so the Apps Script editor's Run
              button works (Run cannot pass arguments). Edit TEST_REQUEST_ID, then
              run. Logs only the serializable fields (pdfBlob omitted).
  PARAMS    : (none) — edit the TEST_REQUEST_ID constant below.
  RETURNS   : The raw generateCOC result (incl. pdfBlob).
*/
function _testGenerateCOC() {
  const TEST_REQUEST_ID = "578"; // ← edit this, then Run
  const res = generateCOC(TEST_REQUEST_ID);
  Logger.log(JSON.stringify({ success: res.success, url: res.url, fileName: res.fileName, error: res.error }, null, 2));
  return res;
}


// =========================================================================================================
// HELPERS (private) — AppSheet expression ports + Doc utilities
// =========================================================================================================

/*
  Function Name: coc_orNA_
  LAYMAN    : Kung blangko ang value, "N/A" ang ilalagay. Kapalit ng AppSheet
              IF(ISNOTBLANK([x]), [x], "N/A").
  TECHNICAL : Returns "N/A" for null/undefined/whitespace-only; else String(value).
  PARAMS    : value — any cell value.
  RETURNS   : Non-empty string ("N/A" fallback).
*/
function coc_orNA_(value) {
  if (value == null || String(value).trim() === "") return "N/A";
  return String(value);
}

/*
  Function Name: coc_fmtDate_
  LAYMAN    : Gawing readable na PH-time text ang isang petsa sa ibinigay na
              format. Kung blangko o hindi petsa, ibalik ang fallback.
  TECHNICAL : Accepts Date or date-string; formats via Utilities.formatDate in
              "Asia/Manila". Invalid/blank → fallback.
  PARAMS    : value — Date or string from a sheet cell.
              pattern — Java date pattern (e.g. "MM-dd-yyyy HH:mm:ss").
              fallback — string returned for blank/invalid input.
  RETURNS   : Formatted PH-time string, or fallback.
*/
function coc_fmtDate_(value, pattern, fallback) {
  if (value == null || String(value).trim() === "") return fallback;
  const d = (value instanceof Date) ? value : new Date(value);
  if (isNaN(d.getTime())) return fallback;
  return Utilities.formatDate(d, "Asia/Manila", pattern);
}

/*
  Function Name: coc_clearCell_
  LAYMAN    : Linisin (gawing blangko) ang isang cell ng table — ginagamit para
              itago ang signatory column ng approver na walang laman.
  TECHNICAL : table.getCell(r, c).clear(); wrapped in try/catch so an out-of-range
              cell (template built with fewer columns) fails silently rather than
              aborting the whole PDF.
  PARAMS    : table — a Table; r, c — 0-based row/column indices.
  RETURNS   : (none)
*/
function coc_clearCell_(table, r, c) {
  try { table.getCell(r, c).clear(); } catch (e) {}
}

