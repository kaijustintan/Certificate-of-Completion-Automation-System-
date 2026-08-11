// Certificate.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Certificate.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung "PDF machine" ng portal. Pag fully approved na ang isang request,
  binubuo nito ang Certificate of Completion mismo galing sa code, tapos
  ginagawang PDF at itinatago sa Drive folder para ma-email sa requestor.

  DATING PARAAN (tinanggal na): may hiwalay na Google Docs template na puno ng
  mga <<[placeholder]>>, kinokopya yun, tapos pinapalitan isa-isa ang mga token.
  Ang problema, nasa labas ng code ang disenyo: hindi mo makikita sa git kung
  sino ang nag-edit, walang review, at kapag may nagbago sa Doc, tahimik na
  nagbabago ang LAHAT ng susunod na certificate. Ngayon, ang disenyo ay nasa
  file na ito, kaya diffable, nare-review, at hindi mababago nang aksidente.

  TECHNICAL:
  COC generator. Single entry point generateCOC_(requestId): resolve values →
  buildCertificateHtml_() → Utilities.newBlob(html, HTML).getAs(PDF) → archive to
  ARCHIVE_FOLDER_ID → append a COC_PDFs row → return { success, url, fileId,
  fileName, pdfBlob }.

  ⚠️ REWRITTEN 2026-08-11: replaced the Google-Docs-template engine (makeCopy →
  DocumentApp.openById → ~70 body.replaceText regex rules → export) with direct
  HTML generation. What that removed:
    • the TEMPLATE_DOC_ID config item and its whole class of go-live failure
      (Doc moved, renamed, permissions changed, or silently edited)
    • the DocumentApp dependency, and with it the `documents` OAuth scope
    • the DUAL token vocabulary (<<[AppSheet]>> plus {{clean}}), which existed
      only because long AppSheet expressions wrapped across a line in the Doc and
      stopped matching their regex
    • the positional signatory logic (allTables[length-1], coc_clearCell_ by
      index, then regex-stripping leftover <<If:>>/<<EndIf>> wrappers)
    • the temp-copy lifecycle and its orphan-Doc cleanup path
  Unused approver slots are now simply not emitted.

  ⚠️ RENDERER LIMITS. Utilities.getAs(PDF) is not a browser. No web fonts, no
  flexbox/grid, no page-break control, no headers/footers. Layout is therefore
  deliberately table-based with inline styles, the same discipline EmailHtml.js
  uses and for the same reason. Do not reach for modern CSS here.

  ⚠️ Identity IS re-checked in generateCOC_ (isChainApprover_ || isAdmin_, plus
  status === APPROVED), because any server function is reachable directly via
  google.script.run, not only through the approval flow that calls it.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  PUBLIC
    - generateCOC_(requestId)             resolve → render → PDF → archive → log
  RENDER
    - buildCertificateHtml_(ctx)          the certificate layout (single source of design)
    - coc_metaCell_ / coc_pairRow_ / coc_specRow_ / coc_signatoryCell_   markup helpers
  TEST
    - _testGenerateCOC()                  editor-run smoke test, logs the PDF URL
  HELPERS
    - coc_orNA_(value)                    blank → "N/A"
    - coc_fmtDate_(value, pattern, fb)    safe PH-time date format, blank → fallback
*/


// =========================================================================================================
// DESIGN TOKENS
// Mirrors EMAIL_THEME (EmailHtml.js) so the certificate, the portal, and the
// notification emails read as one system. Kept local rather than shared because
// print and screen diverge (print needs darker hairlines and no tinted panels).
// =========================================================================================================
const COC_THEME = {
  navy:    "#0a2744",
  navyMid: "#134578",
  text:    "#1a1a1a",
  muted:   "#5a6470",
  rule:    "#c8d2dd",
  panel:   "#f1f4f8",
  font:    "Georgia, 'Times New Roman', serif",
  sans:    "Arial, Helvetica, sans-serif",
};


// =========================================================================================================
// PUBLIC — COC GENERATION
// =========================================================================================================

