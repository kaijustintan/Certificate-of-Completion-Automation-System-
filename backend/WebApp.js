// WebApp.js
/*
  ════════════════════════════════════════════════════════════
  FILE: WebApp.js  (a.k.a. WebApp.gs)
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung "front desk" ng web app. Pag may nagbukas ng portal URL, dito
  unang dumadaan (doGet). Pero higit pa rito: nandito rin lahat ng functions
  na tinatawag ng frontend para kumuha ng data (dashboard lists, request
  detail) at para kumilos (approve/decline/return/resubmit). Mahalaga: bawat
  "sensitibong" galaw ay sinisiguro dito kung SINO talaga ang tumatawag —
  galing sa Google session, hindi sa frontend — para hindi mapeke.

  TECHNICAL:
  Web-app entry point + the google.script.run bridge between the SPA and the
  Sheet. Holds doGet(), role detection, the server-side authorization layer,
  read-only getters (DTOs for the frontend), the submit mutation, and the
  guarded action handlers that orchestrate state changes + email side-effects.

  URL structure (handled by doGet → forwarded to the client router):
    /exec                       → login / role-home
    /exec?page=dashboard        → requestor or approver dashboard
    /exec?page=new              → new request form
    /exec?page=request&id=XXX   → request detail (requestor view)
    /exec?page=review&id=XXX    → request detail (approver view)

  ⚠️ SECURITY MODEL: frontend route guards control VISIBILITY, not AUTHORITY.
  Anyone signed in can call google.script.run.<fn>() from the browser console,
  so every sensitive callable re-verifies the caller via
  Session.getActiveUser().getEmail() — an email is NEVER trusted from the client.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  A. ENTRY POINT
     - doGet(e)                       serves the SPA shell + deep-link params

  B. ROLE DETECTION
     - detectRole(email)              "approver" | "requestor"

  C. AUTHORIZATION HELPERS  (server-side, identity from Session)
     - normalizeEmail(email)          trim + lowercase
     - sameEmail(a, b)                safe non-blank equality
     - getRequestRowData(id)          full 34-col row by Request ID
     - isCurrentApprover(row, caller) is caller the one due to act now?
     - isChainApprover(row, caller)   is caller any approver for the group?

  D. READ-ONLY GETTERS  (return DTOs for the frontend)
     - getCurrentUser()               { email, role }
     - getMyRequests()                requestor dashboard list
     - getPendingApprovals()          approver "awaiting" list
     - getMyActionedRequests()        approver "actioned" list
     - getRequestDetail(id)           full single-request DTO (or null)
     - getApproverGroups()            group names for the new-request form

  E. MUTATION
     - submitNewRequest(formData)     append a new request row

  F. ACTION HANDLERS  (guarded; orchestrate state change + emails)
     - handleApprove(id)
     - handleDecline(id, remark)
     - handleReturn(id, remark)
     - handleResubmit(id)

  G. INTERNAL
     - include(filename)              inline an HTML partial (CSS/JS)
*/


// ============================================================
// MAIN ENTRY POINT
// Google calls this automatically when someone opens the web app URL
// ============================================================

/*
  Function Name: doGet
  LAYMAN    : Pag binuksan ang portal URL, ito ang tumatakbo. Binabasa nito
              kung may "deep link" (hal. galing email: ?page=review&id=XXX),
              tapos ibinibigay ang buong app (HTML) na may dalang target na
              page para diretso ka na doon pagkalogin.
  TECHNICAL : GET handler. Reads page/id query params and injects them into
              the Index template as initialPage/initialId, then returns the
              evaluated HtmlOutput configured for embedding.
  PARAMS    : e — Apps Script event object; e.parameter holds the query string.
  RETURNS   : HtmlOutput (the SPA shell).

  STEPS
    Step 1 — Read deep-link params (default to empty)
      Layman    : Kunin ang page at id; kung wala, blangko — para client na
                  ang magdesisyon ng role-based home.
      Technical : page/id default to "" so no deep-link → client resolves home.
    Step 2 — Bind params into the Index template
      Layman    : Ilagay ang target sa HTML bago i-render.
      Technical : template.initialPage / initialId become server-rendered
                  globals (window.__INITIAL_ROUTE) the bootstrap() reads.
    Step 3 — Evaluate + configure for iframe embedding
      Layman    : I-render ang HTML, lagyan ng title/viewport, payagang
                  i-embed.
      Technical : setXFrameOptionsMode(ALLOWALL) — note: query params (not the
                  URL hash) are used because the sandboxed iframe can't read
                  the outer hash.

  EXAMPLE
    Open …/exec?page=review&id=REQ-9b1
    → serves the SPA with __INITIAL_ROUTE = { page:"review", id:"REQ-9b1" },
      landing the approver straight on that request's review page.
*/


