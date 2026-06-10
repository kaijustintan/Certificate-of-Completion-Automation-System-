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

// detectRole(email) — MOVED to Accessors.js (now scans Group_Approvers by email).
// isAdmin(email) also lives there. One global scope — re-declaring detectRole
// here would collide.


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
  NOTE      : Reads all 25 Requests columns (through RESUBMIT_COUNT). Approval
              history lives in Approval_Actions, read via the Accessors layer.
*/
function getRequestRowData(requestId) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return null;
  return sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
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
              step, dateFiled, contractEnd, isExpired }. Empty if the user has
              submitted nothing. isExpired (#10) is computed server-side via
              isContractExpired() so the UI never parses date strings.

  STEPS
    Step 1 — Resolve caller + load rows
      Layman    : Kunin ang email ng naka-login at lahat ng request rows.
      Technical : Session email + getDataRows(REQUESTS).
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
  const rows  = getDataRows(SHEET_NAMES.REQUESTS);
  return rows
    .filter(row => sameEmail(row[CR.REQUESTOR - 1], email))
    .map(row => ({
      requestId:     row[CR.REQUEST_ID - 1],
      controlNumber: row[CR.CONTROL_NUMBER - 1],
      projectTitle:  row[CR.PROJECT_TITLE - 1],
      group:         getGroupNameById(row[CR.GROUP - 1]),  // display name (CR.GROUP holds group_id)
      status:        row[CR.STATUS - 1],
      step:          row[CR.STEP - 1],
      dateFiled:     row[CR.DATE_OF_FILING - 1]
        ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      contractEnd:   row[CR.CONTRACT_END - 1]
        ? Utilities.formatDate(new Date(row[CR.CONTRACT_END - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      isExpired:     isContractExpired(row[CR.CONTRACT_END - 1]),
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
              group, status, step, dateFiled, contractEnd, isExpired }.

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
  const rows  = getDataRows(SHEET_NAMES.REQUESTS);
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];

  return rows
    .filter(row => {
      const status  = row[CR.STATUS - 1];
      const step    = row[CR.STEP - 1];
      const groupId = row[CR.GROUP - 1];
      if (!pending.includes(status)) return false;
      return sameEmail(getCurrentApprover(step, groupId), email);
    })
    .map(row => ({
      requestId:     row[CR.REQUEST_ID - 1],
      controlNumber: row[CR.CONTROL_NUMBER - 1],
      projectTitle:  row[CR.PROJECT_TITLE - 1],
      requestor:     row[CR.REQUESTOR - 1],
      group:         getGroupNameById(row[CR.GROUP - 1]),
      status:        row[CR.STATUS - 1],
      step:          row[CR.STEP - 1],
      dateFiled:     row[CR.DATE_OF_FILING - 1]
        ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      contractEnd:   row[CR.CONTRACT_END - 1]
        ? Utilities.formatDate(new Date(row[CR.CONTRACT_END - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      isExpired:     isContractExpired(row[CR.CONTRACT_END - 1]),
    }));
}


/*
  Function Name: getMyActionedRequests
  LAYMAN    : Ito yung "history mo bilang approver." Lahat ng request na ginalaw
              mo na — inapprove, dineny, o ibinalik — lalabas dito. Ginagamit
              ng "Actioned by you" view. Identity mo galing session, hindi
              pinapasa galing frontend.
  TECHNICAL : Returns every row the active user has acted on, derived from the
              append-only Activity_Log timeline: a request counts if it has any
              approved/declined/returned action whose actor is the caller. This
              survives resubmits and later actions by others (the timeline is
              never cleared).
  PARAMS    : (none) — identity from Session.
  RETURNS   : Array of the same DTO shape as getPendingApprovals() (empty if none).

  STEPS
    Step 1 — Resolve caller + load rows
      Layman    : Kunin ang naka-login at lahat ng request rows.
      Technical : Session email + getDataRows(REQUESTS).
    Step 2 — Build the "acted" set from the timeline
      Layman    : Isang pass sa Activity_Log: lahat ng request na ako ang
                  umaprove/nag-decline/nagbalik, itala.
      Technical : One getDataRows(ACTIVITY_LOG) scan → membership map keyed by
                  request_id (no per-row sheet reads).
    Step 3 — Filter + project + format date
      Layman    : Panatilihin ang nasa listahan; gawing DTO; petsa → PH format.
      Technical : filter via the map; map to the DTO; blank date → "".

  EXAMPLE
    // approver2 declined EC-…007 and earlier approved EC-…004
    getMyActionedRequests()
    → [ { controlNumber:"EC-2026-00007-145", status:"Declined", … },
        { controlNumber:"EC-2026-00004-682", status:"Fully Approved", … } ]
*/
function getMyActionedRequests() {
  const email = Session.getActiveUser().getEmail();
  const rows  = getDataRows(SHEET_NAMES.REQUESTS);

  // Which requests has the caller acted on? Derive from the append-only timeline:
  // any approve/decline/return action whose actor is the caller. Load all action
  // rows once, build a membership set — no per-row sheet reads, no LAST_ACTION_BY.
  const acted = {};
  getDataRows(SHEET_NAMES.ACTIVITY_LOG).forEach(function (a) {
    const action = a[ACT.ACTION - 1];
    if ((action === ACTION.APPROVED || action === ACTION.DECLINED || action === ACTION.RETURNED) &&
        sameEmail(a[ACT.ACTOR_EMAIL - 1], email)) {
      acted[String(a[ACT.REQUEST_ID - 1])] = true;
    }
  });

  return rows
    .filter(function (row) { return acted[String(row[CR.REQUEST_ID - 1])]; })
    .map(function (row) {
      return {
        requestId:     row[CR.REQUEST_ID - 1],
        controlNumber: row[CR.CONTROL_NUMBER - 1],
        projectTitle:  row[CR.PROJECT_TITLE - 1],
        requestor:     row[CR.REQUESTOR - 1],
        group:         getGroupNameById(row[CR.GROUP - 1]),
        status:        row[CR.STATUS - 1],
        step:          row[CR.STEP - 1],
        dateFiled:     row[CR.DATE_OF_FILING - 1]
          ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
          : "",
        contractEnd:   row[CR.CONTRACT_END - 1]
          ? Utilities.formatDate(new Date(row[CR.CONTRACT_END - 1]), "Asia/Manila", "MMM dd, yyyy")
          : "",
        isExpired:     isContractExpired(row[CR.CONTRACT_END - 1]),
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
                  {attachmentId, filename, description, resubmitCycle} — NO Drive
                  URL (Phase 8 gated serving; the UI fetches bytes via
                  downloadAttachment). resubmitCycle drives the #6 cycle grouping.

  EXAMPLE
    // As the requestor or a chain approver:
    getRequestDetail("REQ-9b1")  →  { requestId:"REQ-9b1", status:"…",
        projectTitle:"…", approver1:"…", previousApprovals:[…],
        attachments:[…], … }
    // As an unrelated student:
    getRequestDetail("REQ-9b1")  →  null
*/
function getRequestDetail(requestId) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return null;

  const row       = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const groupId   = row[CR.GROUP - 1];
  const approvers = getApprovers(groupId) || {};

  // Only the requestor or an approver in this request's chain may view it.
  const caller = Session.getActiveUser().getEmail();
  if (!sameEmail(row[CR.REQUESTOR - 1], caller) && !isChainApprover(row, caller)) {
    return null;
  }

  const fmtDateTime = (val) => val
    ? Utilities.formatDate(new Date(val), "Asia/Manila", "MMM dd, yyyy hh:mm a") : "";
  const fmtDateOnly = (val) => val
    ? Utilities.formatDate(new Date(val), "Asia/Manila", "MMM dd, yyyy") : "";

  // Per-step dates/remarks, previousApprovals, and resubmitHistory are DERIVED
  // from the append-only Approval_Actions timeline (frozen DTO — same shape).
  const view       = getApprovalView(requestId);
  const stepDate   = (n) => (view.byStep[n] && view.byStep[n].date) ? fmtDateTime(view.byStep[n].date) : "";
  const stepRemark = (n) => (view.byStep[n] ? view.byStep[n].remark : "") || "";

  return {
    requestId:            row[CR.REQUEST_ID - 1],
    controlNumber:        row[CR.CONTROL_NUMBER - 1],
    status:               row[CR.STATUS - 1],
    step:                 row[CR.STEP - 1],
    dateFiled:            fmtDateOnly(row[CR.DATE_OF_FILING - 1]),
    projectTitle:         row[CR.PROJECT_TITLE - 1],
    requestor:            row[CR.REQUESTOR - 1],
    requestorDesig:       row[CR.REQUESTOR_DESIG - 1],
    group:                getGroupNameById(groupId),  // display name (row holds group_id)
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
    contractStart:        fmtDateOnly(row[CR.CONTRACT_START - 1]),
    contractEnd:          fmtDateOnly(row[CR.CONTRACT_END - 1]),
    isExpired:            isContractExpired(row[CR.CONTRACT_END - 1]),  // #10 — drives the detail-page "Expired" chip
    supplierName:         row[CR.SUPPLIER_NAME - 1],
    requestorRemark:      row[CR.REQUESTOR_REMARK - 1],
    app1Remark:           stepRemark(1),
    app2Remark:           stepRemark(2),
    app3Remark:           stepRemark(3),
    app1Date:             stepDate(1),
    app2Date:             stepDate(2),
    app3Date:             stepDate(3),
    resubmitCount:        row[CR.RESUBMIT_COUNT - 1] || 0,
    resubmitHistory:      view.resubmitHistory,
    previousApprovals:    view.previousApprovals,   // current cycle (progress)
    priorApprovals:       view.priorApprovals,      // earlier cycles (re-review note; empty unless resubmitted)
    approver1:            approvers.approver1 || "",
    approver2:            approvers.approver2 || "",
    approver3:            approvers.approver3 || "",
    designation1:         approvers.designation1 || "",
    designation2:         approvers.designation2 || "",
    designation3:         approvers.designation3 || "",
    // No raw Drive URL is sent to the frontend. The UI uses attachmentId to call
    // the identity-gated downloadAttachment(); FILE holds the display filename.
    attachments:          getAttachmentsForRequest(row[CR.REQUEST_ID - 1]).map(a => ({
      attachmentId:  a[RA.ATTACHMENT_ID - 1],
      filename:      a[RA.FILE - 1],
      description:   a[RA.DESCRIPTION - 1],
      // Which submission cycle this file belongs to (0 = original, N = Resubmit #N).
      // Additive DTO field — drives the "Current submission" vs "Previous versions"
      // grouping in renderAttachmentsBlock (#6). Compare against detail.resubmitCount.
      resubmitCycle: parseInt(a[RA.RESUBMIT_CYCLE - 1], 10) || 0,
    })),
  };
}


// getApproverGroups() — MOVED to Accessors.js. It now returns [{id, name}] for
// active groups (the new-request dropdown sends group_id, shows the name).


/*
  Function Name: submitNewRequest
  LAYMAN    : Dito ipinapasok ang bagong request galing sa form — kasama na
              ang mga supporting documents. UPLOAD MUNA lahat ng files sa Drive;
              kung may pumalpak, i-trash ang mga naunang naka-upload at wala
              na kaming gagawin sa sheet. Kapag kumpleto na ang lahat, saka
              lang isusulat ang request row at attachment rows, tapos email na
              ang Approver 1. All-or-nothing — hindi pwedeng may request na
              walang files, at hindi pwedeng may files na walang request.
  TECHNICAL : Phase 8 submit-time upload flow. Upload-first for atomicity:
              Drive uploads can fail; sheet appends cannot be rolled back. By
              the time we write any sheet row, all risky I/O is done.
              validateAttachmentPayload, uploadAttachmentFile, writeAttachmentRows
              are in Attachments.js. Status always PENDING_1 — no SYNCING state.
  PARAMS    : formData — form fields + formData.files (Array<FilePayload>).
              FilePayload: { filename, mimeType, base64, description }.
  RETURNS   : { success:true, requestId, controlNumber }
              { success:false, error } on validation or upload failure.

  STEPS
    Step 1 — Validate file payload
      Layman    : Bago mag-upload, siguraduhing may files at kumpleto ang data.
      Technical : validateAttachmentPayload(files) — returns {ok,error}; early
                  return on failure. No I/O performed yet.
    Step 2 — Generate identifiers
      Layman    : Gumawa ng request ID at control number.
      Technical : generateRequestId(); generateControlNumber(requestId).
    Step 3 — Upload all files to Drive (rollback on any failure)
      Layman    : I-upload ang bawat file. Kung may pumalpak, itapon ang mga
                  naunang naka-upload at ibalik ang error — walang request na
                  nalilikha sa sheet.
      Technical : uploadAttachmentFile(f) per file; on catch: trash uploaded
                  fileIds via DriveApp.getFileById().setTrashed(true).
    Step 4 — Append the request row (PENDING_1)
      Layman    : Ngayon lang isusulat ang request — pagkatapos ng upload.
      Technical : Build 33-col array via CR.*; status = PENDING_1 always;
                  EXPECTED_ATTACHMENTS = files.length (record-keeping).
    Step 5 — Write attachment child rows (batched)
      Layman    : Isulat ang lahat ng attachment rows sa isang write.
      Technical : writeAttachmentRows(requestId, uploaded) — one setValues call.
    Step 6 — Send approval email (last — implies files are ready)
      Layman    : Padala ng email sa Approver 1. Siniguro na na kumpleto ang lahat.
      Technical : sendApprovalRequest(requestId).

  EXAMPLE
    submitNewRequest({ projectTitle:"Antivirus", group:"ISM - InfoSec", …,
                       files: [{ filename:"PO.pdf", mimeType:"application/pdf",
                                 base64:"JVBERi0…", description:"Purchase Order" }] })
    → { success:true, requestId:"9B1", controlNumber:"EC-2026-00042-9B1" }
      (file in Drive; row in PENDING_1; approver emailed)
*/
function submitNewRequest(formData) {
  const caller = Session.getActiveUser().getEmail();
  const files  = Array.isArray(formData.files) ? formData.files : [];

  // Step 1 — Server-side validation (size/count/shape/descriptions)
  const v = validateAttachmentPayload(files);
  if (!v.ok) return { success: false, error: v.error };

  // Step 2 — Generate identifiers
  const requestId = generateRequestId();
  const controlNo = generateControlNumber(requestId);

  // Step 3 — Upload ALL files to Drive first (rollback on any failure)
  // Nothing is written to either sheet until every upload succeeds.
  const uploaded = [];
  try {
    for (let i = 0; i < files.length; i++) {
      // First submit = resubmit cycle 0. Drive name uses the naming convention;
      // the friendly original filename is what we store for display.
      const driveName = buildAttachmentDriveName(controlNo, 0, files[i].filename);
      const result    = uploadAttachmentFile(files[i], driveName);
      uploaded.push({
        fileId:      result.fileId,
        url:         result.url,
        filename:    files[i].filename,
        description: String(files[i].description).trim(),
      });
    }
  } catch (err) {
    // Best-effort rollback: trash every file already uploaded in this call
    uploaded.forEach(function(u) {
      try { DriveApp.getFileById(u.fileId).setTrashed(true); } catch (e) {}
    });
    Logger.log("submitNewRequest(): Upload failed — " + err.message + ". No request created.");
    return { success: false, error: "File upload failed. No request was created. Please try again." };
  }

  // Step 4 — Write the request row (always PENDING_1). group is a group_id.
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const newRow = new Array(CR.RESUBMIT_COUNT).fill("");
  newRow[CR.REQUEST_ID - 1]         = requestId;
  newRow[CR.CONTROL_NUMBER - 1]     = controlNo;
  newRow[CR.STATUS - 1]             = STATUS.PENDING_1;   // cache
  newRow[CR.STEP - 1]               = 1;                  // cache
  newRow[CR.DATE_OF_FILING - 1]     = new Date();
  newRow[CR.PROJECT_TITLE - 1]      = formData.projectTitle;
  newRow[CR.REQUESTOR - 1]          = caller;
  newRow[CR.REQUESTOR_DESIG - 1]    = formData.requestorDesig;
  newRow[CR.GROUP - 1]              = formData.group;     // group_id (from the dropdown)
  newRow[CR.ACCOUNTABLE_PERSON - 1] = formData.accountablePerson;
  newRow[CR.DEPARTMENT - 1]         = formData.department;
  newRow[CR.LOCATION - 1]           = formData.location;
  newRow[CR.PC_NAME - 1]            = formData.pcName;
  newRow[CR.PRISM - 1]              = formData.prism;
  newRow[CR.PURCHASE_ORDER - 1]     = formData.purchaseOrder;
  newRow[CR.IHELP_NUMBER - 1]       = formData.ihelpNumber;
  newRow[CR.PRODUCT_TYPE - 1]       = formData.productType;
  newRow[CR.PRODUCT_NAME - 1]       = formData.productName;
  newRow[CR.TYPE_OF_PURCHASE - 1]   = formData.typeOfPurchase;
  newRow[CR.TYPE_OF_LICENSE - 1]    = formData.typeOfLicense;
  newRow[CR.CONTRACT_START - 1]     = formData.contractStart;
  newRow[CR.CONTRACT_END - 1]       = formData.contractEnd;
  newRow[CR.SUPPLIER_NAME - 1]      = formData.supplierName;
  newRow[CR.REQUESTOR_REMARK - 1]   = formData.requestorRemark;
  newRow[CR.RESUBMIT_COUNT - 1]     = 0;                  // cache
  sheet.appendRow(newRow);

  // Log the submit on the append-only timeline (cycle 0, no step).
  appendAction(requestId, formData.group, 0, null, caller, ACTION.SUBMITTED, "");

  // Step 5 — Write attachment child rows (one batched write; cycle 0 = first submit)
  writeAttachmentRows(requestId, uploaded, 0);

  // Step 6 — Send approval email LAST (all files are live in Drive at this point)
  sendApprovalRequest(requestId);

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
  const row = getRequestRowData(requestId);
  if (!row) return { success: false, message: "Request not found." };

  const step          = row[CR.STEP - 1];
  const groupId       = row[CR.GROUP - 1];
  const returnerEmail = Session.getActiveUser().getEmail();

  // Only the current approver may return this request (checked before any write).
  if (!sameEmail(getCurrentApprover(step, groupId), returnerEmail)) {
    return { success: false, error: "Unauthorized" };
  }

  const approverLabel = `Approver ${step}`;

  // Who had already approved this cycle — for the prior-approver notification.
  // Derived from the append-only timeline; no [PENDING]/PREVIOUS_APPROVALS
  // bookkeeping columns anymore (returnRequest() appends a RETURNED action, and
  // getApprovalView reconstructs history + previousApprovals from the timeline).
  const previousApprovals = getApprovalView(requestId).previousApprovals;

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
              i-resubmit. Pwede silang magdagdag ng bago/tamang documents (kasi
              kadalasan dahil sa maling/kulang na dokumento kaya naibalik) —
              OPTIONAL lang ito; ang lumang files ay pinananatili (audit trail).
              Ina-upload muna ang bagong files BAGO baguhin ang status, tapos
              ibinabalik sa Approver 1 ang chain na may resubmit email.
  TECHNICAL : Guard (caller === requestor AND status === RETURNED) → validate +
              upload-first any newFiles (rollback on failure) → append their rows
              (old rows kept) → capture return reason + next resubmit count BEFORE
              resubmit() clears the remark columns → resubmit() (→ PENDING_1) →
              confirmation + resubmit approval email. Upload-first mirrors
              submitNewRequest's atomicity: no state change until files are safe.
  PARAMS    : requestId — the returned request to resubmit.
              newFiles  — optional Array<FilePayload> of added/corrected docs
                          ({filename, mimeType, base64, description}). May be empty.
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
function handleResubmit(requestId, newFiles) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData(requestId);
  if (!row) return { success: false, error: "Request not found." };
  // Only the requestor may resubmit, and only a returned request can be resubmitted.
  if (!sameEmail(row[CR.REQUESTOR - 1], caller) || row[CR.STATUS - 1] !== STATUS.RETURNED) {
    return { success: false, error: "Unauthorized" };
  }

  // Return reason (latest decline/return remark) + next cycle, derived from the timeline.
  const returnReason  = getApprovalView(requestId).latestRemark || "No reason provided.";
  const resubmitCount = (parseInt(row[CR.RESUBMIT_COUNT - 1]) || 0) + 1; // +1 mirrors what resubmit() will write

  // Optional re-upload: validate + upload-first any new/corrected documents.
  // Old attachment rows are KEPT; new ones are appended with the r{N} naming
  // convention so both cycles are distinguishable in the Drive folder.
  const files = Array.isArray(newFiles) ? newFiles : [];
  const v = validateAttachmentPayload(files, false); // false → new files optional
  if (!v.ok) return { success: false, error: v.error };

  if (files.length > 0) {
    const controlNo = row[CR.CONTROL_NUMBER - 1];
    const uploaded  = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const driveName = buildAttachmentDriveName(controlNo, resubmitCount, files[i].filename);
        const result    = uploadAttachmentFile(files[i], driveName);
        uploaded.push({
          fileId:      result.fileId,
          url:         result.url,
          filename:    files[i].filename,
          description: String(files[i].description).trim(),
        });
      }
    } catch (err) {
      // Roll back any files uploaded in this call — no state change has happened yet.
      uploaded.forEach(function(u) {
        try { DriveApp.getFileById(u.fileId).setTrashed(true); } catch (e) {}
      });
      Logger.log("handleResubmit(): Upload failed — " + err.message + ". Resubmit aborted.");
      return { success: false, error: "File upload failed. The request was not resubmitted. Please try again." };
    }
    writeAttachmentRows(requestId, uploaded, resubmitCount); // append — keeps the original files
  }

  const result = resubmit(requestId);
  if (result.success) {
    sendResubmitConfirmToRequestor(requestId, returnReason, resubmitCount);
    if (result.newStatus === STATUS.PENDING_1) {
      sendResubmitApprovalRequest(requestId, returnReason, resubmitCount); // dedicated resubmit email for Approver 1
    }
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