/*
  Function Name: generateCOC_

  LAYMAN (Tropang Ex):
  Bigyan mo ng requestId ng isang fully-approved na request, gagawa ito ng
  opisyal na Certificate of Completion PDF: bubuuin ang layout, ilalagay ang
  totoong datos, gagawing PDF, itatago sa Drive folder, at ibabalik ang link
  kasama ang PDF mismo (para ma-attach sa email). Kung iisa lang ang approver,
  iisang pirmahan lang ang lalabas, walang blangkong kahon.

  TECHNICAL:
  Resolves every value once into a flat context object, renders it through
  buildCertificateHtml_, converts with Utilities.newBlob(...).getAs(PDF), saves
  to ARCHIVE_FOLDER_ID, and appends a COC_PDFs row. Never throws to its caller:
  returns { success:false, error } instead, so a certificate failure can be
  swallowed without blocking the approval that triggered it.

  PARAMS:
  - requestId — Request ID (CR.REQUEST_ID) of a fully-approved request.

  RETURNS:
  - On success: { success:true, fileId, url, fileName, pdfBlob } where pdfBlob is
    an application/pdf Blob ready for GmailApp attachments.
  - On failure: { success:false, error } (not found, unauthorized, wrong status,
    or any Drive/conversion error).

  ⚠️ RETURN SHAPE IS FROZEN. sendFullyApprovedToRequestor_ (Emails.js) reads
  .success and .pdfBlob; _testGenerateCOC logs .url/.fileName/.error.

  STEPS
    Step 1 — Load the request + authorize
      Layman    : Kunin ang datos; tignan kung may karapatan ang tumatawag at
                  fully approved na ba talaga.
      Technical : getRequestRowData_; isChainApprover_ || isAdmin_; status check.
    Step 2 — Resolve every value once
      Layman    : Ihanda lahat ng ilalagay sa certificate bago mag-render.
      Technical : Build the ctx object: identity fields, spec fields (N/A-filled),
                  approval dates from getApprovalView_, and the signatory list
                  filtered to CONFIGURED approvers only.
    Step 3 — Render + convert
      Layman    : Gawing HTML ang layout, tapos gawing PDF.
      Technical : buildCertificateHtml_(ctx) → newBlob(html, HTML).getAs(PDF).
    Step 4 — Archive + log
      Layman    : Itago ang PDF sa Drive folder, tapos itala sa COC_PDFs.
      Technical : folder.createFile(pdfBlob); COC_PDFs append inside its own
                  try/catch so a logging failure never blocks the certificate.

  EXAMPLE
    generateCOC_("REQ-9b1")
    → { success:true, fileId:"1AbC…", url:"https://drive.google.com/…",
        fileName:"COC - EC-2026-00042-9B1.pdf", pdfBlob:Blob }
    generateCOC_("REQ-9b1")  // called by an unrelated user
    → { success:false, error:"Unauthorized" }
*/
function generateCOC_(requestId) {
  // Step 1 — Load the request row
  const row = getRequestRowData_(requestId);
  if (!row) return { success: false, error: "Request not found: " + requestId };

  // Guard: only a chain approver of this request or an admin may generate or
  // re-issue its certificate, and only once it is fully approved. In the normal
  // flow the final approver triggers this via sendFullyApprovedToRequestor_.
  const cocCaller = Session.getActiveUser().getEmail();
  if (!(isChainApprover_(row, cocCaller) || isAdmin_(cocCaller))) {
    return { success: false, error: "Unauthorized" };
  }
  if (row[CR.STATUS - 1] !== STATUS.APPROVED) {
    return { success: false, error: "Certificate can only be generated for a fully approved request." };
  }

  const groupId       = row[CR.GROUP - 1];
  const approvers     = getApprovers_(groupId) || {};
  const controlNumber = row[CR.CONTROL_NUMBER - 1] || requestId;
  const fileName      = "COC - " + controlNumber;

  try {
    // Step 2 — Resolve every value once.
    // Per-step approval dates come from the Activity_Log timeline. The request is
    // fully approved when this runs, so every CONFIGURED step has an approved action.
    const view    = getApprovalView_(requestId);
    const appDate = function (n) { return (view.byStep[n] && view.byStep[n].date) || ""; };

    // Signatories: only slots the group actually has. This replaces the old
    // clear-the-table-cell-then-strip-the-leftover-wrapper dance entirely.
    const signatories = [];
    for (let n = 1; n <= 3; n++) {
      const email = approvers["approver" + n];
      if (!email) continue;
      signatories.push({
        label:       "Approved By",
        name:        email,
        designation: approvers["designation" + n] || "",
        dateLabel:   "Signed",
        date:        coc_fmtDate_(appDate(n), "MM-dd-yyyy HH:mm:ss", ""),
      });
    }

    const ctx = {
      groupName:     getGroupNameById_(groupId),
      controlNumber: controlNumber,
      dateOfFiling:  coc_fmtDate_(row[CR.DATE_OF_FILING - 1], "MMMM dd, yyyy", ""),
      generatedAt:   formatPHTime_(new Date()),

      projectTitle:      row[CR.PROJECT_TITLE - 1],
      requestor:         row[CR.REQUESTOR - 1],
      requestorDesig:    row[CR.REQUESTOR_DESIG - 1],
      accountablePerson: row[CR.ACCOUNTABLE_PERSON - 1],
      department:        row[CR.DEPARTMENT - 1],
      location:          row[CR.LOCATION - 1],
      pcName:            row[CR.PC_NAME - 1],

      // The three optional reference numbers keep the old IF(ISNOTBLANK(...))
      // behaviour: blank renders as "N/A", never as an empty cell.
      prism:          coc_orNA_(row[CR.PRISM - 1]),
      purchaseOrder:  coc_orNA_(row[CR.PURCHASE_ORDER - 1]),
      ihelpNumber:    coc_orNA_(row[CR.IHELP_NUMBER - 1]),
      productType:    row[CR.PRODUCT_TYPE - 1],
      productName:    row[CR.PRODUCT_NAME - 1],
      typeOfPurchase: row[CR.TYPE_OF_PURCHASE - 1],
      typeOfLicense:  row[CR.TYPE_OF_LICENSE - 1],
      contractPeriod: coc_fmtDate_(row[CR.CONTRACT_START - 1], "MMM dd, yyyy", "N/A") + " to " +
                      coc_fmtDate_(row[CR.CONTRACT_END - 1], "MMM dd, yyyy", "N/A"),
      supplierName:   row[CR.SUPPLIER_NAME - 1],
      requestorRemark: row[CR.REQUESTOR_REMARK - 1],

      preparedDate: coc_fmtDate_(row[CR.DATE_OF_FILING - 1], "MM-dd-yyyy", ""),
      signatories:  signatories,
    };

    // Step 3 — Render + convert.
    const html    = buildCertificateHtml_(ctx);
    const pdfBlob = Utilities.newBlob(html, MimeType.HTML, fileName + ".html")
                             .getAs(MimeType.PDF)
                             .setName(fileName + ".pdf");

    // Step 4 — Archive. Folder resolved via Script Property with the Constants.js
    // literal as fallback; a throw here is caught below and returned as { success:false }.
    const pdfFile = DriveApp.getFolderById(config_("ARCHIVE_FOLDER_ID")).createFile(pdfBlob);

    // Record the generated certificate in COC_PDFs (one row per issue).
    // Defensive: a logging failure must never block the COC/email side-effects.
    try {
      const cocSheet = getSheet_(SHEET_NAMES.COC_PDFS);
      const cocRow = new Array(6).fill("");
      cocRow[COCPDF.COC_ID - 1]         = generateCocId_();
      cocRow[COCPDF.REQUEST_ID - 1]     = requestId;
      cocRow[COCPDF.CONTROL_NUMBER - 1] = controlNumber;
      cocRow[COCPDF.PDF_LINK - 1]       = pdfFile.getUrl();
      cocRow[COCPDF.DRIVE_FILE_ID - 1]  = pdfFile.getId();
      cocRow[COCPDF.GENERATED_AT - 1]   = new Date();
      cocSheet.appendRow(cocRow);
    } catch (e) {
      Logger.log("generateCOC_(): COC_PDFs log failed — " + e.message);
    }

    return {
      success:  true,
      fileId:   pdfFile.getId(),
      url:      pdfFile.getUrl(),
      fileName: pdfFile.getName(),
      pdfBlob:  pdfBlob,
    };
  } catch (err) {
    // Log the real exception server-side, return a generic message. Drive
    // exceptions echo the offending resource id, which would leak the archive
    // folder ID to any caller (generateCOC_ is reachable server-side from
    // callables that a user can trigger).
    Logger.log("generateCOC_(): failed — " + err);
    return { success: false, error: "Certificate generation failed. Please contact the administrator." };
  }
}