// ============================================================
// MAIN ENTRY POINT
// Google calls this automatically when someone opens the web app URL
// ============================================================
function doGet(e) {
  // Empty (not "dashboard") so the client can resolve role-based home when
  // there's no deep-link target. Email deep-links pass ?page=review&id=XXX.
  const page = (e && e.parameter && e.parameter.page) || "";
  const id   = (e && e.parameter && e.parameter.id)   || "";

  // Forward the deep-link target into the page so bootstrap() can honor it.
  // Query params (not hash) are used because the app runs in a sandboxed
  // iframe where the client cannot read the outer URL's hash.
  const template = HtmlService.createTemplateFromFile("frontend/Index");
  template.initialPage = page;
  template.initialId   = id;

  return template
    .evaluate()
    .setTitle("E-Certificate Portal — Megaworld")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ============================================================
// ROLE DETECTION
// Checks if the logged-in user is an approver in any group.
// Returns "approver" or "requestor".
// ============================================================

/*
  Function Name: detectRole
  LAYMAN    : Approver ba o requestor ang user na ito? Tinitingnan kung ang
              email niya ay nakalista bilang approver sa kahit anong group.
  TECHNICAL : Returns "approver" if the email appears in any APPROVER_1/2/3
              slot across Approver_Settings; otherwise "requestor".
  PARAMS    : email — the account to classify.
  RETURNS   : "approver" | "requestor" (blank email → "requestor").

  STEPS
    Step 1 — Guard blank email
      Layman    : Walang email → requestor agad.
      Technical : Falsy email short-circuits to "requestor".
    Step 2 — Scan approver settings
      Layman    : Dumaan sa bawat group, tingnan kung kasama ang email.
      Technical : Loop rows; match against any of the 3 approver columns.
    Step 3 — Classify
      Layman    : Nahanap → approver; wala → requestor.
      Technical : Return on first match, else "requestor".

  EXAMPLE
    detectRole("kyle_justin_tan@dlsu.edu.ph")  →  "approver"
    detectRole("random_student@dlsu.edu.ph")   →  "requestor"
*/
function detectRole(email) {
  if (!email) return "requestor";
  const rows = getDataRows(SHEET_NAMES.APPROVER_SETTINGS);
  for (const row of rows) {
    if (
      row[AS.APPROVER_1 - 1] === email ||
      row[AS.APPROVER_2 - 1] === email ||
      row[AS.APPROVER_3 - 1] === email
    ) {
      return "approver";
    }
  }
  return "requestor";
}


// ============================================================
// AUTHORIZATION HELPERS
// Frontend route guards (Cat 2) control visibility, not authority.
// Any signed-in user can call a google.script.run function directly
// from the browser console. Every sensitive callable re-verifies the
// caller server-side using Session.getActiveUser() — never an email
// passed from the client.
// ============================================================

/*
  Function Name: normalizeEmail
  LAYMAN    : Linisin ang email bago ihambing — alisin ang spaces, gawing
              lowercase — para "Juan@X.com " at "juan@x.com" ay magkatugma.
  TECHNICAL : String(email||"").trim().toLowerCase().
  PARAMS    : email — any value.
  RETURNS   : Normalized email string ("" if blank).
*/
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/*
  Function Name: sameEmail
  LAYMAN    : Pareho bang account ang dalawang email? Totoo lang kung pareho
              SILA AT hindi blangko (para hindi "match" ang dalawang walang laman).
  TECHNICAL : Equality after normalize, with a non-blank guard.
  PARAMS    : a, b — the two emails to compare.
  RETURNS   : Boolean — true only if both non-blank and equal (case-insensitive).
  NOTE      : The non-blank guard is security-relevant — two empty cells must
              never be treated as "the same approver".
*/
function sameEmail(a, b) {
  const na = normalizeEmail(a);
  return na !== "" && na === normalizeEmail(b);
}

/*
  Function Name: getRequestRowData
  LAYMAN    : Kunin ang buong row ng isang request gamit ang Request ID.
  TECHNICAL : Resolves the Sheet row number, then reads the full 34-column row.
  PARAMS    : requestId — the request to read.
  RETURNS   : 0-indexed row array (access via CR.* - 1), or null if not found.
  NOTE      : Reads 34 cols (through PREVIOUS_APPROVALS). LAST_ACTION_BY (35) is
              not needed by the callers of this helper.
*/
function getRequestRowData(requestId) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return null;
  return sheet.getRange(rowNum, 1, 1, 34).getValues()[0];
}

/*
  Function Name: isCurrentApprover
  LAYMAN    : Ang tumatawag ba ang DAPAT kumilos sa request ngayon (base sa
              kasalukuyang Step at Group)?
  TECHNICAL : sameEmail(getCurrentApprover(step, group), caller).
  PARAMS    : row — the request's 0-indexed row array; callerEmail — the caller.
  RETURNS   : Boolean. Gate for approve/decline/return.
*/
function isCurrentApprover(row, callerEmail) {
  return sameEmail(getCurrentApprover(row[CR.STEP - 1], row[CR.GROUP - 1]), callerEmail);
}

/*
  Function Name: isChainApprover
  LAYMAN    : Ang tumatawag ba ay isa sa mga approver ng group ng request na
              ito (kahit hindi pa siya ang nasa pila)? Ginagamit para payagang
              tingnan ang detalye ng request.
  TECHNICAL : True if caller matches any of the group's 3 approver slots.
  PARAMS    : row — the request's row array; callerEmail — the caller.
  RETURNS   : Boolean. Broader than isCurrentApprover (view vs act).
*/
function isChainApprover(row, callerEmail) {
  const approvers = getApprovers(row[CR.GROUP - 1]);
  if (!approvers) return false;
  return sameEmail(approvers.approver1, callerEmail)
      || sameEmail(approvers.approver2, callerEmail)
      || sameEmail(approvers.approver3, callerEmail);
}


// ============================================================
// SERVER-SIDE DATA FUNCTIONS
// Called from the HTML via google.script.run
// These are the bridge between the frontend and the Sheet
// ============================================================

/*
  Function Name: getCurrentUser
  LAYMAN    : Sino ang naka-login at ano ang role niya? Ito ang tinatawag ng
              app sa simula para malaman kung saang dashboard dadalhin.
  TECHNICAL : Reads the session email and classifies it via detectRole().
  PARAMS    : (none) — identity from Session.
  RETURNS   : { email, role }.
*/
function getCurrentUser() {
  const email = Session.getActiveUser().getEmail();
  const role  = detectRole(email);
  return { email, role };
}


