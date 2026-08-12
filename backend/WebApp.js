// WebApp.js
/*
  ════════════════════════════════════════════════════════════
  FILE: WebApp.js  (a.k.a. WebApp.gs)
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung "front desk" ng web app. Pag may nagbukas ng portal URL, dito
  unang dumadaan (doGet). Pero higit pa rito: nandito rin lahat ng functions
  na tinatawag ng frontend para kumuha ng data (dashboard lists, request
  detail) at para kumilos (approve_/decline_/return/resubmit_). Mahalaga: bawat
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
     - detectRole_(email)              "approver" | "requestor"

  C. AUTHORIZATION HELPERS  (server-side, identity from Session)
     - normalizeEmail_(email)          trim + lowercase
     - sameEmail_(a, b)                safe non-blank equality
     - getRequestRowData_(id)          full 34-col row by Request ID
     - isCurrentApprover_(row, caller) is caller the one due to act now?
     - isChainApprover_(row, caller)   is caller any approver for the group?

  D. READ-ONLY GETTERS  (return DTOs for the frontend)
     - getCurrentUser()               { email, role, isAdmin }
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

// detectRole_(email) — MOVED to Accessors.js (now scans Group_Approvers by email).
// isAdmin_(email) also lives there. One global scope — re-declaring detectRole_
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
  Function Name: normalizeEmail_
  LAYMAN    : Linisin ang email bago ihambing — alisin ang spaces, gawing
              lowercase — para "Juan@X.com " at "juan@x.com" ay magkatugma.
  TECHNICAL : String(email||"").trim().toLowerCase().
  PARAMS    : email — any value.
  RETURNS   : Normalized email string ("" if blank).
*/
function normalizeEmail_(email) {
  return String(email || "").trim().toLowerCase();
}

/*
  Function Name: sameEmail_
  LAYMAN    : Pareho bang account ang dalawang email? Totoo lang kung pareho
              SILA AT hindi blangko (para hindi "match" ang dalawang walang laman).
  TECHNICAL : Equality after normalize, with a non-blank guard.
  PARAMS    : a, b — the two emails to compare.
  RETURNS   : Boolean — true only if both non-blank and equal (case-insensitive).
  NOTE      : The non-blank guard is security-relevant — two empty cells must
              never be treated as "the same approver".
*/
function sameEmail_(a, b) {
  const na = normalizeEmail_(a);
  return na !== "" && na === normalizeEmail_(b);
}

/*
  Function Name: isAllowedDomain_
  LAYMAN    : Taga-Megaworld ba ang email na ito? Kapag walang nakalista sa
              ORG.ALLOWED_DOMAINS, lahat pinapayagan (ganito sa dev/testing).
              Blangkong email ay LAGING bawal — ibig sabihin nun ay hindi
              nakilala ng Google kung sino ang tumatawag.
  TECHNICAL : Server-side domain allowlist check (defence in depth behind the
              deployment's "Anyone within <domain>" setting). Empty
              ORG.ALLOWED_DOMAINS disables the domain test but NEVER the
              non-blank test: a blank email means an unidentified caller and is
              always rejected, which is what closes the anonymous-write hole on
              a misconfigured "Anyone" deployment.
  PARAMS    : email — the caller's email (from Session).
  RETURNS   : Boolean — true if the caller is identified and in an allowed domain.

  EXAMPLE
    // ORG.ALLOWED_DOMAINS = ["megaworldcorp.com"]
    isAllowedDomain_("juan@megaworldcorp.com")  → true
    isAllowedDomain_("outsider@gmail.com")      → false
    isAllowedDomain_("")                        → false (always)
*/
function isAllowedDomain_(email) {
  const e = normalizeEmail_(email);
  if (e === "" || e.indexOf("@") === -1) return false;   // unidentified caller — always denied
  const allowed = (typeof ORG !== "undefined" && ORG.ALLOWED_DOMAINS) || [];
  if (!allowed.length) return true;                      // no allowlist configured — allow all
  const domain = e.split("@").pop();
  return allowed.some(function (d) { return String(d).trim().toLowerCase() === domain; });
}

/*
  Function Name: isOwnerContext_

  LAYMAN (Tropang Ex):
  Tinatanong nito: "ang tumatakbo ba ngayon ay ang may-ari mismo ng script,
  o isang ordinaryong user na nag-click sa portal?" Ginagamit ito ng mga
  maintenance function (yung mga daily sweep at yung register* na tinatakbo
  mo sa editor) para hindi sila matawag ng kung sino-sino mula sa browser.

  TECHNICAL:
  Distinguishes an owner/trigger execution from a web-app visitor call.
  Under a "execute as me" deployment, getEffectiveUser() is ALWAYS the owner,
  while getActiveUser() is the calling visitor. In a time-driven trigger or an
  editor Run, both resolve to the owner. So equality ⇒ owner-or-trigger context.

  ⚠️ WHY THIS EXISTS: every top-level function is reachable via
  google.script.run. Without this, checkPendingApprovals() — which has NO
  idempotency flag by design, because "the daily schedule is the idempotency" —
  could be looped by any authenticated user to mass-mail every approver and
  burn the account's daily Gmail quota, silently disabling all workflow mail.

  Fails CLOSED: a blank active user (consumer account / cross-domain visitor)
  will not match, because sameEmail_() rejects blanks.

  PARAMS  : (none) — reads Session directly.
  RETURNS : Boolean — true only for the owner or a trigger-run execution.
*/
function isOwnerContext_() {
  try {
    return sameEmail_(Session.getActiveUser().getEmail(),
                     Session.getEffectiveUser().getEmail());
  } catch (e) {
    return false;   // Session unavailable — deny
  }
}