// =========================================================================================================
// RENDER — the certificate layout
// =========================================================================================================

/*
  Function Name: buildCertificateHtml_

  LAYMAN (Tropang Ex):
  Dito nakatira ang ITSURA ng certificate. Isang function lang, kaya kung may
  gustong baguhin sa disenyo, iisang lugar lang ang hahanapin, at makikita sa
  git kung ano ang nabago at sino ang nagbago.

  TECHNICAL:
  Pure function: context object in, complete HTML document out. No sheet reads,
  no Drive calls, no Session access, which makes it the one genuinely
  unit-testable piece of the certificate path.

  ⚠️ TABLE LAYOUT WITH INLINE STYLES IS DELIBERATE. The Apps Script HTML-to-PDF
  converter is not a browser: no web fonts, no flexbox, no grid, no page-break
  control, and stylesheet support is unreliable. Every rule that matters is
  inline. This is the same constraint EmailHtml.js works under.

  ⚠️ EVERY interpolated value goes through escapeHtml_ (EmailHtml.js, server-side
  twin of the frontend one). A project title containing "&" or "<" would
  otherwise corrupt the document.

  ⚠️ DELIBERATE LAYOUT DEVIATION from the old Doc template: the item details were
  a 9-column table inherited from AppSheet, but the schema stores exactly ONE
  item per request (PRODUCT_TYPE, PRODUCT_NAME, TYPE_OF_PURCHASE … are single
  scalar columns on the Requests row, not a child table). A 9-wide table with a
  permanent single data row was cramped and unreadable in portrait. It is now a
  two-column specification block carrying the identical fields in the identical
  order. Same data, same labels, better fit.

  PARAMS:
  - ctx — flat value object built by generateCOC_. ctx.signatories is an array of
    { label, name, designation, dateLabel, date }, already filtered to configured
    approvers, so this function never decides who appears.

  RETURNS:
  Complete HTML document string, ready for Utilities.newBlob(...).getAs(PDF).
*/
function buildCertificateHtml_(ctx) {
  const T = COC_THEME;

  // Signatory columns: Prepared By plus one per configured approver. Width is
  // split evenly so a 2-signatory certificate does not leave a dead gap.
  const cells = [
    coc_signatoryCell_("Prepared By", ctx.requestor, ctx.requestorDesig, "Date", ctx.preparedDate),
  ].concat(ctx.signatories.map(function (s) {
    return coc_signatoryCell_(s.label, s.name, s.designation, s.dateLabel, s.date);
  }));
  const colWidth = Math.floor(100 / cells.length);
  const signatoryRow = cells
    .map(function (c) { return '<td width="' + colWidth + '%" valign="top" style="padding:0 10px;">' + c + "</td>"; })
    .join("");

  return '' +
'<!DOCTYPE html><html><head><meta charset="UTF-8">' +
'<style>@page { size: A4 portrait; margin: 14mm 12mm; }</style>' +
'</head>' +
'<body style="margin:0; padding:0; font-family:' + T.sans + '; color:' + T.text + '; font-size:11px;">' +

  // ── Masthead ───────────────────────────────────────────────
  '<table width="100%" cellpadding="0" cellspacing="0" border="0">' +
    '<tr><td style="border-bottom:3px solid ' + T.navy + '; padding-bottom:8px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td valign="bottom" style="font-family:' + T.sans + '; font-size:15px; font-weight:bold; ' +
          'letter-spacing:0.14em; color:' + T.navy + ';">MEGAWORLD</td>' +
        '<td align="right" valign="bottom" style="font-size:9px; letter-spacing:0.08em; color:' + T.muted + ';">' +
          'E-CERTIFICATE PORTAL</td>' +
      '</tr></table>' +
    '</td></tr>' +
  '</table>' +

  // ── Title ──────────────────────────────────────────────────
  '<div style="text-align:center; padding:22px 0 4px;">' +
    '<div style="font-family:' + T.font + '; font-size:26px; letter-spacing:0.16em; color:' + T.navy + ';">' +
      'CERTIFICATE OF COMPLETION</div>' +
    '<div style="font-size:10px; letter-spacing:0.20em; color:' + T.muted + '; padding-top:5px;">' +
      'DIGITAL CERTIFICATION (COC)</div>' +
  '</div>' +

  // ── Meta strip ─────────────────────────────────────────────
  '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="background-color:' + T.panel + '; margin-top:16px;"><tr>' +
    coc_metaCell_("Group", ctx.groupName, "left") +
    coc_metaCell_("Control No.", ctx.controlNumber, "center") +
    coc_metaCell_("Date of Filing", ctx.dateOfFiling, "right") +
  '</tr></table>' +

  // ── Certifying statement ───────────────────────────────────
  '<p style="font-family:' + T.font + '; font-size:12px; line-height:1.65; margin:20px 0 4px; text-align:justify;">' +
    'This document serves to certify that the following products and services have been ' +
    'successfully completed and delivered as of <strong>' + escapeHtml_(ctx.generatedAt) + '</strong>.' +
  '</p>' +

  // ── Requestor details ──────────────────────────────────────
  coc_sectionTitle_("Request Details") +
  '<table width="100%" cellpadding="0" cellspacing="0" border="0">' +
    coc_pairRow_("Project", ctx.projectTitle, null, null) +
    coc_pairRow_("Requestor", ctx.requestor, "Designation", ctx.requestorDesig) +
    coc_pairRow_("Accountable Person", ctx.accountablePerson, "Department", ctx.department) +
    coc_pairRow_("Location", ctx.location, "PC Name", ctx.pcName) +
  '</table>' +

  // ── Item specification ─────────────────────────────────────
  coc_sectionTitle_("Item(s) Installed") +
  '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="border-top:1px solid ' + T.rule + '; border-left:1px solid ' + T.rule + ';">' +
    coc_specRow_("RS / PRISM No.", ctx.prism) +
    coc_specRow_("PO No.", ctx.purchaseOrder) +
    coc_specRow_("iHelp Number", ctx.ihelpNumber) +
    coc_specRow_("Product Type", ctx.productType) +
    coc_specRow_("Product Name", ctx.productName) +
    coc_specRow_("Type of Purchase", ctx.typeOfPurchase) +
    coc_specRow_("Type of License", ctx.typeOfLicense) +
    coc_specRow_("Contract Period", ctx.contractPeriod) +
    coc_specRow_("Supplier Name", ctx.supplierName) +
  '</table>' +

  // ── Remarks ────────────────────────────────────────────────
  coc_sectionTitle_("Remarks") +
  '<div style="border:1px solid ' + T.rule + '; padding:9px 11px; min-height:26px; font-size:11px; line-height:1.55;">' +
    (String(ctx.requestorRemark || "").trim()
      ? escapeHtml_(ctx.requestorRemark)
      : '<span style="color:' + T.muted + ';">No remarks provided.</span>') +
  '</div>' +

  // ── Signatories ────────────────────────────────────────────
  coc_sectionTitle_("Authorization Signatories") +
  '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tr>' +
    signatoryRow +
  '</tr></table>' +

  // ── Footer ─────────────────────────────────────────────────
  '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;">' +
    '<tr><td style="border-top:1px solid ' + T.rule + '; padding-top:7px; font-size:8px; color:' + T.muted + ';">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td>' + escapeHtml_(ctx.controlNumber) + '</td>' +
        '<td align="right">System-generated. No wet signature required.</td>' +
      '</tr></table>' +
    '</td></tr>' +
  '</table>' +

'</body></html>';
}