/*
  Function Name: getMyRequests
  LAYMAN    : Lahat ng request na ISINUMITE ng naka-login na user — para sa
              requestor dashboard. Identity galing session, hindi pinapasa.
  TECHNICAL : Filters Certificate_Requests by REQUESTOR === session email and
              projects a slim dashboard DTO per row.
  PARAMS    : (none) — identity from Session.
  RETURNS   : Array of { requestId, controlNumber, projectTitle, group, status,
              step, dateFiled }. Empty if the user has submitted nothing.

  STEPS
    Step 1 — Resolve caller + load rows
      Layman    : Kunin ang email ng naka-login at lahat ng request rows.
      Technical : Session email + getDataRows(CERTIFICATE_REQUESTS).
    Step 2 — Keep only my requests
      Layman    : Panatilihin lang ang akin (ako ang requestor).
      Technical : filter REQUESTOR === email (exact match; requestor is always
                  the stored session email so no normalize needed).
    Step 3 — Project + format the date
      Layman    : Gawing maliit na object; petsa → "MMM dd, yyyy" PH time.
      Technical : map to DTO; DATE_OF_FILING formatted, blank → "".

  EXAMPLE
    getMyRequests()
    → [ { requestId:"REQ-9b1", controlNumber:"EC-2026-00042-9B1",
          projectTitle:"memaaa", group:"ISM - InfoSec",
          status:"Pending Approver 1", step:1, dateFiled:"Jun 02, 2026" } ]
*/
function getMyRequests() {
  const email = Session.getActiveUser().getEmail();
  const rows  = getDataRows(SHEET_NAMES.CERTIFICATE_REQUESTS);
  return rows
    .filter(row => row[CR.REQUESTOR - 1] === email)
    .map(row => ({
      requestId:     row[CR.REQUEST_ID - 1],
      controlNumber: row[CR.CONTROL_NUMBER - 1],
      projectTitle:  row[CR.PROJECT_TITLE - 1],
      group:         row[CR.GROUP - 1],
      status:        row[CR.STATUS - 1],
      step:          row[CR.STEP - 1],
      dateFiled:     row[CR.DATE_OF_FILING - 1]
        ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
    }));
}


/*
  Function Name: getPendingApprovals
  LAYMAN    : Lahat ng request na NAGHIHINTAY sa naka-login na approver ngayon —
              yung "Awaiting your action" list. Lalabas lang ang request kung
              ikaw mismo ang nasa pila para dito sa kasalukuyang step nito.
  TECHNICAL : Filters to rows whose status is Pending Approver 1/2/3 AND whose
              current-step approver equals the session email; returns the
              dashboard DTO (same shape as getMyActionedRequests).
  PARAMS    : (none) — identity from Session.
  RETURNS   : Array of { requestId, controlNumber, projectTitle, requestor,
              group, status, step, dateFiled }.

  STEPS
    Step 1 — Resolve caller + load rows + pending-status set
      Layman    : Kunin ang email, lahat ng rows, at listahan ng "pending" statuses.
      Technical : Session email; getDataRows; pending = [PENDING_1/2/3].
    Step 2 — Filter to "pending AND mine to act"
      Layman    : Panatilihin lang kung pending pa AT ako ang dapat pumirma ngayon.
      Technical : status ∈ pending && getCurrentApprover(step, group) === email
                  (drops rows whose group has no approver config).
    Step 3 — Project + format date
      Layman    : Gawing DTO; petsa → readable PH format.
      Technical : map to the 8-field DTO; blank date → "".

  EXAMPLE
    // Logged in as approver1; REQ-9b1 is at step 1 awaiting approver1
    getPendingApprovals()
    → [ { requestId:"REQ-9b1", status:"Pending Approver 1", step:1, … } ]
*/
function getPendingApprovals() {
  const email = Session.getActiveUser().getEmail();
  const rows  = getDataRows(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];

  return rows
    .filter(row => {
      const status  = row[CR.STATUS - 1];
      const step    = row[CR.STEP - 1];
      const group   = row[CR.GROUP - 1];
      if (!pending.includes(status)) return false;
      const approvers = getApprovers(group);
      if (!approvers) return false;
      const currentApprover = getCurrentApprover(step, group);
      return currentApprover === email;
    })
    .map(row => ({
      requestId:     row[CR.REQUEST_ID - 1],
      controlNumber: row[CR.CONTROL_NUMBER - 1],
      projectTitle:  row[CR.PROJECT_TITLE - 1],
      requestor:     row[CR.REQUESTOR - 1],
      group:         row[CR.GROUP - 1],
      status:        row[CR.STATUS - 1],
      step:          row[CR.STEP - 1],
      dateFiled:     row[CR.DATE_OF_FILING - 1]
        ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
    }));
}