/*
  Function Name: getRequestRowData_
  LAYMAN    : Kunin ang buong row ng isang request gamit ang Request ID.
  TECHNICAL : Resolves the Sheet row number, then reads the full 25-column row.
  PARAMS    : requestId — the request to read.
  RETURNS   : 0-indexed row array (access via CR.* - 1), or null if not found.
  NOTE      : Reads all 25 Requests columns (through RESUBMIT_COUNT). Approval
              history lives in Approval_Actions, read via the Accessors layer.
*/
function getRequestRowData_(requestId) {
  const sheet  = getSheet_(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId_(requestId);
  if (rowNum === -1) return null;
  return sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
}

/*
  Function Name: isCurrentApprover_
  LAYMAN    : Ang tumatawag ba ang DAPAT kumilos sa request ngayon (base sa
              kasalukuyang Step at Group)?
  TECHNICAL : sameEmail_(getCurrentApprover_(step, group), caller).
  PARAMS    : row — the request's 0-indexed row array; callerEmail — the caller.
  RETURNS   : Boolean. Gate for approve_/decline_/return.
*/
function isCurrentApprover_(row, callerEmail) {
  return sameEmail_(getCurrentApprover_(row[CR.STEP - 1], row[CR.GROUP - 1]), callerEmail);
}

/*
  Function Name: isChainApprover_
  LAYMAN    : Ang tumatawag ba ay isa sa mga approver ng group ng request na
              ito (kahit hindi pa siya ang nasa pila)? Ginagamit para payagang
              tingnan ang detalye ng request.
  TECHNICAL : True if caller matches any of the group's 3 approver slots.
  PARAMS    : row — the request's row array; callerEmail — the caller.
  RETURNS   : Boolean. Broader than isCurrentApprover_ (view vs act).
*/
function isChainApprover_(row, callerEmail) {
  const approvers = getApprovers_(row[CR.GROUP - 1]);
  if (!approvers) return false;
  return sameEmail_(approvers.approver1, callerEmail)
      || sameEmail_(approvers.approver2, callerEmail)
      || sameEmail_(approvers.approver3, callerEmail);
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
  TECHNICAL : Reads the session email and classifies it via detectRole_().
  PARAMS    : (none) — identity from Session.
  RETURNS   : { email, role, isAdmin }. isAdmin is ADDITIVE: role semantics
              are unchanged (an admin who is also an approver keeps role
              "approver"); the flag only adds the Admin nav link + page.

  ⚠️ THE DTO KEY IS `isAdmin`, THE FUNCTION IS `isAdmin_()`. They differ on
     purpose and must not be "made consistent". The trailing underscore is a
     security boundary (it hides the function from google.script.run); the DTO
     key is a frozen frontend contract read as state.user.isAdmin in
     JavaScript.html (refreshNavbar) and Admin.html (renderAdminPage). A rename
     sweep once renamed the key along with the function, which silently made the
     whole Admin console unreachable for every user, including real admins.
*/
function getCurrentUser() {
  const email = Session.getActiveUser().getEmail();

  // Domain gate (defence in depth — see ORG in Constants.js). An outsider on a
  // misconfigured "Anyone" deployment resolves to a blank/foreign email; return
  // the same blank-identity shape the frontend already handles, so bootstrap()
  // shows the "sign in with your Megaworld account" screen instead of an empty
  // but functional dashboard. Shape is unchanged (frozen DTO).
  if (!isAllowedDomain_(email)) {
    // Log the domain only, never the full address: this path fires for every
    // outsider who opens the link, and the execution log would otherwise
    // accumulate a list of non-employee identities readable by any project editor.
    const rejectedDomain = String(email).indexOf("@") !== -1
      ? String(email).split("@").pop()
      : "(unidentified)";
    Logger.log("getCurrentUser(): rejected caller outside allowed domain — domain '" + rejectedDomain + "'");
    return { email: "", role: "requestor", isAdmin: false };
  }

  const role = detectRole_(email);
  // Key `isAdmin` (frozen frontend contract), value from `isAdmin_()` (hidden
  // server helper). See the warning in the doc block above before renaming either.
  return { email, role, isAdmin: isAdmin_(email) };
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
              isContractExpired_() so the UI never parses date strings.

  STEPS
    Step 1 — Resolve caller + load rows
      Layman    : Kunin ang email ng naka-login at lahat ng request rows.
      Technical : Session email + getDataRows_(REQUESTS).
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
  const rows  = getDataRows_(SHEET_NAMES.REQUESTS);
  return rows
    .filter(row => sameEmail_(row[CR.REQUESTOR - 1], email))
    .map(row => ({
      requestId:     row[CR.REQUEST_ID - 1],
      controlNumber: row[CR.CONTROL_NUMBER - 1],
      projectTitle:  row[CR.PROJECT_TITLE - 1],
      group:         getGroupNameById_(row[CR.GROUP - 1]),  // display name (CR.GROUP holds group_id)
      status:        row[CR.STATUS - 1],
      step:          row[CR.STEP - 1],
      dateFiled:     row[CR.DATE_OF_FILING - 1]
        ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      contractEnd:   row[CR.CONTRACT_END - 1]
        ? Utilities.formatDate(new Date(row[CR.CONTRACT_END - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      isExpired:     isContractExpired_(row[CR.CONTRACT_END - 1]),
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
      Technical : Session email; getDataRows_; pending = [PENDING_1/2/3].
    Step 2 — Filter to "pending AND mine to act"
      Layman    : Panatilihin lang kung pending pa AT ako ang dapat pumirma ngayon.
      Technical : status ∈ pending && getCurrentApprover_(step, group) === email
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
  const rows  = getDataRows_(SHEET_NAMES.REQUESTS);
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];

  return rows
    .filter(row => {
      const status  = row[CR.STATUS - 1];
      const step    = row[CR.STEP - 1];
      const groupId = row[CR.GROUP - 1];
      if (!pending.includes(status)) return false;
      return sameEmail_(getCurrentApprover_(step, groupId), email);
    })
    .map(row => ({
      requestId:     row[CR.REQUEST_ID - 1],
      controlNumber: row[CR.CONTROL_NUMBER - 1],
      projectTitle:  row[CR.PROJECT_TITLE - 1],
      requestor:     row[CR.REQUESTOR - 1],
      group:         getGroupNameById_(row[CR.GROUP - 1]),
      status:        row[CR.STATUS - 1],
      step:          row[CR.STEP - 1],
      dateFiled:     row[CR.DATE_OF_FILING - 1]
        ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      contractEnd:   row[CR.CONTRACT_END - 1]
        ? Utilities.formatDate(new Date(row[CR.CONTRACT_END - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      isExpired:     isContractExpired_(row[CR.CONTRACT_END - 1]),
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
      Technical : Session email + getDataRows_(REQUESTS).
    Step 2 — Build the "acted" set from the timeline
      Layman    : Isang pass sa Activity_Log: lahat ng request na ako ang
                  umaprove/nag-decline_/nagbalik, itala.
      Technical : One getDataRows_(ACTIVITY_LOG) scan → membership map keyed by
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
  const rows  = getDataRows_(SHEET_NAMES.REQUESTS);

  // Which requests has the caller acted on? Derive from the append-only timeline:
  // any approve_/decline_/return action whose actor is the caller. Load all action
  // rows once, build a membership set — no per-row sheet reads, no LAST_ACTION_BY.
  const acted = {};
  activityRows_().forEach(function (a) {
    const action = a[ACT.ACTION - 1];
    if ((action === ACTION.APPROVED || action === ACTION.DECLINED || action === ACTION.RETURNED) &&
        sameEmail_(a[ACT.ACTOR_EMAIL - 1], email)) {
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
        group:         getGroupNameById_(row[CR.GROUP - 1]),
        status:        row[CR.STATUS - 1],
        step:          row[CR.STEP - 1],
        dateFiled:     row[CR.DATE_OF_FILING - 1]
          ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
          : "",
        contractEnd:   row[CR.CONTRACT_END - 1]
          ? Utilities.formatDate(new Date(row[CR.CONTRACT_END - 1]), "Asia/Manila", "MMM dd, yyyy")
          : "",
        isExpired:     isContractExpired_(row[CR.CONTRACT_END - 1]),
      };
    });
}


/*
  Function Name: getRequestDetail
  LAYMAN    : Buong detalye ng IISANG request — lahat ng field, approvers,
              attachments, resubmit_ history — para sa detail page. May guard:
              ang requestor, isang approver ng group nito, o isang admin lang
              ang makakakita. Kung wala kang karapatan, null ang babalik (hindi error).
  TECHNICAL : Reads the full row, authorizes the caller (requestor OR chain
              approver OR admin), then returns a rich DTO (dates pre-formatted,
              PREVIOUS_APPROVALS JSON-parsed, attachments joined in).
  PARAMS    : requestId — the request to load.
  RETURNS   : Detail DTO object, or null if not found OR caller unauthorized.

  STEPS
    Step 1 — Locate the row
      Layman    : Hanapin ang row ng request; wala → null.
      Technical : getRowNumberByRequestId_(); -1 → return null.
    Step 2 — Read row + group approvers
      Layman    : Basahin ang buong row at ang approvers ng group.
      Technical : getRange(rowNum,1,1,34); getApprovers_(group) || {}.
    Step 3 — Authorize the caller (view gate)
      Layman    : Requestor ka ba, approver ng chain, o admin? Kung hindi, null.
      Technical : return null unless sameEmail_(REQUESTOR, caller) ||
                  isChainApprover_(row, caller) || isAdmin_(caller). Null (not an
                  error object) so the detail renderer treats it as "not found
                  / no access". Admin access is read-only by construction —
                  action panels are owner/current-approver gated in the UI and
                  the action handlers re-verify server-side.
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
  const sheet  = getSheet_(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId_(requestId);
  if (rowNum === -1) return null;

  const row       = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const groupId   = row[CR.GROUP - 1];
  const approvers = getApprovers_(groupId) || {};

  // Only the requestor, an approver in this request's chain, or an admin
  // (Tier-2 oversight — read-only; the UI hides action panels for non-owners)
  // may view it.
  const caller = Session.getActiveUser().getEmail();
  if (!sameEmail_(row[CR.REQUESTOR - 1], caller) && !isChainApprover_(row, caller) && !isAdmin_(caller)) {
    return null;
  }

  const fmtDateTime = (val) => val
    ? Utilities.formatDate(new Date(val), "Asia/Manila", "MMM dd, yyyy hh:mm a") : "";
  const fmtDateOnly = (val) => val
    ? Utilities.formatDate(new Date(val), "Asia/Manila", "MMM dd, yyyy") : "";

  // Per-step dates/remarks, previousApprovals, and resubmitHistory are DERIVED
  // from the append-only Approval_Actions timeline (frozen DTO — same shape).
  const view       = getApprovalView_(requestId);
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
    group:                getGroupNameById_(groupId),  // display name (row holds group_id)
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
    isExpired:            isContractExpired_(row[CR.CONTRACT_END - 1]),  // #10 — drives the detail-page "Expired" chip
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
    // Full cross-cycle action history: every submit/approve/decline/return/resubmit
    // in order. Rendered identically for the requestor (RequestDetail) and the
    // approver (ReviewDetail) via renderTimeline() in UI.html. EXPIRY_* system
    // actions are filtered out server-side. Additive field — nothing else moved.
    timeline:             view.timeline,
    approver1:            approvers.approver1 || "",
    approver2:            approvers.approver2 || "",
    approver3:            approvers.approver3 || "",
    designation1:         approvers.designation1 || "",
    designation2:         approvers.designation2 || "",
    designation3:         approvers.designation3 || "",
    // No raw Drive URL is sent to the frontend. The UI uses attachmentId to call
    // the identity-gated downloadAttachment(); FILE holds the display filename.
    attachments:          getAttachmentsForRequest_(row[CR.REQUEST_ID - 1]).map(a => ({
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
              validateAttachmentPayload_, uploadAttachmentFile_, writeAttachmentRows_
              are in Attachments.js. Status always PENDING_1 — no SYNCING state.
  PARAMS    : formData — form fields + formData.files (Array<FilePayload>).
              FilePayload: { filename, mimeType, base64, description }.
  RETURNS   : { success:true, requestId, controlNumber }
              { success:false, error } on validation or upload failure.

  STEPS
    Step 1 — Validate file payload
      Layman    : Bago mag-upload, siguraduhing may files at kumpleto ang data.
      Technical : validateAttachmentPayload_(files) — returns {ok,error}; early
                  return on failure. No I/O performed yet.
    Step 2 — Generate identifiers
      Layman    : Gumawa ng request ID at control number.
      Technical : generateRequestId_(); generateControlNumber_(requestId).
    Step 3 — Upload all files to Drive (rollback on any failure)
      Layman    : I-upload ang bawat file. Kung may pumalpak, itapon ang mga
                  naunang naka-upload at ibalik ang error — walang request na
                  nalilikha sa sheet.
      Technical : uploadAttachmentFile_(f) per file; on catch: trash uploaded
                  fileIds via DriveApp.getFileById().setTrashed(true).
    Step 4 — Append the request row (PENDING_1)
      Layman    : Ngayon lang isusulat ang request — pagkatapos ng upload.
      Technical : Build 33-col array via CR.*; status = PENDING_1 always;
                  EXPECTED_ATTACHMENTS = files.length (record-keeping).
    Step 5 — Write attachment child rows (batched)
      Layman    : Isulat ang lahat ng attachment rows sa isang write.
      Technical : writeAttachmentRows_(requestId, uploaded) — one setValues call.
    Step 6 — Send approval email (last — implies files are ready)
      Layman    : Padala ng email sa Approver 1. Siniguro na na kumpleto ang lahat.
      Technical : sendApprovalRequest_(requestId).

  EXAMPLE
    submitNewRequest({ projectTitle:"Antivirus", group:"ISM - InfoSec", …,
                       files: [{ filename:"PO.pdf", mimeType:"application/pdf",
                                 base64:"JVBERi0…", description:"Purchase Order" }] })
    → { success:true, requestId:"9B1", controlNumber:"EC-2026-00042-9B1" }
      (file in Drive; row in PENDING_1; approver emailed)
*/
/*
  Function Name: validateRequestFields_

  LAYMAN (Tropang Ex):
  Bago isulat sa sheet, tinitingnan muna nito kung may kalokohan sa mga
  tinype: sobrang haba bang project title, o baka mas maaga pa ang katapusan
  ng contract kaysa sa simula nito. Dati kasi, ang na-validate lang ay yung
  mga file — yung mga text field, basta pinapasok kahit gaano kahaba.

  TECHNICAL:
  Server-side companion to validateAttachmentPayload_(). Caps every free-text
  field written by submitNewRequest and checks contract-date ordering. Mirrors
  that function's { ok, error } shape so the call site reads the same way.

  ⚠️ WHY: a Sheets cell holds 50,000 chars and submitNewRequest is directly
  callable via google.script.run, so the form's own inputs are not a control.
  An unbounded title renders into every dashboard row and every notification
  email. An end-before-start row is born expired and immediately trips
  checkContractExpiries().

  Deliberately does NOT newly require any field to be non-blank — that would
  change existing accepted behaviour. Ordering is only enforced when BOTH
  dates are present and parseable.

  PARAMS  : formData — the raw submit payload from the frontend.
  RETURNS : { ok: true } | { ok: false, error: "<user-facing message>" }
*/
function validateRequestFields_(formData) {
  const MAX_SHORT_TEXT = 200;    // names, designations, reference numbers
  const MAX_REMARK     = 2000;   // requestor's free-text remark

  const shortFields = {
    "Project title":     formData.projectTitle,
    "Designation":       formData.requestorDesig,
    "Accountable person":formData.accountablePerson,
    "Department":        formData.department,
    "Location":          formData.location,
    "PC name":           formData.pcName,
    "PRISM":             formData.prism,
    "Purchase order":    formData.purchaseOrder,
    "iHelp number":      formData.ihelpNumber,
    "Product type":      formData.productType,
    "Product name":      formData.productName,
    "Type of purchase":  formData.typeOfPurchase,
    "Type of license":   formData.typeOfLicense,
    "Supplier name":     formData.supplierName
  };

  for (const label in shortFields) {
    const val = shortFields[label];
    if (val !== undefined && val !== null && String(val).length > MAX_SHORT_TEXT) {
      return { ok: false, error: label + " is too long (max " + MAX_SHORT_TEXT + " characters)." };
    }
  }

  if (formData.requestorRemark && String(formData.requestorRemark).length > MAX_REMARK) {
    return { ok: false, error: "Remark is too long (max " + MAX_REMARK + " characters)." };
  }

  // Ordering only — blanks stay acceptable, as before.
  const start = formData.contractStart ? new Date(formData.contractStart) : null;
  const end   = formData.contractEnd   ? new Date(formData.contractEnd)   : null;
  if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
    return { ok: false, error: "Contract end date cannot be earlier than the contract start date." };
  }

  return { ok: true };
}

function submitNewRequest(formData) {
  const caller = Session.getActiveUser().getEmail();
  const files  = Array.isArray(formData.files) ? formData.files : [];

  // Step 0 — Identity gate. Blocks an unidentified ("" email) or out-of-domain
  // caller from creating rows. Without this, a misconfigured "Anyone" deployment
  // would let an anonymous visitor write requests with a blank requestor.
  if (!isAllowedDomain_(caller)) {
    return { success: false, error: "Unauthorized. Please sign in with your organization Google account." };
  }

  // Step 1 — Server-side validation (size/count/shape/descriptions)
  const v = validateAttachmentPayload_(files);
  if (!v.ok) return { success: false, error: v.error };

  // Step 1b — Server-side validation of the text fields + contract dates.
  // The form's maxlength attributes are not a control: this function is
  // directly callable via google.script.run.
  const tv = validateRequestFields_(formData);
  if (!tv.ok) return { success: false, error: tv.error };

  // Step 2a — Reject a group with no active approver chain. Without this the
  // request would route to nobody (getCurrentApprover_ -> null) and sit invisible
  // on every pending list forever. Mirrors the getApproverGroups dropdown filter.
  // Require a usable Approver 1, not merely a non-empty chain: a hand-seeded
  // Group_Approvers row with ACTIVE=TRUE but a blank email yields a truthy
  // object here, and the request would then route to nobody and stay invisible.
  const groupChain = getApprovers_(formData.group);
  if (!groupChain || !groupChain.approver1) {
    return { success: false, error: "That approver group has no active approvers. Please choose another group." };
  }

  // Step 2b — Generate identifiers. Regenerate the requestId until it is unique
  // (a final guard on top of the now-collision-resistant generator).
  let requestId = generateRequestId_();
  while (getRowNumberByRequestId_(requestId) !== -1) requestId = generateRequestId_();
  const controlNo = generateControlNumber_(requestId);

  // Step 3 — Upload ALL files to Drive first (rollback on any failure)
  // Nothing is written to either sheet until every upload succeeds.
  const uploaded = [];
  try {
    for (let i = 0; i < files.length; i++) {
      // First submit = resubmit_ cycle 0. Drive name uses the naming convention;
      // the friendly original filename is what we store for display.
      const driveName = buildAttachmentDriveName_(controlNo, 0, files[i].filename);
      const result    = uploadAttachmentFile_(files[i], driveName);
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

  // Steps 4-5 — Write the request row + timeline + attachment rows. If any write
  // fails after the files were uploaded, roll back: trash the files AND remove the
  // request row, so no half-written request (visible to an approver with no
  // supporting documents) and no orphaned Drive files survive.
  const sheet = getSheet_(SHEET_NAMES.REQUESTS);
  let rowWritten = false;
  try {
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
    rowWritten = true;

    // Write attachment child rows (one batched write; cycle 0 = first submit).
    writeAttachmentRows_(requestId, uploaded, 0);

    // Log the submit LAST. Activity_Log is append-only and can never be
    // un-written, so it must be the final step: if an earlier write fails we
    // roll back without stranding a `submitted` row for a request that does
    // not exist (which would poison the audit trail the whole schema rests on).
    appendAction_(requestId, formData.group, 0, null, caller, ACTION.SUBMITTED, "");
  } catch (err) {
    uploaded.forEach(function (u) {
      try { DriveApp.getFileById(u.fileId).setTrashed(true); } catch (e) {}
    });
    // Re-resolve the row by Request ID rather than trusting a row number captured
    // earlier: submitNewRequest takes no lock, so a concurrent submit can append
    // or shift rows in between, and deleting a stale index would destroy ANOTHER
    // user's request. Looking it up by identity is always correct.
    if (rowWritten) {
      try {
        const rollbackRow = getRowNumberByRequestId_(requestId);
        if (rollbackRow !== -1) sheet.deleteRow(rollbackRow);
      } catch (e) {}
    }
    Logger.log("submitNewRequest(): Sheet write failed — " + err + ". Rolled back files + row.");
    return { success: false, error: "Submission failed. No request was created. Please try again." };
  }

  // Step 6 — Send approval email LAST. A mail failure must NOT roll back the
  // committed request; sendBrandedEmail_ swallows send errors so this never throws.
  sendApprovalRequest_(requestId);

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
              nga ang nasa pila. Kung oo, ina-approve_ ang request: kung siya
              ang huling pirmador → "Fully Approved" + emails; kung hindi → next
              approver na, may resibo sa kanya at progress update sa requestor.
  TECHNICAL : Guard (isCurrentApprover_) → approve_() → branch on newStatus to
              fire either the fully-approved pair or the intermediate trio.
  PARAMS    : requestId — the request to approve_.
  RETURNS   : approve_()'s result { success, newStatus, step } — or
              { success:false, error } if not found / unauthorized.

  STEPS
    Step 1 — Authorize
      Layman    : Hanapin ang row; kung wala → error; kung hindi ikaw ang
                  current approver → Unauthorized.
      Technical : getRequestRowData_; isCurrentApprover_(row, caller) gate.
    Step 2 — Perform the approval
      Layman    : Itaas ang step / markahan kung fully approved na.
      Technical : approve_(requestId) (Approvals.js) returns newStatus/step.
    Step 3 — Fire the right emails
      Layman    : Tapos na lahat → 2 fully-approved emails. May susunod pa →
                  email sa next approver + resibo sa nag-approve_ + progress sa
                  requestor.
      Technical : if newStatus === APPROVED → fullyApproved(approver+requestor);
                  else → approvalRequest + approveConfirm + progressUpdate.

  EXAMPLE
    handleApprove("REQ-9b1")  // final approver
    → { success:true, newStatus:"Fully Approved", step:3 }
      (sends sendFullyApprovedToApprover_ + sendFullyApprovedToRequestor_)
*/
function handleApprove(requestId) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData_(requestId);
  if (!row) return { success: false, error: "Request not found." };
  if (!isCurrentApprover_(row, caller)) return { success: false, error: "Unauthorized" };

  const result = approve_(requestId);
  if (result.success) {
    if (result.newStatus === STATUS.APPROVED) {
      sendFullyApprovedToApprover_(requestId);
      sendFullyApprovedToRequestor_(requestId);
    } else {
      sendApprovalRequest_(requestId);           // next approver — action needed
      sendApproveConfirmToApprover_(requestId);  // actioner receipt (symmetric with decline_/return)
      sendProgressUpdateToRequestor_(requestId); // requestor mid-chain progress update
    }
  }
  return result;
}

/*
  Function Name: handleDecline
  LAYMAN    : Pag pinindot ng approver ang "Decline". Sinisiguro muna kung siya
              ang nasa pila, tapos isinasara ang request (hindi na pwedeng
              i-resubmit_) at nag-eemail sa nag-decline_ at sa requestor.
  TECHNICAL : Guard (isCurrentApprover_) → decline_() → notify decliner + requestor.
  PARAMS    : requestId — request to decline_; remark — the decline_ reason.
  RETURNS   : decline_()'s result, or { success:false, error }.

  STEPS
    Step 1 — Authorize
      Layman    : Row check + current-approver check; else error/Unauthorized.
      Technical : getRequestRowData_; isCurrentApprover_ gate.
    Step 2 — Perform the decline_
      Layman    : Markahang "Declined", itala ang remark.
      Technical : decline_(requestId, remark) (Approvals.js).
    Step 3 — Notify both sides
      Layman    : Email sa nag-decline_ (resibo) at sa requestor.
      Technical : sendDeclineToApprover_ + sendDeclineToRequestor_.

  EXAMPLE
    handleDecline("REQ-9b1", "Budget not approved")
    → { success:true, … }  (request closed; both parties emailed)
*/
function handleDecline(requestId, remark) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData_(requestId);
  if (!row) return { success: false, error: "Request not found." };
  if (!isCurrentApprover_(row, caller)) return { success: false, error: "Unauthorized" };

  const result = decline_(requestId, remark);
  if (result.success) {
    sendDeclineToApprover_(requestId);
    sendDeclineToRequestor_(requestId);
  }
  return result;
}

/*
  Function Name: handleReturn
  LAYMAN    : Pag ibinalik ng approver ang request sa requestor para ayusin.
              Ito ang pinaka-maraming bookkeeping: bago baguhin ang state,
              itinatala muna kung SINO ang nagbalik, KAILAN, at BAKIT (bilang
              [PENDING] entry sa history), at kung SINO-SINO nang approver ang
              nakapag-approve_ (para malaman pag na-resubmit_, babalik ulit sa
              kanila). Tapos saka ibinabalik at nag-eemail sa lahat ng apektado.
  TECHNICAL : Captures returner + reason + prior approvals WHILE Step still
              reflects the returner (this is the only reliable point), writes a
              single active [PENDING] history entry + the PREVIOUS_APPROVALS
              JSON, then returnRequest_() + 3 notifications.
  PARAMS    : requestId — request to return; remark — what needs to change.
  RETURNS   : returnRequest_()'s result, or { success:false, error/message }.

  STEPS
    Step 1 — Locate row + read pre-mutation state
      Layman    : Hanapin ang row; basahin ang step, group, approvers, at
                  kung sino ang nagbalik — BAGO magbago ang state.
      Technical : getRowNumberByRequestId_; read 33-col row; returner = session.
    Step 2 — Authorize BEFORE any write
      Layman    : Kung hindi ikaw ang current approver → Unauthorized (bago
                  pa masulatan ang history/AH).
      Technical : sameEmail_(getCurrentApprover_(step,group), returner) gate,
                  placed before any setValue so no unauthorized mutation.
    Step 3 — Build the [PENDING] history entry
      Layman    : Buuin ang tala: sino, kailan, anong dahilan.
      Technical : approverLabel = `Approver ${step}`; pendingEntry string with
                  returner, PH timestamp, and reason.
    Step 4 — Snapshot prior approvals → AH column
      Layman    : Itala kung sino nang nakapag-approve_ bago mabura ang petsa.
      Technical : push {step,email,date} for each filled AppN_Date; write JSON
                  to PREVIOUS_APPROVALS (AH) — keeps AG as pure narrative.
    Step 5 — Write history (one active [PENDING] only)
      Layman    : Kung may luma nang [PENDING], palitan — huwag mag-ipon ng dalawa.
      Technical : if existing includes "[PENDING]", splice it out before
                  appending; else append after a separator.
    Step 6 — Perform the return + notify
      Layman    : Ibalik ang request; email sa requestor, sa nagbalik, at sa
                  mga dating approver (na kasama ang dahilan).
      Technical : returnRequest_(); on success → sendReturnToRequestor_ +
                  sendReturnConfirmToApprover_ + sendReturnedChainNotification_.

  EXAMPLE
    handleReturn("REQ-9b1", "Wrong supplier on contract")
    → { success:true, … }
      (AH stores prior approvers; requestor + returner + prior approvers emailed)
*/
function handleReturn(requestId, remark) {
  const row = getRequestRowData_(requestId);
  if (!row) return { success: false, message: "Request not found." };

  const step          = row[CR.STEP - 1];
  const groupId       = row[CR.GROUP - 1];
  const returnerEmail = Session.getActiveUser().getEmail();

  // Only the current approver may return this request (checked before any write).
  if (!sameEmail_(getCurrentApprover_(step, groupId), returnerEmail)) {
    return { success: false, error: "Unauthorized" };
  }

  const approverLabel = `Approver ${step}`;

  // Who had already approved this cycle — for the prior-approver notification.
  // Derived from the append-only timeline; no [PENDING]/PREVIOUS_APPROVALS
  // bookkeeping columns anymore (returnRequest_() appends a RETURNED action, and
  // getApprovalView_ reconstructs history + previousApprovals from the timeline).
  const previousApprovals = getApprovalView_(requestId).previousApprovals;

  const result = returnRequest_(requestId, remark);
  if (result.success) {
    sendReturnToRequestor_(requestId, approverLabel);
    sendReturnConfirmToApprover_(requestId, approverLabel);
    sendReturnedChainNotification_(requestId, previousApprovals, remark, approverLabel);
  }
  return result;
}

/*
  Function Name: handleResubmit
  LAYMAN    : Pag ire-resubmit_ ng requestor ang request na ibinalik sa kanya.
              Requestor lang ang pwede, at "Returned" lang ang pwedeng
              i-resubmit_. Pwede silang magdagdag ng bago/tamang documents (kasi
              kadalasan dahil sa maling/kulang na dokumento kaya naibalik) —
              OPTIONAL lang ito; ang lumang files ay pinananatili (audit trail).
              Ina-upload muna ang bagong files BAGO baguhin ang status, tapos
              ibinabalik sa Approver 1 ang chain na may resubmit_ email.
  TECHNICAL : Guard (caller === requestor AND status === RETURNED) → validate +
              upload-first any newFiles (rollback on failure) → append their rows
              (old rows kept) → capture return reason + next resubmit_ count BEFORE
              resubmit_() clears the remark columns → resubmit_() (→ PENDING_1) →
              confirmation + resubmit_ approval email. Upload-first mirrors
              submitNewRequest's atomicity: no state change until files are safe.
  PARAMS    : requestId — the returned request to resubmit_.
              newFiles  — optional Array<FilePayload> of added/corrected docs
                          ({filename, mimeType, base64, description}). May be empty.
  RETURNS   : resubmit_()'s result, or { success:false, error }.

  STEPS
    Step 1 — Authorize (owner + returned-only)
      Layman    : Ikaw ba ang requestor AT "Returned" ba ito? Kung hindi →
                  Unauthorized.
      Technical : sameEmail_(REQUESTOR, caller) && status === RETURNED.
    Step 2 — Capture reason + count BEFORE clearing
      Layman    : Kunin ang dating dahilan (sa remark cols) at ang bagong
                  resubmit_ number bago burahin ni resubmit_().
      Technical : returnReason from APP3/2/1_REMARK fallback; resubmitCount =
                  current + 1 (mirrors what resubmit_() will write).
    Step 3 — Perform the resubmit_ + notify
      Layman    : Ibalik sa simula ng chain; email-confirm sa requestor; kung
                  diretso sa Approver 1, padalhan siya ng dedicated resubmit_ email.
      Technical : resubmit_(); sendResubmitConfirmToRequestor_; if newStatus ===
                  PENDING_1 → sendResubmitApprovalRequest_ (SYNCING defers it).

  EXAMPLE
    handleResubmit("REQ-9b1")
    → { success:true, newStatus:"Pending Approver 1", … }
      (requestor gets a confirm; Approver 1 gets a "this is a resubmission" email)
*/
function handleResubmit(requestId, newFiles) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData_(requestId);
  if (!row) return { success: false, error: "Request not found." };
  // Only the requestor may resubmit_, and only a returned request can be resubmitted.
  if (!sameEmail_(row[CR.REQUESTOR - 1], caller) || row[CR.STATUS - 1] !== STATUS.RETURNED) {
    return { success: false, error: "Unauthorized" };
  }

  // Return reason (latest decline_/return remark) + next cycle, derived from the timeline.
  const returnReason  = getApprovalView_(requestId).latestRemark || "No reason provided.";
  const resubmitCount = (parseInt(row[CR.RESUBMIT_COUNT - 1]) || 0) + 1; // +1 mirrors what resubmit_() will write

  // Optional re-upload: validate + upload-first any new/corrected documents.
  // Old attachment rows are KEPT; new ones are appended with the r{N} naming
  // convention so both cycles are distinguishable in the Drive folder.
  const files = Array.isArray(newFiles) ? newFiles : [];
  const v = validateAttachmentPayload_(files, false); // false → new files optional
  if (!v.ok) return { success: false, error: v.error };

  const uploaded = [];
  if (files.length > 0) {
    const controlNo = row[CR.CONTROL_NUMBER - 1];
    try {
      for (let i = 0; i < files.length; i++) {
        const driveName = buildAttachmentDriveName_(controlNo, resubmitCount, files[i].filename);
        const result    = uploadAttachmentFile_(files[i], driveName);
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
  }

  // Flip the state BEFORE recording the new attachment rows. resubmit_() can now
  // fail on a lock timeout, and writing rows tagged with a resubmit_ cycle that
  // never happened would file the documents under a phantom "Resubmit #N" and
  // make the user's retry upload a duplicate set.
  const result = resubmit_(requestId);
  if (!result.success) {
    uploaded.forEach(function(u) {
      try { DriveApp.getFileById(u.fileId).setTrashed(true); } catch (e) {}
    });
    Logger.log("handleResubmit(): resubmit_() failed — " + (result.message || "") + ". Rolled back uploaded files.");
    return result;
  }

  if (uploaded.length > 0) {
    writeAttachmentRows_(requestId, uploaded, resubmitCount); // append — keeps the original files
  }

  sendResubmitConfirmToRequestor_(requestId, returnReason, resubmitCount);
  if (result.newStatus === STATUS.PENDING_1) {
    sendResubmitApprovalRequest_(requestId, returnReason, resubmitCount); // dedicated resubmit_ email for Approver 1
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