/* coc_sectionTitle_ — the small navy rule-and-label that opens each block. */
function coc_sectionTitle_(label) {
  return '<div style="font-size:9px; font-weight:bold; letter-spacing:0.13em; color:' + COC_THEME.navy +
         '; text-transform:uppercase; margin:20px 0 7px; padding-bottom:3px; border-bottom:1px solid ' +
         COC_THEME.rule + ';">' + escapeHtml_(label) + "</div>";
}

/* coc_metaCell_ — one cell of the group / control-no / date strip. */
function coc_metaCell_(label, value, align) {
  return '<td width="33%" align="' + align + '" style="padding:9px 12px;">' +
           '<div style="font-size:8px; letter-spacing:0.10em; color:' + COC_THEME.muted +
             '; text-transform:uppercase;">' + escapeHtml_(label) + "</div>" +
           '<div style="font-size:11px; font-weight:bold; color:' + COC_THEME.navy + '; padding-top:2px;">' +
             escapeHtml_(value || "—") + "</div>" +
         "</td>";
}

/*
  coc_pairRow_ — one row of the two-up request-details grid.
  Passing a null second label spans the first value across the full width, which
  is what long project titles need.
*/
function coc_pairRow_(labelA, valueA, labelB, valueB) {
  const cell = function (label, value, width) {
    return '<td width="' + width + '" valign="top" style="padding:5px 0;">' +
             '<div style="font-size:8px; letter-spacing:0.08em; color:' + COC_THEME.muted +
               '; text-transform:uppercase;">' + escapeHtml_(label) + "</div>" +
             '<div style="font-size:11px; padding-top:1px;">' + escapeHtml_(value || "—") + "</div>" +
           "</td>";
  };
  if (labelB === null) return "<tr>" + cell(labelA, valueA, "100%").replace("<td ", '<td colspan="2" ') + "</tr>";
  return "<tr>" + cell(labelA, valueA, "50%") + cell(labelB, valueB, "50%") + "</tr>";
}