/*
  Function Name: getMyActionedRequests
  LAYMAN    : Ito yung "history mo bilang approver." Lahat ng request na ginalaw
              mo na — inapprove, dineny, o ibinalik — lalabas dito. Ginagamit
              ng "Actioned by you" view. Identity mo galing session, hindi
              pinapasa galing frontend.
  TECHNICAL : Returns every row the active user has acted on. A row counts if
              EITHER (a) LAST_ACTION_BY === me (covers declines/returns that
              stamp no approval date) OR (b) I occupy an approver slot AND my
              matching AppN_Date is filled (an approval that persists after a
              later action).
  PARAMS    : (none) — identity from Session.
  RETURNS   : Array of the same 8-field DTO as getPendingApprovals() (empty if none).

  STEPS
    Step 1 — Resolve caller + load rows
      Layman    : Kunin ang naka-login at lahat ng request rows.
      Technical : Session email + getDataRows(CERTIFICATE_REQUESTS).
    Step 2 — Filter: "did I act on this?"
      Layman    : Isama kung (a) ako ang huling gumalaw, o (b) approver ako AT
                  may petsa na ang approval ko. Walang config na group → laktawan.
      Technical : sameEmail(LAST_ACTION_BY, me) OR (my slot matches AND my
                  APPn_DATE is non-empty). getApprovers() null → drop.
    Step 3 — Project + format date
      Layman    : Gawing DTO; petsa → readable PH format.
      Technical : map to the 8-field DTO; blank date → "".

  EXAMPLE
    // approver2 declined EC-…007 and earlier approved EC-…004
    getMyActionedRequests()
    → [ { controlNumber:"EC-2026-00007-145", status:"Declined", … },  // via LAST_ACTION_BY
        { controlNumber:"EC-2026-00004-682", status:"Fully Approved", … } ] // via APP2_DATE
*/
function getMyActionedRequests() {
  const email = Session.getActiveUser().getEmail();
  const rows  = getDataRows(SHEET_NAMES.CERTIFICATE_REQUESTS);

  return rows
    .filter(function (row) {
      // Most-recent actioner stamp covers declines/returns (which leave no AppN_Date).
      if (sameEmail(row[CR.LAST_ACTION_BY - 1], email)) return true;
      // AppN_Date still surfaces an earlier approver whose stamp persists after a later action.
      const approvers = getApprovers(row[CR.GROUP - 1]);
      if (!approvers) return false;
      if (sameEmail(approvers.approver1, email) && row[CR.APP1_DATE - 1]) return true;
      if (sameEmail(approvers.approver2, email) && row[CR.APP2_DATE - 1]) return true;
      if (sameEmail(approvers.approver3, email) && row[CR.APP3_DATE - 1]) return true;
      return false;
    })
    .map(function (row) {
      return {
        requestId:     row[CR.REQUEST_ID - 1],
        controlNumber: row[CR.CONTROL_NUMBER - 1],
        projectTitle:  row[CR.PROJECT_TITLE - 1],
        requestor:     row[CR.REQUESTOR - 1],
        group:         row[CR.GROUP - 1],
        status:        row[CR.STATUS - 1],
        step:          row[CR.STEP - 1],
        dateFiled:     row[CR.DATE_OF_FILING - 1]
          ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
          : "",
      };
    });
}


/*
  Function Name: getRequestDetail
  LAYMAN    : Buong detalye ng IISANG request — lahat ng field, approvers,
              attachments, resubmit history — para sa detail page. May guard:
              ang requestor lang o isang approver ng group nito ang makakakita.
              Kung wala kang karapatan, null ang babalik (hindi error).
  TECHNICAL : Reads the full row, authorizes the caller (requestor OR chain
              approver), then returns a rich DTO (dates pre-formatted,
              PREVIOUS_APPROVALS JSON-parsed, attachments joined in).
  PARAMS    : requestId — the request to load.
  RETURNS   : Detail DTO object, or null if not found OR caller unauthorized.

  STEPS
    Step 1 — Locate the row
      Layman    : Hanapin ang row ng request; wala → null.
      Technical : getRowNumberByRequestId(); -1 → return null.
    Step 2 — Read row + group approvers
      Layman    : Basahin ang buong row at ang approvers ng group.
      Technical : getRange(rowNum,1,1,34); getApprovers(group) || {}.
    Step 3 — Authorize the caller (view gate)
      Layman    : Requestor ka ba o approver ng chain? Kung hindi, null.
      Technical : return null unless sameEmail(REQUESTOR, caller) ||
                  isChainApprover(row, caller). Null (not an error object) so
                  the detail renderer treats it as "not found / no access".
    Step 4 — Build the DTO (format + parse)
      Layman    : Buuin ang malinis na object: petsa naka-format, prev
                  approvals na-parse, attachments naka-sama.
      Technical : Dates via Utilities.formatDate; PREVIOUS_APPROVALS JSON.parse
                  in a try/catch (bad JSON → []); attachments mapped to
                  {description, fileLink}.

  EXAMPLE
    // As the requestor or a chain approver:
    getRequestDetail("REQ-9b1")  →  { requestId:"REQ-9b1", status:"…",
        projectTitle:"…", approver1:"…", previousApprovals:[…],
        attachments:[…], … }
    // As an unrelated student:
    getRequestDetail("REQ-9b1")  →  null
*/
function getRequestDetail(requestId) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return null;

  const row       = sheet.getRange(rowNum, 1, 1, 34).getValues()[0];
  const group     = row[CR.GROUP - 1];
  const approvers = getApprovers(group) || {};

  // Only the requestor or an approver in this request's chain may view it.
  const caller = Session.getActiveUser().getEmail();
  if (!sameEmail(row[CR.REQUESTOR - 1], caller) && !isChainApprover(row, caller)) {
    return null;
  }

  const formatDate = (val) => val
    ? Utilities.formatDate(new Date(val), "Asia/Manila", "MMM dd, yyyy hh:mm a")
    : "";

  const formatDateOnly = (val) => val
    ? Utilities.formatDate(new Date(val), "Asia/Manila", "MMM dd, yyyy")
    : "";

  return {
    requestId:            row[CR.REQUEST_ID - 1],
    controlNumber:        row[CR.CONTROL_NUMBER - 1],
    status:               row[CR.STATUS - 1],
    step:                 row[CR.STEP - 1],
    dateFiled:            formatDateOnly(row[CR.DATE_OF_FILING - 1]),
    projectTitle:         row[CR.PROJECT_TITLE - 1],
    requestor:            row[CR.REQUESTOR - 1],
    requestorDesig:       row[CR.REQUESTOR_DESIG - 1],
    group:                group,
    accountablePerson:    row[CR.ACCOUNTABLE_PERSON - 1],
    department:           row[CR.DEPARTMENT - 1],
    location:             row[CR.LOCATION - 1],
    pcName:               row[CR.PC_NAME - 1],
    prism:                row[CR.PRISM - 1],
    purchaseOrder:        row[CR.PURCHASE_ORDER - 1],
    ihelpNumber:          row[CR.IHELP_NUMBER - 1],
    productType:          row[CR.PRODUCT_TYPE - 1],
    productName:          row[CR.PRODUCT_NAME - 1],
    typeOfPurchase:       row[CR.TYPE_OF_PURCHASE - 1],
    typeOfLicense:        row[CR.TYPE_OF_LICENSE - 1],
    contractStart:        formatDateOnly(row[CR.CONTRACT_START - 1]),
    contractEnd:          formatDateOnly(row[CR.CONTRACT_END - 1]),
    supplierName:         row[CR.SUPPLIER_NAME - 1],
    requestorRemark:      row[CR.REQUESTOR_REMARK - 1],
    app1Remark:           row[CR.APP1_REMARK - 1],
    app2Remark:           row[CR.APP2_REMARK - 1],
    app3Remark:           row[CR.APP3_REMARK - 1],
    expectedAttachments:  row[CR.EXPECTED_ATTACHMENTS - 1],
    app1Date:             formatDate(row[CR.APP1_DATE - 1]),
    app2Date:             formatDate(row[CR.APP2_DATE - 1]),
    app3Date:             formatDate(row[CR.APP3_DATE - 1]),
    resubmitCount:        row[CR.RESUBMIT_COUNT - 1] || 0,
    resubmitHistory:      row[CR.RESUBMIT_HISTORY - 1] || "",
    previousApprovals:    (() => {
      try {
        const raw = row[CR.PREVIOUS_APPROVALS - 1];
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    })(),
    approver1:            approvers.approver1 || "",
    approver2:            approvers.approver2 || "",
    approver3:            approvers.approver3 || "",
    designation1:         approvers.designation1 || "",
    designation2:         approvers.designation2 || "",
    designation3:         approvers.designation3 || "",
    attachments:          getAttachmentsForRequest(row[CR.REQUEST_ID - 1]).map(a => ({
      description: a[RA.DESCRIPTION - 1],
      fileLink:    a[RA.FILE_LINK - 1],
    })),
  };
}


/*
  Function Name: getApproverGroups
  LAYMAN    : Listahan ng mga group name para sa dropdown ng new-request form.
  TECHNICAL : Maps Approver_Settings to its GROUP column, dropping blanks.
  PARAMS    : (none)
  RETURNS   : Array of group-name strings.
*/
function getApproverGroups() {
  return getDataRows(SHEET_NAMES.APPROVER_SETTINGS)
    .map(row => row[AS.GROUP - 1])
    .filter(Boolean);
}