/* coc_specRow_ — one label/value line of the bordered item-specification table. */
function coc_specRow_(label, value) {
  const td = "border-right:1px solid " + COC_THEME.rule + "; border-bottom:1px solid " + COC_THEME.rule + ";";
  return "<tr>" +
    '<td width="34%" style="' + td + ' padding:6px 10px; background-color:' + COC_THEME.panel +
      '; font-size:9px; letter-spacing:0.05em; color:' + COC_THEME.muted + '; text-transform:uppercase;">' +
      escapeHtml_(label) + "</td>" +
    '<td style="' + td + ' padding:6px 10px; font-size:11px;">' + escapeHtml_(value || "—") + "</td>" +
  "</tr>";
}

/* coc_signatoryCell_ — one Prepared-By / Approved-By block above a signature rule. */
function coc_signatoryCell_(label, name, designation, dateLabel, date) {
  return '<div style="font-size:8px; letter-spacing:0.10em; color:' + COC_THEME.muted +
           '; text-transform:uppercase;">' + escapeHtml_(label) + "</div>" +
         '<div style="height:30px;"></div>' +
         '<div style="border-top:1px solid ' + COC_THEME.text + '; padding-top:4px; font-size:10px; font-weight:bold;">' +
           escapeHtml_(name || "—") + "</div>" +
         '<div style="font-size:9px; color:' + COC_THEME.muted + '; padding-top:1px;">' +
           escapeHtml_(designation || "") + "</div>" +
         '<div style="font-size:8px; color:' + COC_THEME.muted + '; padding-top:4px;">' +
           escapeHtml_(dateLabel) + ": " + escapeHtml_(date || "—") + "</div>";
}