/*
  Function Name: submitNewRequest
  LAYMAN    : Dito ipinapasok ang bagong request galing sa form. Gumagawa ng
              bagong ID at control number, sinusulat ang lahat ng field sa
              bagong row, at kung walang kailangang attachment, agad nang
              nagpapadala ng email sa unang approver.
  TECHNICAL : Generates IDs, decides initial status (SYNCING if attachments are
              expected, else PENDING_1), writes a 33-col row, and triggers the
              first approval email when no sync wait is needed.
  PARAMS    : formData — the submitted form fields (object keyed by field name).
  RETURNS   : { success:true, requestId, controlNumber }.

  STEPS
    Step 1 — Generate identifiers + initial status
      Layman    : Gumawa ng request ID, control number; alamin kung "Syncing"
                  muna (may attachments) o diretso na sa Approver 1.
      Technical : generateRequestId/ControlNumber; status = expected>0 ?
                  SYNCING : PENDING_1; requestor = session email.
    Step 2 — Build the new row by column index
      Layman    : Ilagay bawat field sa tamang column; step = 1.
      Technical : Fill a length-33 array via CR.* - 1; DATE_OF_FILING = new
                  Date(); RESUBMIT_COUNT = 0.
    Step 3 — Append to the sheet
      Layman    : Idagdag ang row sa Certificate_Requests.
      Technical : sheet.appendRow(newRow).
    Step 4 — Fire first approval email (if not syncing)
      Layman    : Kung diretso na sa Approver 1, padala agad ng email.
      Technical : if status === PENDING_1 → sendApprovalRequest(requestId).

  EXAMPLE
    submitNewRequest({ projectTitle:"memaaa", group:"ISM - InfoSec",
                       expectedAttachments:0, … })
    → { success:true, requestId:"9B1", controlNumber:"EC-2026-00042-9B1" }
      (row written as Pending Approver 1; approver 1 emailed immediately)
*/
function submitNewRequest(formData) {
  const sheet     = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const requestId = generateRequestId();
  const controlNo = generateControlNumber(requestId);
  const email     = Session.getActiveUser().getEmail();
  const expected  = parseInt(formData.expectedAttachments) || 0;
  const status    = expected > 0 ? STATUS.SYNCING : STATUS.PENDING_1;

  const newRow                          = new Array(33).fill("");
  newRow[CR.REQUEST_ID - 1]            = requestId;
  newRow[CR.CONTROL_NUMBER - 1]        = controlNo;
  newRow[CR.STATUS - 1]                = status;
  newRow[CR.STEP - 1]                  = 1;
  newRow[CR.DATE_OF_FILING - 1]        = new Date();
  newRow[CR.PROJECT_TITLE - 1]         = formData.projectTitle;
  newRow[CR.REQUESTOR - 1]             = email;
  newRow[CR.REQUESTOR_DESIG - 1]       = formData.requestorDesig;
  newRow[CR.GROUP - 1]                 = formData.group;
  newRow[CR.ACCOUNTABLE_PERSON - 1]    = formData.accountablePerson;
  newRow[CR.DEPARTMENT - 1]            = formData.department;
  newRow[CR.LOCATION - 1]              = formData.location;
  newRow[CR.PC_NAME - 1]               = formData.pcName;
  newRow[CR.PRISM - 1]                 = formData.prism;
  newRow[CR.PURCHASE_ORDER - 1]        = formData.purchaseOrder;
  newRow[CR.IHELP_NUMBER - 1]          = formData.ihelpNumber;
  newRow[CR.PRODUCT_TYPE - 1]          = formData.productType;
  newRow[CR.PRODUCT_NAME - 1]          = formData.productName;
  newRow[CR.TYPE_OF_PURCHASE - 1]      = formData.typeOfPurchase;
  newRow[CR.TYPE_OF_LICENSE - 1]       = formData.typeOfLicense;
  newRow[CR.CONTRACT_START - 1]        = formData.contractStart;
  newRow[CR.CONTRACT_END - 1]          = formData.contractEnd;
  newRow[CR.SUPPLIER_NAME - 1]         = formData.supplierName;
  newRow[CR.REQUESTOR_REMARK - 1]      = formData.requestorRemark;
  newRow[CR.EXPECTED_ATTACHMENTS - 1]  = expected;
  newRow[CR.RESUBMIT_COUNT - 1]        = 0;

  sheet.appendRow(newRow);

  // If no attachments needed, send approval email immediately
  if (status === STATUS.PENDING_1) {
    sendApprovalRequest(requestId);
  }

  return { success: true, requestId, controlNumber: controlNo };
}


// ============================================================
// ACTION HANDLERS (guarded)
// Called from the approver/requestor detail pages. Each one re-verifies
// the caller server-side, performs the low-level state change (in
// Approvals.js), then fires the appropriate notification emails.
// ============================================================

/*
  Function Name: handleApprove
  LAYMAN    : Pag pinindot ng approver ang "Approve". Sinisiguro muna kung siya
              nga ang nasa pila. Kung oo, ina-approve ang request: kung siya
              ang huling pirmador → "Fully Approved" + emails; kung hindi → next
              approver na, may resibo sa kanya at progress update sa requestor.
  TECHNICAL : Guard (isCurrentApprover) → approve() → branch on newStatus to
              fire either the fully-approved pair or the intermediate trio.
  PARAMS    : requestId — the request to approve.
  RETURNS   : approve()'s result { success, newStatus, step } — or
              { success:false, error } if not found / unauthorized.

  STEPS
    Step 1 — Authorize
      Layman    : Hanapin ang row; kung wala → error; kung hindi ikaw ang
                  current approver → Unauthorized.
      Technical : getRequestRowData; isCurrentApprover(row, caller) gate.
    Step 2 — Perform the approval
      Layman    : Itaas ang step / markahan kung fully approved na.
      Technical : approve(requestId) (Approvals.js) returns newStatus/step.
    Step 3 — Fire the right emails
      Layman    : Tapos na lahat → 2 fully-approved emails. May susunod pa →
                  email sa next approver + resibo sa nag-approve + progress sa
                  requestor.
      Technical : if newStatus === APPROVED → fullyApproved(approver+requestor);
                  else → approvalRequest + approveConfirm + progressUpdate.

  EXAMPLE
    handleApprove("REQ-9b1")  // final approver
    → { success:true, newStatus:"Fully Approved", step:3 }
      (sends sendFullyApprovedToApprover + sendFullyApprovedToRequestor)
*/
function handleApprove(requestId) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData(requestId);
  if (!row) return { success: false, error: "Request not found." };
  if (!isCurrentApprover(row, caller)) return { success: false, error: "Unauthorized" };

  const result = approve(requestId);
  if (result.success) {
    if (result.newStatus === STATUS.APPROVED) {
      sendFullyApprovedToApprover(requestId);
      sendFullyApprovedToRequestor(requestId);
    } else {
      sendApprovalRequest(requestId);           // next approver — action needed
      sendApproveConfirmToApprover(requestId);  // actioner receipt (symmetric with decline/return)
      sendProgressUpdateToRequestor(requestId); // requestor mid-chain progress update
    }
  }
  return result;
}

/*
  Function Name: handleDecline
  LAYMAN    : Pag pinindot ng approver ang "Decline". Sinisiguro muna kung siya
              ang nasa pila, tapos isinasara ang request (hindi na pwedeng
              i-resubmit) at nag-eemail sa nag-decline at sa requestor.
  TECHNICAL : Guard (isCurrentApprover) → decline() → notify decliner + requestor.
  PARAMS    : requestId — request to decline; remark — the decline reason.
  RETURNS   : decline()'s result, or { success:false, error }.

  STEPS
    Step 1 — Authorize
      Layman    : Row check + current-approver check; else error/Unauthorized.
      Technical : getRequestRowData; isCurrentApprover gate.
    Step 2 — Perform the decline
      Layman    : Markahang "Declined", itala ang remark.
      Technical : decline(requestId, remark) (Approvals.js).
    Step 3 — Notify both sides
      Layman    : Email sa nag-decline (resibo) at sa requestor.
      Technical : sendDeclineToApprover + sendDeclineToRequestor.

  EXAMPLE
    handleDecline("REQ-9b1", "Budget not approved")
    → { success:true, … }  (request closed; both parties emailed)
*/
function handleDecline(requestId, remark) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData(requestId);
  if (!row) return { success: false, error: "Request not found." };
  if (!isCurrentApprover(row, caller)) return { success: false, error: "Unauthorized" };

  const result = decline(requestId, remark);
  if (result.success) {
    sendDeclineToApprover(requestId);
    sendDeclineToRequestor(requestId);
  }
  return result;
}

/*
  Function Name: handleReturn
  LAYMAN    : Pag ibinalik ng approver ang request sa requestor para ayusin.
              Ito ang pinaka-maraming bookkeeping: bago baguhin ang state,
              itinatala muna kung SINO ang nagbalik, KAILAN, at BAKIT (bilang
              [PENDING] entry sa history), at kung SINO-SINO nang approver ang
              nakapag-approve (para malaman pag na-resubmit, babalik ulit sa
              kanila). Tapos saka ibinabalik at nag-eemail sa lahat ng apektado.
  TECHNICAL : Captures returner + reason + prior approvals WHILE Step still
              reflects the returner (this is the only reliable point), writes a
              single active [PENDING] history entry + the PREVIOUS_APPROVALS
              JSON, then returnRequest() + 3 notifications.
  PARAMS    : requestId — request to return; remark — what needs to change.
  RETURNS   : returnRequest()'s result, or { success:false, error/message }.

  STEPS
    Step 1 — Locate row + read pre-mutation state
      Layman    : Hanapin ang row; basahin ang step, group, approvers, at
                  kung sino ang nagbalik — BAGO magbago ang state.
      Technical : getRowNumberByRequestId; read 33-col row; returner = session.
    Step 2 — Authorize BEFORE any write
      Layman    : Kung hindi ikaw ang current approver → Unauthorized (bago
                  pa masulatan ang history/AH).
      Technical : sameEmail(getCurrentApprover(step,group), returner) gate,
                  placed before any setValue so no unauthorized mutation.
    Step 3 — Build the [PENDING] history entry
      Layman    : Buuin ang tala: sino, kailan, anong dahilan.
      Technical : approverLabel = `Approver ${step}`; pendingEntry string with
                  returner, PH timestamp, and reason.
    Step 4 — Snapshot prior approvals → AH column
      Layman    : Itala kung sino nang nakapag-approve bago mabura ang petsa.
      Technical : push {step,email,date} for each filled AppN_Date; write JSON
                  to PREVIOUS_APPROVALS (AH) — keeps AG as pure narrative.
    Step 5 — Write history (one active [PENDING] only)
      Layman    : Kung may luma nang [PENDING], palitan — huwag mag-ipon ng dalawa.
      Technical : if existing includes "[PENDING]", splice it out before
                  appending; else append after a separator.
    Step 6 — Perform the return + notify
      Layman    : Ibalik ang request; email sa requestor, sa nagbalik, at sa
                  mga dating approver (na kasama ang dahilan).
      Technical : returnRequest(); on success → sendReturnToRequestor +
                  sendReturnConfirmToApprover + sendReturnedChainNotification.

  EXAMPLE
    handleReturn("REQ-9b1", "Wrong supplier on contract")
    → { success:true, … }
      (AH stores prior approvers; requestor + returner + prior approvers emailed)
*/
function handleReturn(requestId, remark) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return { success: false, message: "Request not found." };

  // Capture returner identity + reason BEFORE state is mutated.
  // Stored as a [PENDING] entry that resubmit() later promotes to a
  // numbered "Resubmit #N" entry. This is the only reliable point
  // in the workflow where Step still reflects who actually returned.
  const rowData       = sheet.getRange(rowNum, 1, 1, 33).getValues()[0];
  const step          = rowData[CR.STEP - 1];
  const group         = rowData[CR.GROUP - 1];
  const approvers     = getApprovers(group) || {};
  const returnerEmail = Session.getActiveUser().getEmail();

  // Only the current approver may return this request. Checked before any
  // write so an unauthorized caller cannot mutate history or AH.
  if (!sameEmail(getCurrentApprover(step, group), returnerEmail)) {
    return { success: false, error: "Unauthorized" };
  }

  const approverLabel = `Approver ${step}`;
  const timestamp     = formatPHTime(new Date());
  const pendingEntry  =
    `[PENDING] ${approverLabel} (${returnerEmail})\n` +
    `Return date: ${timestamp}\n` +
    `Reason: ${remark || "No reason provided."}`;

  // Capture which approvers had already approved BEFORE resubmit() clears the
  // AppN_Date columns. Stored as structured JSON in the dedicated AH column —
  // keeps Resubmit_History (AG) as pure narrative.
  const previousApprovals = [];
  if (rowData[CR.APP1_DATE - 1] && approvers.approver1) {
    previousApprovals.push({ step: 1, email: approvers.approver1, date: formatPHTime(new Date(rowData[CR.APP1_DATE - 1])) });
  }
  if (rowData[CR.APP2_DATE - 1] && approvers.approver2) {
    previousApprovals.push({ step: 2, email: approvers.approver2, date: formatPHTime(new Date(rowData[CR.APP2_DATE - 1])) });
  }
  if (rowData[CR.APP3_DATE - 1] && approvers.approver3) {
    previousApprovals.push({ step: 3, email: approvers.approver3, date: formatPHTime(new Date(rowData[CR.APP3_DATE - 1])) });
  }
  sheet.getRange(rowNum, CR.PREVIOUS_APPROVALS).setValue(JSON.stringify(previousApprovals));

  const existingHistory = String(rowData[CR.RESUBMIT_HISTORY - 1] || "").trim();

  // A request can only have one active [PENDING] entry at a time.
  // If one already exists, replace it — do not stack a second one.
  let newHistory;
  if (existingHistory.includes("[PENDING]")) {
    const pendingIndex    = existingHistory.indexOf("[PENDING]");
    const beforePending   = existingHistory
      .substring(0, pendingIndex)
      .replace(/\n\n---\n\n$/, "")
      .trim();
    newHistory = beforePending
      ? beforePending + "\n\n---\n\n" + pendingEntry
      : pendingEntry;
  } else {
    newHistory = existingHistory
      ? existingHistory + "\n\n---\n\n" + pendingEntry
      : pendingEntry;
  }
  sheet.getRange(rowNum, CR.RESUBMIT_HISTORY).setValue(newHistory);

  const result = returnRequest(requestId, remark);
  if (result.success) {
    sendReturnToRequestor(requestId, approverLabel);
    sendReturnConfirmToApprover(requestId, approverLabel);
    sendReturnedChainNotification(requestId, previousApprovals, remark, approverLabel);
  }
  return result;
}