// =========================================================================================================
// TEST — editor-run smoke test
// =========================================================================================================

/*
  Function Name: _testGenerateCOC
  LAYMAN    : Pang-test lang sa Apps Script editor. PALITAN mo ang TEST_REQUEST_ID
              sa baba ng totoong Request ID ng isang FULLY APPROVED na request,
              i-Run ito, tapos buksan ang naka-log na PDF link para tingnan kung
              tama lahat ng fields at maganda ang layout.
  TECHNICAL : No-arg wrapper around generateCOC_ so the editor's Run button works
              (Run cannot pass arguments). Logs only the serializable fields
              (pdfBlob omitted).
  PARAMS    : (none) — edit the TEST_REQUEST_ID constant below.
  RETURNS   : The raw generateCOC_ result (incl. pdfBlob).
*/
function _testGenerateCOC() {
  // ⚠️ A LEADING underscore does NOT hide a function from google.script.run (only a
  // TRAILING one does). Without this guard any chain approver of TEST_REQUEST_ID —
  // or any admin — could loop this to mint unlimited duplicate COC PDFs into the
  // archive folder and unlimited COC_PDFs rows. Editor runs pass; visitors do not.
  if (!isOwnerContext_()) {
    throw new Error("_testGenerateCOC() may only be run by the script owner from the Apps Script editor.");
  }

  const TEST_REQUEST_ID = "578"; // ← edit this, then Run
  const res = generateCOC_(TEST_REQUEST_ID);
  Logger.log(JSON.stringify({ success: res.success, url: res.url, fileName: res.fileName, error: res.error }, null, 2));
  return res;
}


// =========================================================================================================
// HELPERS (private)
// =========================================================================================================

/*
  Function Name: coc_orNA_
  LAYMAN    : Kung blangko ang value, "N/A" ang ilalagay. Ito yung dating
              AppSheet IF(ISNOTBLANK([x]), [x], "N/A") na pinanatili para hindi
              magbago ang hitsura ng tatlong optional na reference numbers.
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

// REMOVED: coc_clearCell_(table, r, c).
//
// It existed to blank the signatory columns of unused approvers in the Doc
// template, located positionally as "the LAST table in the document" and cleared
// by cell index, with out-of-range errors swallowed silently. Both the fragility
// and the silence are gone: buildCertificateHtml_ simply does not emit a
// signatory block for an approver slot the group has not configured.