/*
  Function Name: handleResubmit
  LAYMAN    : Pag ire-resubmit ng requestor ang request na ibinalik sa kanya.
              Requestor lang ang pwede, at "Returned" lang ang pwedeng
              i-resubmit. Kinukuha muna ang dahilan ng pagkabalik bago ito
              mabura, tapos ibinabalik sa Approver 1 ang chain, may kasamang
              email na nagsasabing "resubmission ito + ito ang dating dahilan."
  TECHNICAL : Guard (caller === requestor AND status === RETURNED) → capture
              return reason + next resubmit count BEFORE resubmit() clears the
              remark columns → resubmit() → confirmation + (if PENDING_1) a
              dedicated resubmit approval email.
  PARAMS    : requestId — the returned request to resubmit.
  RETURNS   : resubmit()'s result, or { success:false, error }.

  STEPS
    Step 1 — Authorize (owner + returned-only)
      Layman    : Ikaw ba ang requestor AT "Returned" ba ito? Kung hindi →
                  Unauthorized.
      Technical : sameEmail(REQUESTOR, caller) && status === RETURNED.
    Step 2 — Capture reason + count BEFORE clearing
      Layman    : Kunin ang dating dahilan (sa remark cols) at ang bagong
                  resubmit number bago burahin ni resubmit().
      Technical : returnReason from APP3/2/1_REMARK fallback; resubmitCount =
                  current + 1 (mirrors what resubmit() will write).
    Step 3 — Perform the resubmit + notify
      Layman    : Ibalik sa simula ng chain; email-confirm sa requestor; kung
                  diretso sa Approver 1, padalhan siya ng dedicated resubmit email.
      Technical : resubmit(); sendResubmitConfirmToRequestor; if newStatus ===
                  PENDING_1 → sendResubmitApprovalRequest (SYNCING defers it).

  EXAMPLE
    handleResubmit("REQ-9b1")
    → { success:true, newStatus:"Pending Approver 1", … }
      (requestor gets a confirm; Approver 1 gets a "this is a resubmission" email)
*/
function handleResubmit(requestId) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData(requestId);
  if (!row) return { success: false, error: "Request not found." };
  // Only the requestor may resubmit, and only a returned request can be resubmitted.
  if (!sameEmail(row[CR.REQUESTOR - 1], caller) || row[CR.STATUS - 1] !== STATUS.RETURNED) {
    return { success: false, error: "Unauthorized" };
  }

  // Capture return reason + count BEFORE resubmit() clears the remark columns.
  const returnReason  = row[CR.APP3_REMARK - 1] || row[CR.APP2_REMARK - 1] || row[CR.APP1_REMARK - 1] || "No reason provided.";
  const resubmitCount = (parseInt(row[CR.RESUBMIT_COUNT - 1]) || 0) + 1; // +1 mirrors what resubmit() will write

  const result = resubmit(requestId);
  if (result.success) {
    sendResubmitConfirmToRequestor(requestId, returnReason, resubmitCount);
    if (result.newStatus === STATUS.PENDING_1) {
      sendResubmitApprovalRequest(requestId, returnReason, resubmitCount); // dedicated resubmit email for Approver 1
    }
    // If newStatus === STATUS.SYNCING, approval email fires when attachments are finalized
  }
  return result;
}


// ============================================================
// INTERNAL
// ============================================================

/*
  Function Name: include
  LAYMAN    : Pang-"isingit" ng ibang HTML file sa loob ng Index (hal. yung
              Stylesheet at JavaScript partials), para isang buong page ang
              maibibigay sa browser.
  TECHNICAL : Returns a file's raw content for <?!= include('…') ?> scriptlets
              in templated HTML.
  PARAMS    : filename — path of the HTML file to inline (e.g. "frontend/Stylesheet").
  RETURNS   : String — the file's evaluated content.
*/
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}