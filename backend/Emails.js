// Emails.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Emails.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Lahat ng email na pinapadala ng portal — mula "may bagong request" hanggang
  "approved na!", kasama ang bawat decline, return, resubmit at progress
  update — narito. Kapalit ito ng AppSheet's 5 notification bots. Ang bawat
  email function ay inaalam ang detalye ng request galing sa sheet, nagtatayo
  ng plain-text body (fallback) + branded HTML body (EmailHtml.js helpers) +
  subject, at nagpapadala via sendBrandedEmail().

  TECHNICAL:
  15 send* functions (one per notification event) + 7 shared helpers. All
  event emails are called by the handle* functions in WebApp.js immediately
  after a successful state change; two are trigger-fired (Triggers.js sweeps);
  one is admin-fired (adminSaveChain). Identity for actioner-confirmation
  emails comes from Session.getActiveUser(); caller-independent data comes
  from getRequestData(). Every send goes through sendBrandedEmail(recipient,
  subject, textBody, htmlBody, extraOptions) (EmailHtml.js): the plain-text
  body remains the fallback (3rd positional arg), the HTML twin rides in
  options.htmlBody. The HTML layer (emailLayout/emailButton/emailInfoTable/
  emailRemarkBox/etc.) lives in EmailHtml.js — table-based, inline styles,
  per-status accent band, all user values escaped by the helpers themselves.

  ⚠️ PRODUCTION FLAG:
    EMAIL_DEV_TAG = true in dev (adds [FOR APPROVER]/[FOR REQUESTOR] prefix).
    Set to FALSE before go-live — one line toggle.

  ────────────────────────────────────────────────────────────
  HELPERS
    - EMAIL_DEV_TAG          flag: dev subject prefix on/off
    - emailSubject()         builds subject line
    - buildInfoBlock()       labeled request-info block (title/ID/requestor/group)
    - getPortalUrl()         deep-link into the portal for a specific request
    - buildAttachmentList()  supporting-documents list string
    - buildApprovalLog()     approval progress log string
    - getLatestRemark()      most-recent non-blank approver remark
    - getRequestData()       flat {rowData, rowNum, group, approvers} for email use

  ────────────────────────────────────────────────────────────
  EMAIL FUNCTIONS (event-fired, via handle* in WebApp.js)
  #   Function                          To              Fires when
  1   sendApprovalRequest               next approver   submit + intermediate approval
  2   sendDeclineToApprover             decliner        declined
  3   sendDeclineToRequestor            requestor       declined
  4   sendFullyApprovedToApprover       last approver   fully approved
  5   sendFullyApprovedToRequestor      requestor       fully approved
  6   sendReturnToRequestor             requestor       returned
  7   sendReturnConfirmToApprover       returner        returned
  8   sendApproveConfirmToApprover      approver        intermediate approval only
  9   sendProgressUpdateToRequestor     requestor       intermediate approval
  10  sendReturnedChainNotification     prior approvers any return
  11  sendResubmitConfirmToRequestor    requestor       resubmit
  12  sendResubmitApprovalRequest       approver 1      resubmit

  EMAIL FUNCTIONS (trigger-fired, via the daily sweeps in Triggers.js)
  13  sendExpiryReminderToRequestor     requestor       daily expiry sweep (#10)
  14  sendPendingApprovalReminder       current approver daily approver-reminder sweep (digest)

  EMAIL FUNCTIONS (admin-fired, via adminSaveChain in Admin.js)
  15  sendNewApproverNotice             new/changed approver  chain add / reorder
*/


// TEMP DEV AID: while testing with a single account (requestor == approver),
// prefix every subject with [FOR APPROVER] / [FOR REQUESTOR] so the same inbox
// can tell them apart. Set to false for production — one-line toggle.
// ⚠️ FLIP TO FALSE BEFORE GO-LIVE
const EMAIL_DEV_TAG = true;

// Standing note appended to IN-FLIGHT requestor emails (progress update, resubmit
// confirmation). An admin can change a request's approver chain at any time, so a
// requestor following up off a stale email could reach a former approver. This
// points them at the portal, which always shows the live current handler. (#4)
const REQUESTOR_PORTAL_NOTE =
  "Note: approvers may change while your request is in progress — always open the " +
  "portal for the current handler and status before following up.";


/*
  Function Name: emailSubject
  LAYMAN    : Gumawa ng standard na subject line para sa lahat ng emails —
              "[COC Request]: EC-2026-00042 | Action Needed". Sa dev mode,
              may "[FOR APPROVER]" prefix para madaling i-distinguish sa iisang inbox.
  TECHNICAL : Composes `${tag}[COC Request]: ${controlNumber}${suffix}`. The
              dev tag and suffix are conditionally added.
  PARAMS    : controlNumber — the request's control number string.
              statusLabel — status label suffix (e.g. "Action Needed", "Approved").
              audience — 'APPROVER' | 'REQUESTOR' (only used when EMAIL_DEV_TAG is true).
  RETURNS   : Subject string.
*/
// Helper — standard minimal subject line.
// audience = 'APPROVER' | 'REQUESTOR'; statusLabel e.g. 'Action Needed', 'Approved'.
function emailSubject(controlNumber, statusLabel, audience) {
  const tag    = EMAIL_DEV_TAG ? `[FOR ${audience}] ` : "";
  const suffix = statusLabel ? ` | ${statusLabel}` : "";
  return `${tag}[COC Request]: ${controlNumber}${suffix}`;
}


/*
  Function Name: buildInfoBlock
  LAYMAN    : Gumawa ng 4-linyang summary ng request para sa email body —
              title, ID, requestor, group — para alam agad ng tatanggap kung
              anong request ang pinag-uusapan.
  TECHNICAL : Joins 4 labeled lines (one per field) with "\n". No padding
              alignment — plain-text emails use proportional fonts.
  PARAMS    : rowData — the 0-indexed request row array (from getRequestData).
  RETURNS   : Multi-line string.
*/
// Helper — labeled request-info block shared by every email body.
// No fake colon-alignment: plain-text email uses proportional fonts,
// so "Label: value" per line is the cleanest scannable format.
function buildInfoBlock(rowData) {
  return [
    `E-Certificate Title: ${rowData[CR.PROJECT_TITLE - 1]}`,
    `E-Certificate ID: ${rowData[CR.CONTROL_NUMBER - 1]}`,
    `Requestor: ${rowData[CR.REQUESTOR - 1]}`,
    `Group: ${getGroupNameById(rowData[CR.GROUP - 1])}`,  // CR.GROUP holds group_id
  ].join("\n");
}


/*
  Function Name: getPortalUrl
  LAYMAN    : Bumuo ng link para direktang mapuntahan sa portal ang isang
              partikular na request — para sa approver (review page) o sa
              requestor (request page). Inilalagay ito sa dulo ng bawat email.
  TECHNICAL : Appends ?page=<page>&id=<requestId> to the deployed /exec URL.
              Query params are used (not hash) because the sandboxed iframe
              can't read the outer URL's hash — doGet() picks them up server-side.
  PARAMS    : requestId — the request ID to link to.
              page — 'request' (requestor view) | 'review' (approver view).
  RETURNS   : Full URL string.
*/
// Helper — per-request deep-link into the portal.
// Uses QUERY PARAMS (not hash): the Apps Script app runs in a sandboxed
// iframe, so hash fragments aren't readable by the client, but query params
// reach doGet() server-side and are forwarded to the page (see WebApp.doGet).
// page: 'request' (requestor view) | 'review' (approver view).
function getPortalUrl(requestId, page) {
  return `${ScriptApp.getService().getUrl()}?page=${page}&id=${encodeURIComponent(requestId)}`;
}


/*
  Function Name: buildAttachmentList
  LAYMAN    : Lista ng mga naka-attach na files ng request — para makita ng
              approver sa email kung anong documents ang kasama. WALANG Drive
              link dito: private na ang files (Phase 8 gated serving), kaya
              bubuksan ang mga ito sa loob ng portal (gamit ang deep-link na
              nasa ibaba ng email) — doon naka-identity-check.
  TECHNICAL : getAttachmentsForRequest, maps each row to "- filename — description".
              NO FILE_LINK is emitted (files are private; a raw link would 404).
              The approver opens the files via the portal deep-link already in the
              email body → gated downloadAttachment(). Empty → fallback text.
  PARAMS    : requestId — the request whose attachments to list.
  RETURNS   : Multi-line string (one attachment per line, or fallback text).
*/
// Helper — builds the supporting documents list for email body
// Replaces AppSheet's <<Start: [Related Request_Attachments]>> loop
function buildAttachmentList(requestId) {
  const attachments = getAttachmentsForRequest(requestId);
  if (attachments.length === 0) return "No supporting documents uploaded.";
  return attachments
    .map(row => `- ${row[RA.FILE - 1]} — ${row[RA.DESCRIPTION - 1]}`)
    .join("\n");
}


/*
  Function Name: buildApprovalLog
  LAYMAN    : Para sa email, ipakita kung sino-sino nang nag-approve at kailan.
              Lalabas lang ang slots na may laman; walang laman → "No approvals
              recorded yet."
  TECHNICAL : Reads APP1/2/3_DATE; for each non-empty slot, appends
              "Approver N: email\nApproved: timestamp". Replaces AppSheet's
              <<If: ISNOTBLANK([App1_Date])>> blocks.
  PARAMS    : rowData — the 0-indexed row array; approvers — from getApprovers().
  RETURNS   : Multi-line string.
*/
// Helper — builds the approval progress log shown in emails.
// Reads per-step approval dates from the Approval_Actions timeline (current
// cycle) via getApprovalView — signature unchanged so callers don't change.
function buildApprovalLog(rowData, approvers) {
  const view = getApprovalView(rowData[CR.REQUEST_ID - 1]);
  const slot = function (n) { return n === 1 ? approvers.approver1 : n === 2 ? approvers.approver2 : approvers.approver3; };
  let log = "";
  [1, 2, 3].forEach(function (n) {
    const s = view.byStep[n];
    if (s && s.date) {
      log += `Approver ${n}: ${slot(n) || "—"}\n`;
      log += `Approved: ${formatPHTime(new Date(s.date))}\n\n`;
    }
  });
  return log.trim() || "No approvals recorded yet.";
}


/*
  Function Name: getLatestRemark
  LAYMAN    : Kunin ang pinakabagong remark/dahilan ng approver — kung step 3
              ang nag-remark, yun ang gagamitin; kung wala step 2; kung wala
              step 1; kung lahat wala, "No reason provided."
  TECHNICAL : Returns the first non-blank value from APP3 → APP2 → APP1_REMARK,
              with a fallback string. Replaces AppSheet's IFS(ISNOTBLANK…) chain.
  PARAMS    : rowData — the 0-indexed row array.
  RETURNS   : Remark string.
*/
// Helper — gets the most recent decline/return remark.
// Derived from the Approval_Actions timeline via getApprovalView — signature
// unchanged so callers don't change.
function getLatestRemark(rowData) {
  return getApprovalView(rowData[CR.REQUEST_ID - 1]).latestRemark || "No reason provided.";
}


/*
  Function Name: getRequestData
  LAYMAN    : I-load ang request galing sa sheet bilang madaling gamitin na
              object — kasama ang rowData, group, at approvers — para handa
              na ang lahat ng kailangan ng isang email function.
  TECHNICAL : Reads 31 cols (NOTE: PREVIOUS_APPROVALS at col 34 is NOT included —
              email functions that need it receive it as a param instead).
  PARAMS    : requestId — the request to load.
  RETURNS   : { rowData, rowNum, group, approvers } — or null if not found.
*/
// Helper — loads a full request row as a flat object for easy reference
function getRequestData(requestId) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return null;
  const rowData   = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const group     = rowData[CR.GROUP - 1];   // group_id
  const approvers = getApprovers(group);
  return { rowData, rowNum, group, approvers };
}


// ============================================================
// EMAIL 1 — Send approval request to current approver
// AppSheet equivalent: Next Approver Bot → Step_Update_To_Requestor
// ============================================================
/*
  Function Name: sendApprovalRequest
  LAYMAN    : Email sa approver na "May bagong request para sa iyo." Kasama ang
              detalye ng request, attachments, at progress ng approval. Ginagamit
              sa first-time submit at sa bawat intermediate approval (para sa next
              approver). May deep-link para diretso mapuntahan ang review page.
  TECHNICAL : TO: getCurrentApprover(step, group). Includes buildInfoBlock,
              buildAttachmentList, buildApprovalLog, and the review deep-link.
  FIRES     : submitNewRequest (first submit, no attachments) + handleApprove
              (intermediate step, for the next approver) + checkAttachmentSync.
*/
function sendApprovalRequest(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const step            = rowData[CR.STEP - 1];
  const currentApprover = getCurrentApprover(step, rowData[CR.GROUP - 1]);
  if (!currentApprover) return;

  const controlNumber   = rowData[CR.CONTROL_NUMBER - 1];
  const attachmentList  = buildAttachmentList(requestId);
  const approvalLog     = buildApprovalLog(rowData, approvers);

  const subject = emailSubject(controlNumber, "Action Needed", "APPROVER");

  const body = `Good day!

You have a new e-certificate request that requires your review and action.

${buildInfoBlock(rowData)}

Supporting Documents:
${attachmentList}

Approval Progress:
${approvalLog}

Please review and act on this request (approve, decline, or return).
Open this request: ${getPortalUrl(requestId, "review")}`;

  // HTML twin — same content blocks, branded layout. Plain `body` stays the fallback.
  const html = emailLayout({
    accent:   "navy", // action needed
    bodyHtml:
      emailP("Good day!") +
      emailP("You have a new e-certificate request that requires your <strong>review and action</strong>.") +
      emailInfoTable(rowData) +
      emailSection("Supporting Documents", emailAttachmentList(requestId)) +
      emailSection("Approval Progress", emailApprovalLog(rowData, approvers)) +
      emailP("Please review and act on this request (approve, decline, or return)."),
    buttonUrl:   getPortalUrl(requestId, "review"),
    buttonLabel: "Review this request",
  });

  sendBrandedEmail(currentApprover, subject, body, html);
  Logger.log(`sendApprovalRequest(): Emailed ${currentApprover} for ${requestId}`);
}


// ============================================================
// EMAIL 2 — Confirm decline to the approver who declined
// AppSheet equivalent: Decline Bot → Confirm_Decline_To_Approver
// ============================================================
/*
  Function Name: sendDeclineToApprover
  LAYMAN    : Resibo sa approver na nagdecline: "Confirmed, dinecline mo ito."
  TECHNICAL : TO: Session.getActiveUser() (the decliner). Date of action from nowFormatted().
  FIRES     : handleDecline (on success).
*/
function sendDeclineToApprover(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const actioner      = Session.getActiveUser().getEmail();
  const approverLabel = "Approver " + rowData[CR.STEP - 1];   // step is unchanged on decline
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];

  const subject = emailSubject(controlNumber, "Declined", "APPROVER");

  const body = `Good day!

This confirms that you, as ${approverLabel}, have declined the following request.

${buildInfoBlock(rowData)}

Date of Action: ${nowFormatted()}

The requestor has been notified that this request is now closed and cannot be resubmitted.
Open this request: ${getPortalUrl(requestId, "review")}`;

  // HTML twin — red accent (decline receipt).
  const html = emailLayout({
    accent:   "red",
    bodyHtml:
      emailP("Good day!") +
      emailP("This confirms that you, as <strong>" + escapeHtml(approverLabel) +
             "</strong>, have <strong>declined</strong> the following request.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([["Date of Action", nowFormatted()]]) +
      emailP("The requestor has been notified that this request is now closed and cannot be resubmitted."),
    buttonUrl:   getPortalUrl(requestId, "review"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(actioner, subject, body, html);
  Logger.log(`sendDeclineToApprover(): Confirmation sent to ${actioner}`);
}


// ============================================================
// EMAIL 3 — Notify requestor their request was declined
// AppSheet equivalent: Decline Bot → Process_NotifyDecline
// ============================================================
/*
  Function Name: sendDeclineToRequestor
  LAYMAN    : Email sa requestor: "Tinanggihan ang request mo." Kasama ang dahilan
              at sinabi na hindi na maaaring i-resubmit — bagong request na lang.
  TECHNICAL : TO: REQUESTOR column. Includes getLatestRemark (the decline reason).
              Links to the requestor's 'request' page (not 'review').
  FIRES     : handleDecline (on success).
*/
function sendDeclineToRequestor(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const actioner      = Session.getActiveUser().getEmail();
  const approverLabel = "Approver " + rowData[CR.STEP - 1];   // step is unchanged on decline
  const reason        = getLatestRemark(rowData);

  const subject = emailSubject(controlNumber, "Declined", "REQUESTOR");

  const body = `Good day!

We regret to inform you that your request has been declined.

${buildInfoBlock(rowData)}

Reason for Decline: ${reason}
Declined by: ${approverLabel} (${actioner})
Date: ${nowFormatted()}

Note: If you would like to try again, you must create a brand new request.
Open this request: ${getPortalUrl(requestId, "request")}`;

  // HTML twin — red accent; decline reason in a red callout box.
  const html = emailLayout({
    accent:   "red",
    bodyHtml:
      emailP("Good day!") +
      emailP("We regret to inform you that your request has been <strong>declined</strong>.") +
      emailInfoTable(rowData) +
      emailRemarkBox("Reason for Decline", reason, "red") +
      emailKeyValueRows([
        ["Declined by", approverLabel + " (" + actioner + ")"],
        ["Date",        nowFormatted()],
      ]) +
      emailP("Note: If you would like to try again, you must create a brand new request."),
    buttonUrl:   getPortalUrl(requestId, "request"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(requestor, subject, body, html);
  Logger.log(`sendDeclineToRequestor(): Decline email sent to ${requestor}`);
}


// ============================================================
// EMAIL 4 — Confirm full approval to the last approver
// AppSheet equivalent: Fully Approved Bot → Step_Final_Receipt_To_Approver
// ============================================================
/*
  Function Name: sendFullyApprovedToApprover
  LAYMAN    : Resibo sa huling approver: "Fully approved na, salamat sa pag-sign."
  TECHNICAL : TO: last configured approver slot (approver3 → 2 → 1 fallback).
              Uses the last non-empty AppN_DATE for "Final Approval Date".
  FIRES     : handleApprove (final step, newStatus === APPROVED).
*/
function sendFullyApprovedToApprover(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];

  // Send to the last configured approver
  const recipient = approvers.approver3
    || approvers.approver2
    || approvers.approver1;
  if (!recipient) return;

  // Get the last approval date from the timeline (latest approved step).
  const _view = getApprovalView(requestId);
  const lastDate = (_view.byStep[3] && _view.byStep[3].date)
    || (_view.byStep[2] && _view.byStep[2].date)
    || (_view.byStep[1] && _view.byStep[1].date);

  const subject = emailSubject(controlNumber, "Fully Approved", "APPROVER");

  const body = `Good day!

This confirms that you provided the final approval for the following request.

${buildInfoBlock(rowData)}

Final Approval Date: ${formatPHTime(new Date(lastDate))}

The request is now fully approved and the requestor has been notified. Thank you!
Open this request: ${getPortalUrl(requestId, "review")}`;

  // HTML twin — green accent (final approval receipt).
  const html = emailLayout({
    accent:   "green",
    bodyHtml:
      emailP("Good day!") +
      emailP("This confirms that you provided the <strong>final approval</strong> for the following request.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([["Final Approval Date", formatPHTime(new Date(lastDate))]]) +
      emailP("The request is now fully approved and the requestor has been notified. Thank you!"),
    buttonUrl:   getPortalUrl(requestId, "review"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(recipient, subject, body, html);
  Logger.log(`sendFullyApprovedToApprover(): Confirmation sent to ${recipient}`);
}


// ============================================================
// EMAIL 5 — Notify requestor their request is fully approved
// AppSheet equivalent: Fully Approved Bot → Process_Notify_Success
// ============================================================
/*
  Function Name: sendFullyApprovedToRequestor
  LAYMAN    : Email sa requestor: "Approved na lahat!" Kasama ang buong approval
              log (sino nag-sign at kailan) AT ang naka-attach na COC PDF. Dito na
              awtomatikong ginagawa ang Certificate of Completion — gagawa ng PDF
              at ikakabit sa email na ito.
  TECHNICAL : TO: REQUESTOR column. Calls generateCOC(requestId) (Certificate.js)
              and attaches the returned pdfBlob. COC generation is wrapped so a
              failure never blocks the approval email — it gracefully falls back to
              "provided separately". Includes buildApprovalLog; links to the
              requestor 'request' page.
  FIRES     : handleApprove (final step, newStatus === APPROVED); also the
              onSheetChange trigger on a manual "Fully Approved" sheet edit. Only
              one path runs per approval, so the COC is generated exactly once.

  STEPS
    Step 1 — Load request data
      Layman    : Kunin ang datos ng request; kung wala, huminto.
      Technical : getRequestData(requestId) (31-col read) → { rowData, approvers }.
    Step 2 — Generate the COC PDF (defensive)
      Layman    : Gawin ang COC PDF. Kung pumalpak, huwag i-block ang email.
      Technical : try/catch generateCOC; keep pdfBlob on success, else log + null.
    Step 3 — Compose + send (attach if available)
      Layman    : Buuin ang email (text + branded HTML); ikabit ang PDF kung
                  meron; ipadala.
      Technical : conditional body line + sendBrandedEmail(...) passing
                  { attachments:[cocBlob] } as extraOptions when present.
*/
function sendFullyApprovedToRequestor(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const approvalLog   = buildApprovalLog(rowData, approvers);

  // Generate the COC PDF — a COC failure must NOT block the approval email.
  let cocBlob = null;
  try {
    const coc = generateCOC(requestId);
    if (coc && coc.success) cocBlob = coc.pdfBlob;
    else Logger.log(`sendFullyApprovedToRequestor(): COC generation failed — ${coc && coc.error}`);
  } catch (e) {
    Logger.log(`sendFullyApprovedToRequestor(): COC generation threw — ${e}`);
  }

  const cocLine = cocBlob
    ? "Your Certificate of Completion (PDF) is attached to this email."
    : "Your Certificate of Completion will be provided separately.";

  const subject = emailSubject(controlNumber, "Approved", "REQUESTOR");

  const body = `Good day!

Great news — your request has been fully approved.

${buildInfoBlock(rowData)}

Final Signatory Log:
${approvalLog}

${cocLine} Thank you for using the E-Certificate portal!
Open this request: ${getPortalUrl(requestId, "request")}`;

  // HTML twin — green accent (the good-news email); COC note in a green box.
  const html = emailLayout({
    accent:   "green",
    bodyHtml:
      emailP("Good day!") +
      emailP("Great news &mdash; your request has been <strong>fully approved</strong>.") +
      emailInfoTable(rowData) +
      emailSection("Final Signatory Log", emailApprovalLog(rowData, approvers)) +
      emailRemarkBox(null, cocLine, "green") +
      emailP("Thank you for using the E-Certificate portal!"),
    buttonUrl:   getPortalUrl(requestId, "request"),
    buttonLabel: "Open this request",
  });

  // PDF attachment rides in extraOptions — same single-send, same blob.
  sendBrandedEmail(requestor, subject, body, html, cocBlob ? { attachments: [cocBlob] } : null);
  Logger.log(`sendFullyApprovedToRequestor(): Approval email sent to ${requestor}${cocBlob ? " (COC attached)" : " (no COC)"}`);
}


// ============================================================
// EMAIL 5b — Contract-expiry renewal reminder to requestor (#10)
// No AppSheet equivalent — new with the expiry-notification feature.
// ============================================================
/*
  Function Name: sendExpiryReminderToRequestor

  LAYMAN (Tropang Ex):
  Paalala sa requestor na malapit nang (o lumipas na) mag-expire ang contract ng
  isang fully-approved na COC — para may panahon silang mag-renew. Dalawang beses
  lang ito pinapadala kada request: isa pag 3 araw na lang, isa pag araw na mismo
  (o lumipas na kung na-miss ang 8am run). Requestor lang ang tumatanggap.

  TECHNICAL:
  Fired by checkContractExpiries() (Triggers.js) only — not frontend-callable.
  TO: REQUESTOR. Reuses emailSubject / buildInfoBlock / getPortalUrl, so it
  inherits the EMAIL_DEV_TAG audience prefix and the standard body shape. The
  subject label + lead line vary by daysUntil. No attachment (this is a nudge,
  not a certificate). Idempotency lives in the caller (Activity_Log flags), not
  here — this function just sends.

  PARAMS:
  - requestId — the COC request to remind about.
  - daysUntil — whole days to contract end (from daysUntilContractEnd):
                >0 = "Expiring Soon", 0 = "Expires Today", <0 = "Expired".

  RETURNS:
  (void). No-op if the request row can't be loaded.

  EXAMPLE
    sendExpiryReminderToRequestor("REQ-9b1", 3)   // "…| Expiring Soon", "in 3 days"
    sendExpiryReminderToRequestor("REQ-9b1", 0)   // "…| Expires Today"
    sendExpiryReminderToRequestor("REQ-9b1", -3)  // "…| Expired", "3 days ago"
*/
function sendExpiryReminderToRequestor(requestId, daysUntil) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const endRaw        = rowData[CR.CONTRACT_END - 1];
  const endStr        = endRaw
    ? Utilities.formatDate(new Date(endRaw), "Asia/Manila", "MMMM dd, yyyy")
    : "(not set)";

  // Subject label + the one-line lead, both driven by the day delta.
  const label = daysUntil > 0 ? "Expiring Soon"
              : daysUntil === 0 ? "Expires Today"
              : "Expired";
  const lead  = daysUntil > 1  ? `The contract for this certificate expires in ${daysUntil} days.`
              : daysUntil === 1 ? "The contract for this certificate expires tomorrow."
              : daysUntil === 0 ? "The contract for this certificate expires today."
              : daysUntil === -1 ? "The contract for this certificate expired yesterday."
              : `The contract for this certificate expired ${Math.abs(daysUntil)} days ago.`;

  const subject = emailSubject(controlNumber, label, "REQUESTOR");

  const body = `Good day!

${lead} If this contract is being renewed, please file a new e-certificate request for the renewed term.

${buildInfoBlock(rowData)}
Contract End Date: ${endStr}

Open this request: ${getPortalUrl(requestId, "request")}`;

  // HTML twin — amber accent for all 3 stages (warning class); the stage-
  // specific lead line goes in an amber box so the deadline can't be missed.
  const html = emailLayout({
    accent:   "amber",
    bodyHtml:
      emailP("Good day!") +
      emailRemarkBox(label, lead, "amber") +
      emailP("If this contract is being renewed, please file a new e-certificate request for the renewed term.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([["Contract End Date", endStr]]),
    buttonUrl:   getPortalUrl(requestId, "request"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(requestor, subject, body, html);
  Logger.log(`sendExpiryReminderToRequestor(): ${label} reminder sent to ${requestor} for ${controlNumber} (daysUntil=${daysUntil}).`);
}


// ============================================================
// EMAIL 14 — Daily nudge to a pending approver (digest)
// Fired by checkPendingApprovals() in Triggers.js, once per approver
// per daily sweep. NOT an event email — there is no handle* caller.
// ============================================================
/*
  Function Name: sendPendingApprovalReminder

  LAYMAN (Tropang Ex):
  Araw-araw na paalala sa isang approver: "May hinihintay pa pala sa'yo." Imbes na
  isa-isang email kada request, pinagsama-sama lahat ng nakabinbin niya sa ISANG
  email. Pero kompleto pa rin ang detalye kada request — title, ID, requestor, group,
  supporting documents, at approval progress — kapareho ng normal na "needs your
  approval" email, plus link na diretso sa review page. Para hindi na malunod sa
  inbox, ito yung pang-gising kada umaga hangga't may pending pa.

  TECHNICAL:
  Digest sender. Receives the approver email + the list of pending request rows
  already bucketed for them by checkPendingApprovals (so this function does no
  filtering/auth — that's the caller's job). For EACH request it renders the same
  full detail block as sendApprovalRequest — buildInfoBlock + buildAttachmentList +
  buildApprovalLog(rowData, getApprovers(group)) + getPortalUrl(id, "review") — and
  joins multiple requests with a divider. Reuses emailSubject so it inherits the
  EMAIL_DEV_TAG audience prefix. Singular/plural wording adapts to count.

  PARAMS:
  - approverEmail — recipient (the current approver). No-op if blank.
  - requestRows  — array of 0-indexed Requests rows (CR.* indexing). No-op if empty.

  RETURNS:
  (void). No-op when approverEmail is falsy or requestRows is empty.

  STEPS
    Step 1 — Render a full detail block per request
      Layman    : Bawat pending → kompletong detalye (parang normal approval email).
      Technical : map over requestRows; buildInfoBlock + buildAttachmentList +
                  buildApprovalLog(rowData, getApprovers(group)) + review deep-link.
                  Join blocks with a divider when there's more than one.
    Step 2 — Subject + intro, then send
      Layman    : Bilangin ilan, gawing pang-isahan/maramihan, ipadala.
      Technical : emailSubject("Reminder", "N Pending Approval(s)", "APPROVER");
                  sendBrandedEmail (text + HTML digest); log the count.

  EXAMPLE
    sendPendingApprovalReminder("boss@corp.com", [rowA, rowB])
    → "[COC Request]: Reminder | 2 Pending Approvals", two full detail blocks, divided.
    sendPendingApprovalReminder("boss@corp.com", [rowA])
    → "…| 1 Pending Approval" (singular wording, one detail block).
*/
function sendPendingApprovalReminder(approverEmail, requestRows) {
  if (!approverEmail || !requestRows || !requestRows.length) return;

  const blocks = requestRows.map(function (row) {
    const requestId = row[CR.REQUEST_ID - 1];
    const approvers = getApprovers(row[CR.GROUP - 1]);
    return `${buildInfoBlock(row)}

Supporting Documents:
${buildAttachmentList(requestId)}

Approval Progress:
${buildApprovalLog(row, approvers)}

Open this request: ${getPortalUrl(requestId, "review")}`;
  }).join("\n\n————————————————————\n\n");

  const n       = requestRows.length;
  const subject = emailSubject("Reminder", n + " Pending Approval" + (n > 1 ? "s" : ""), "APPROVER");

  const body = `Good day!

This is a daily reminder that the following e-certificate request${n > 1 ? "s are" : " is"} awaiting your review and action:

${blocks}

Please review and act on ${n > 1 ? "each" : "the"} request in the portal. Thank you!`;

  // HTML twin — one emailRequestBlock-style section per pending request,
  // joined by dividers. ~2-3KB per block keeps even 20+ requests well under
  // Gmail's 102KB clipping threshold.
  const htmlBlocks = requestRows.map(function (row) {
    const requestId = row[CR.REQUEST_ID - 1];
    const approvers = getApprovers(row[CR.GROUP - 1]);
    return emailInfoTable(row) +
      emailSection("Supporting Documents", emailAttachmentList(requestId)) +
      emailSection("Approval Progress", emailApprovalLog(row, approvers)) +
      emailButton(getPortalUrl(requestId, "review"), "Review this request");
  }).join(emailDivider());

  const html = emailLayout({
    accent:   "navy", // action needed
    bodyHtml:
      emailP("Good day!") +
      emailP("This is a daily reminder that the following e-certificate request" +
             (n > 1 ? "s are" : " is") + " <strong>awaiting your review and action</strong>:") +
      htmlBlocks +
      emailP("Please review and act on " + (n > 1 ? "each" : "the") + " request in the portal. Thank you!"),
    // No layout-level button — each block carries its own review button.
  });

  sendBrandedEmail(approverEmail, subject, body, html);
  Logger.log("sendPendingApprovalReminder(): " + n + " request(s) -> " + approverEmail);
}


// ============================================================
// EMAIL 5b — Notify a newly-added approver of a group's chain
// Fired by adminSaveChain when an admin adds someone to a chain.
// ============================================================
/*
  Function Name: sendNewApproverNotice

  LAYMAN (Tropang Ex):
  Pag idinagdag ka ng admin bilang approver ng isang group, padadalhan ka kaagad
  ng email: "ikaw na ngayon ang approver ng [group]." Hindi mo na hihintayin ang
  8am digest. Kung may mga request na agad na naghihintay sa'yo dahil sa pagbabago,
  nakalista na rin sila dito, kompleto ang detalye + link sa review page — para
  makaaksyon ka na agad. Kung wala pa namang naghihintay, sasabihin lang na
  aabisuhan ka pagdating ng mga request.

  TECHNICAL:
  One-shot assignment notice. Receives the recipient's email, the group's
  display name, the recipient's sequence in the NEW chain (for the explicit
  "You are Approver N" line), and (already filtered by the caller) the pending
  request rows that NEWLY current-await this person. For each pending row it
  renders the same full detail block as sendPendingApprovalReminder
  (buildInfoBlock + buildAttachmentList + buildApprovalLog + review deep-link).
  Reuses emailSubject so it inherits the EMAIL_DEV_TAG audience prefix. The ONLY
  email an admin action sends — recipients are computed by notifyChainChanges_
  (newly in the chain OR newly the current handler of an in-flight request).

  PARAMS:
  - approverEmail — recipient. No-op if blank.
  - groupName     — the group's display name, for the assignment line.
  - approverStep  — recipient's sequence in the NEW chain (1/2/3); blank → role line omitted.
  - previousStep  — recipient's sequence BEFORE the change (1/2/3), or null/blank if
                    they were NOT in the chain before. Drives the wording: blank →
                    "added"; different from approverStep → "you were Approver M, now N".
  - pendingRows   — 0-indexed Requests rows now awaiting this person (may be empty).

  RETURNS:
  (void). No-op when approverEmail is falsy.

  STEPS
    Step 1 — Render any immediately-inherited pending requests
      Layman    : Kung may agad na naghihintay, gawing kompletong detalye + link.
      Technical : map pendingRows → buildInfoBlock + buildAttachmentList +
                  buildApprovalLog(row, getApprovers(group)) + review deep-link.
    Step 2 — Compose the lead line (added vs role-changed), append pending, send
      Layman    : Bago → "You have been added… Approver N." Reorder → "You were
                  Approver M, now Approver N." Idugtong ang listahan kung meron.
      Technical : branch on previousStep; emailSubject suffix "Added as Approver"
                  vs "Approver Role Changed"; sendBrandedEmail (text + HTML).

  EXAMPLE
    sendNewApproverNotice("boss@corp.com", "Engineering", 1, null, [rowA])
    → "…| Added as Approver"; "added… Your role: Approver 1"; one detail block.
    sendNewApproverNotice("boss@corp.com", "Engineering", 1, 2, [rowA])
    → "…| Approver Role Changed"; "You were Approver 2; you are now Approver 1."; block.
*/
function sendNewApproverNotice(approverEmail, groupName, approverStep, previousStep, pendingRows) {
  if (!approverEmail) return;
  const rows = pendingRows || [];

  let pendingSection = "";
  if (rows.length) {
    const blocks = rows.map(function (row) {
      const requestId = row[CR.REQUEST_ID - 1];
      const approvers = getApprovers(row[CR.GROUP - 1]);
      return `${buildInfoBlock(row)}

Supporting Documents:
${buildAttachmentList(requestId)}

Approval Progress:
${buildApprovalLog(row, approvers)}

Open this request: ${getPortalUrl(requestId, "review")}`;
    }).join("\n\n————————————————————\n\n");

    const n = rows.length;
    pendingSection = `

The following request${n > 1 ? "s are" : " is"} already awaiting your review and action:

${blocks}

Please review and act on ${n > 1 ? "each" : "the"} request in the portal.`;
  } else {
    pendingSection = `

You'll be notified as requests are routed to you for approval.`;
  }

  // Lead line + subject depend on whether this is a fresh add or a role change (reorder).
  let lead, statusLabel;
  if (!previousStep) {
    statusLabel = "Added as Approver";
    lead = `You have been added as an approver for the group: ${groupName}.` +
           (approverStep ? `\nYour role: Approver ${approverStep} in this group.` : "");
  } else if (previousStep !== approverStep) {
    statusLabel = "Approver Role Changed";
    lead = `Your approver role for the group "${groupName}" has changed.\n` +
           `You were Approver ${previousStep}; you are now Approver ${approverStep}.`;
  } else {
    statusLabel = "Approver Role Changed";
    lead = `You are now the current approver for the group "${groupName}" (Approver ${approverStep}).`;
  }

  const subject = emailSubject("Approver Assignment", statusLabel, "APPROVER");

  const body = `Good day!

${lead}${pendingSection}

Thank you!`;

  // HTML twin — navy accent (assignment/role notice). Lead is rebuilt as HTML
  // (the text `lead` embeds \n breaks); pending requests render as full blocks.
  let leadHtml;
  if (!previousStep) {
    leadHtml = emailP("You have been <strong>added as an approver</strong> for the group: <strong>" +
                 escapeHtml(groupName) + "</strong>.") +
               (approverStep ? emailP("Your role: <strong>Approver " + escapeHtml(approverStep) + "</strong> in this group.") : "");
  } else if (previousStep !== approverStep) {
    leadHtml = emailP("Your approver role for the group &quot;" + escapeHtml(groupName) + "&quot; has <strong>changed</strong>.") +
               emailP("You were Approver " + escapeHtml(previousStep) +
                      "; you are now <strong>Approver " + escapeHtml(approverStep) + "</strong>.");
  } else {
    leadHtml = emailP("You are now the <strong>current approver</strong> for the group &quot;" +
                 escapeHtml(groupName) + "&quot; (Approver " + escapeHtml(approverStep) + ").");
  }

  let pendingHtml;
  if (rows.length) {
    const n = rows.length;
    pendingHtml =
      emailP("The following request" + (n > 1 ? "s are" : " is") +
             " <strong>already awaiting your review and action</strong>:") +
      rows.map(function (row) {
        const requestId = row[CR.REQUEST_ID - 1];
        const approvers = getApprovers(row[CR.GROUP - 1]);
        return emailInfoTable(row) +
          emailSection("Supporting Documents", emailAttachmentList(requestId)) +
          emailSection("Approval Progress", emailApprovalLog(row, approvers)) +
          emailButton(getPortalUrl(requestId, "review"), "Review this request");
      }).join(emailDivider()) +
      emailP("Please review and act on " + (n > 1 ? "each" : "the") + " request in the portal.");
  } else {
    pendingHtml = emailP("You'll be notified as requests are routed to you for approval.");
  }

  const html = emailLayout({
    accent:   "navy",
    bodyHtml: emailP("Good day!") + leadHtml + pendingHtml + emailP("Thank you!"),
  });

  sendBrandedEmail(approverEmail, subject, body, html);
  Logger.log("sendNewApproverNotice(): " + groupName + " -> " + approverEmail +
             " (step " + (previousStep || "-") + "→" + (approverStep || "?") + ", " + rows.length + " pending)");
}


// ============================================================
// EMAIL 6 — Notify requestor their request was returned
// AppSheet equivalent: Return Bot → Process_NotifyReturn
// ============================================================
/*
  Function Name: sendReturnToRequestor
  LAYMAN    : Email sa requestor: "Ibinalik ang request mo — may baguhin pa."
              Kasama kung sino ang nagbalik (e.g. "Approver 2") at ang dahilan.
  TECHNICAL : TO: REQUESTOR. approverLabel param (captured in handleReturn before
              state is cleared) appears as "Approver N (email)" in the body.
  PARAMS    : requestId; approverLabel — e.g. "Approver 2" (optional, from handleReturn).
  FIRES     : handleReturn (on success).
*/
function sendReturnToRequestor(requestId, approverLabel) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const actioner      = Session.getActiveUser().getEmail();
  const reason        = getLatestRemark(rowData);
  const returnerLine  = approverLabel ? `${approverLabel} (${actioner})` : actioner;

  const subject = emailSubject(controlNumber, "Returned", "REQUESTOR");

  const body = `Good day!

Your request has been sent back to you for updates.

${buildInfoBlock(rowData)}

Returned by: ${returnerLine}
Return Date: ${nowFormatted()}
Reason for Return: ${reason}

Please review the comments, make the necessary changes, and resubmit your request.
Open this request: ${getPortalUrl(requestId, "request")}`;

  // HTML twin — amber accent; return reason in an amber callout box.
  const html = emailLayout({
    accent:   "amber",
    bodyHtml:
      emailP("Good day!") +
      emailP("Your request has been <strong>sent back to you for updates</strong>.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([
        ["Returned by", returnerLine],
        ["Return Date", nowFormatted()],
      ]) +
      emailRemarkBox("Reason for Return", reason, "amber") +
      emailP("Please review the comments, make the necessary changes, and resubmit your request."),
    buttonUrl:   getPortalUrl(requestId, "request"),
    buttonLabel: "Update and resubmit",
  });

  sendBrandedEmail(requestor, subject, body, html);
  Logger.log(`sendReturnToRequestor(): Return email sent to ${requestor}`);
}


// ============================================================
// EMAIL 7 — Confirm return to the approver who returned it
// AppSheet equivalent: Return Bot → Confirm_Return_To_Approver
// ============================================================
/*
  Function Name: sendReturnConfirmToApprover
  LAYMAN    : Resibo sa approver na nagbalik: "Naipadala na sa requestor ang
              pagbabalik." Kasama kung sino ang requestor at kailan.
  TECHNICAL : TO: Session.getActiveUser() (the returner). approverLabel in role note.
  PARAMS    : requestId; approverLabel — e.g. "Approver 2" (optional).
  FIRES     : handleReturn (on success).
*/
function sendReturnConfirmToApprover(requestId, approverLabel) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const actioner      = Session.getActiveUser().getEmail();
  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const roleNote      = approverLabel ? ` as ${approverLabel}` : "";

  const subject = emailSubject(controlNumber, "Returned", "APPROVER");

  const body = `Good day!

This confirms that you have returned the following request${roleNote} for further updates.

${buildInfoBlock(rowData)}

Returned to: ${requestor}
Date of Action: ${nowFormatted()}

The requestor has been notified to review your comments and take the necessary next steps.
Open this request: ${getPortalUrl(requestId, "review")}`;

  // HTML twin — amber accent (return receipt).
  const html = emailLayout({
    accent:   "amber",
    bodyHtml:
      emailP("Good day!") +
      emailP("This confirms that you have <strong>returned</strong> the following request" +
             escapeHtml(roleNote) + " for further updates.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([
        ["Returned to",    requestor],
        ["Date of Action", nowFormatted()],
      ]) +
      emailP("The requestor has been notified to review your comments and take the necessary next steps."),
    buttonUrl:   getPortalUrl(requestId, "review"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(actioner, subject, body, html);
  Logger.log(`sendReturnConfirmToApprover(): Confirmation sent to ${actioner}`);
}


// ============================================================
// EMAIL 8 — Confirm intermediate approval to the approver who just approved
// Closes the symmetry gap: decline/return both confirm to actioner; now approve does too.
// Only fires on intermediate steps — final approval uses sendFullyApprovedToApprover.
// ============================================================
/*
  Function Name: sendApproveConfirmToApprover
  LAYMAN    : Resibo sa approver na na-approve ng intermediate step: "Nai-approve
              mo, forwarded na sa next approver." Tinapos ang asymmetry — decline
              at return ay may confirm, dapat approve din.
  TECHNICAL : TO: Session.getActiveUser() (the actioner). Symmetric twin of
              sendDeclineToApprover/sendReturnConfirmToApprover.
  NOTE      : Only fires on INTERMEDIATE approvals. Final step uses
              sendFullyApprovedToApprover instead.
  FIRES     : handleApprove (intermediate step only, in the else branch).
*/
function sendApproveConfirmToApprover(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const actioner      = Session.getActiveUser().getEmail();
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];

  const subject = emailSubject(controlNumber, "Approved", "APPROVER");

  const body = `Good day!

This confirms that you have approved the following request.

${buildInfoBlock(rowData)}

Date of Action: ${nowFormatted()}

The request has been forwarded to the next approver. You will be notified once the full process is complete.
Open this request: ${getPortalUrl(requestId, "review")}`;

  // HTML twin — green accent (approval receipt).
  const html = emailLayout({
    accent:   "green",
    bodyHtml:
      emailP("Good day!") +
      emailP("This confirms that you have <strong>approved</strong> the following request.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([["Date of Action", nowFormatted()]]) +
      emailP("The request has been forwarded to the next approver. You will be notified once the full process is complete."),
    buttonUrl:   getPortalUrl(requestId, "review"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(actioner, subject, body, html);
  Logger.log(`sendApproveConfirmToApprover(): Confirmation sent to ${actioner}`);
}


// ============================================================
// EMAIL 9 — Notify requestor of progress after each intermediate approval
// Fires on each intermediate step so the requestor isn't left in the dark mid-chain.
// N/M count uses AppN_DATE columns + configured approver slots (not Step number)
// because approve() skips blank slots — counting dates is gap-proof.
// ============================================================
/*
  Function Name: sendProgressUpdateToRequestor
  LAYMAN    : Mid-chain progress email sa requestor: "Cleared mo na N of M steps."
              Para hindi sila naghihintay sa dilim kung ilang approver pa kailangan.
  TECHNICAL : TO: REQUESTOR. N = count of non-empty APP dates; M = count of
              non-null approver slots (gap-proof; Step count would be wrong if
              approver slots are skipped). Includes buildApprovalLog.
  NOTE      : Only fires on INTERMEDIATE approvals — not final (that sends #4+#5).
  FIRES     : handleApprove (intermediate step only, in the else branch).
*/
function sendProgressUpdateToRequestor(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const approvalLog   = buildApprovalLog(rowData, approvers);

  const completed = getApprovalView(requestId).approvedCount;  // approvals this cycle (from timeline)
  const total = [approvers.approver1, approvers.approver2, approvers.approver3]
    .filter(function (a) { return !!a; }).length;

  const subject = emailSubject(controlNumber, "Update", "REQUESTOR");

  const body = `Good day!

Good news — your request has cleared ${completed} of ${total} approval steps and is now awaiting the next approver.

${buildInfoBlock(rowData)}

Approval Progress So Far:
${approvalLog}

You will be notified once the remaining steps are complete. Thank you for your patience.

${REQUESTOR_PORTAL_NOTE}
Open this request: ${getPortalUrl(requestId, "request")}`;

  // HTML twin — navy accent (informational progress, no action needed).
  const html = emailLayout({
    accent:   "navy",
    bodyHtml:
      emailP("Good day!") +
      emailP("Good news &mdash; your request has cleared <strong>" + completed + " of " + total +
             "</strong> approval steps and is now awaiting the next approver.") +
      emailInfoTable(rowData) +
      emailSection("Approval Progress So Far", emailApprovalLog(rowData, approvers)) +
      emailP("You will be notified once the remaining steps are complete. Thank you for your patience.") +
      emailRemarkBox(null, REQUESTOR_PORTAL_NOTE, "blue"),
    buttonUrl:   getPortalUrl(requestId, "request"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(requestor, subject, body, html);
  Logger.log(`sendProgressUpdateToRequestor(): Progress email sent to ${requestor} (${completed}/${total})`);
}


// ============================================================
// EMAIL 10 — Notify prior approvers when a request they approved gets returned
// Takes previousApprovals + reason as params — getRequestData() only reads 31 cols
// and Previous_Approvals lives in col 34 (AH). The array is already built in
// handleReturn's scope and is guaranteed fresh when passed here.
// Empty array (Approver 1 returned before anyone else approved) → no-op.
// The returner is never in previousApprovals so there is no double-send risk.
// ============================================================
/*
  Function Name: sendReturnedChainNotification
  LAYMAN    : Email sa mga DATING approver na nag-approve noon, para ipaalam
              na ibinalik ang request na dati nilang pinirmahan — at kapag
              na-resubmit, kailangan nila ulit mag-approve. Kapag walang dating
              approver (e.g. Approver 1 agad nagbalik), walang pinapadala.
  TECHNICAL : TO: each entry.email in previousApprovals (BCC-style loop, one
              send per recipient). previousApprovals is passed from handleReturn
              (NOT from getRequestData — col 34 is out of the 31-col read range).
              The returner is never in the array → no double-send risk.
  PARAMS    : requestId; previousApprovals — [{step,email,date}]; reason — return
              reason; approverLabel — e.g. "Approver 2".
  FIRES     : handleReturn (on success).
*/
function sendReturnedChainNotification(requestId, previousApprovals, reason, approverLabel) {
  if (!previousApprovals || previousApprovals.length === 0) return;

  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const returnerLine  = approverLabel || "a later approver";

  const subject = emailSubject(controlNumber, "Returned", "APPROVER");

  const body = `Good day!

A request you had previously approved has been returned to the requestor for further updates.

${buildInfoBlock(rowData)}

Returned by: ${returnerLine}
Reason for Return: ${reason || "No reason provided."}
Date: ${nowFormatted()}

When the requestor resubmits, the request will route through the full approval chain again and will require your approval once more. You will receive a new action request at that time.
Open this request: ${getPortalUrl(requestId, "review")}`;

  // HTML twin — built ONCE before the loop (same body for every prior approver).
  const html = emailLayout({
    accent:   "amber",
    bodyHtml:
      emailP("Good day!") +
      emailP("A request you had previously approved has been <strong>returned to the requestor</strong> for further updates.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([
        ["Returned by", returnerLine],
        ["Date",        nowFormatted()],
      ]) +
      emailRemarkBox("Reason for Return", reason || "No reason provided.", "amber") +
      emailP("When the requestor resubmits, the request will route through the full approval chain again and will require your approval once more. You will receive a new action request at that time."),
    buttonUrl:   getPortalUrl(requestId, "review"),
    buttonLabel: "Open this request",
  });

  previousApprovals.forEach(function (entry) {
    if (!entry.email) return;
    sendBrandedEmail(entry.email, subject, body, html);
    Logger.log(`sendReturnedChainNotification(): Notified prior approver ${entry.email} for ${requestId}`);
  });
}


// ============================================================
// EMAIL 11 — Confirm resubmission to the requestor
// Fires when a requestor resubmits a returned request.
// returnReason + resubmitCount are passed from handleResubmit —
// captured BEFORE resubmit() clears the remark columns.
// ============================================================
/*
  Function Name: sendResubmitConfirmToRequestor
  LAYMAN    : Resibo sa requestor: "Na-resubmit na, naghihintay na sa Approver 1."
              Kasama ang dating dahilan ng pagbabalik para reference.
  TECHNICAL : TO: REQUESTOR. resubmitCount > 1 adds "(Resubmission #N)" to subject.
              returnReason and resubmitCount MUST be captured before resubmit()
              clears the remark columns.
  PARAMS    : requestId; returnReason — the prior return reason; resubmitCount — new count.
  FIRES     : handleResubmit (on success).
*/
function sendResubmitConfirmToRequestor(requestId, returnReason, resubmitCount) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  // Always show which resubmission this is (1st, 2nd, …) — clearer for non-devs.
  const countNote     = ` (Resubmission #${resubmitCount})`;

  const subject = emailSubject(controlNumber, "Resubmitted", "REQUESTOR");

  const body = `Good day!

Your request has been successfully resubmitted${countNote} and is now awaiting Approver 1.

${buildInfoBlock(rowData)}

Resubmitted on: ${nowFormatted()}
Previous Return Reason: ${returnReason || "No reason provided."}

You will be notified as the request progresses through the approval chain.

${REQUESTOR_PORTAL_NOTE}
Open this request: ${getPortalUrl(requestId, "request")}`;

  // HTML twin — navy accent (receipt/informational).
  const html = emailLayout({
    accent:   "navy",
    bodyHtml:
      emailP("Good day!") +
      emailP("Your request has been successfully <strong>resubmitted" + escapeHtml(countNote) +
             "</strong> and is now awaiting Approver 1.") +
      emailInfoTable(rowData) +
      emailKeyValueRows([["Resubmitted on", nowFormatted()]]) +
      emailRemarkBox("Previous Return Reason", returnReason || "No reason provided.", "amber") +
      emailP("You will be notified as the request progresses through the approval chain.") +
      emailRemarkBox(null, REQUESTOR_PORTAL_NOTE, "blue"),
    buttonUrl:   getPortalUrl(requestId, "request"),
    buttonLabel: "Open this request",
  });

  sendBrandedEmail(requestor, subject, body, html);
  Logger.log(`sendResubmitConfirmToRequestor(): Confirmation sent to ${requestor}`);
}


// ============================================================
// EMAIL 12 — Notify Approver 1 of a resubmitted request
// Replaces the generic sendApprovalRequest when a request is
// resubmitted (not first-time submitted). Explicitly surfaces
// the resubmit context and the original return reason so the
// approver knows what was supposedly fixed.
// returnReason + resubmitCount captured before resubmit() clears remarks.
// ============================================================
/*
  Function Name: sendResubmitApprovalRequest
  LAYMAN    : Email sa Approver 1: "Ito ay RESUBMISSION — ito ang dating dahilan
              ng pagbabalik, paki-review kung na-ayos na." Mas informative kaysa
              sa generic #1 sendApprovalRequest, para alam ng approver ang context.
  TECHNICAL : TO: getCurrentApprover(step, group) — always Approver 1 after resubmit.
              countNote adds "#N" to the subject if resubmitCount > 1. Includes
              the prior returnReason prominently in the body.
  PARAMS    : requestId; returnReason — prior return reason; resubmitCount — new count.
  NOTE      : Only fires if newStatus === PENDING_1. If SYNCING (attachments needed),
              this email is deferred until checkAttachmentSync fires #1 instead.
  FIRES     : handleResubmit (on success AND newStatus === PENDING_1).
*/
function sendResubmitApprovalRequest(requestId, returnReason, resubmitCount) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const step            = rowData[CR.STEP - 1];
  const currentApprover = getCurrentApprover(step, rowData[CR.GROUP - 1]);
  if (!currentApprover) return;

  const controlNumber  = rowData[CR.CONTROL_NUMBER - 1];
  const attachmentList = buildAttachmentList(requestId);
  const countNote      = ` #${resubmitCount}`;   // always show which resubmission (1st, 2nd, …)

  const subject = emailSubject(controlNumber, `Resubmission${countNote} — Action Needed`, "APPROVER");

  const body = `Good day!

A previously returned request has been resubmitted${countNote} and requires your review.

${buildInfoBlock(rowData)}

Previous Return Reason: ${returnReason || "No reason provided."}

Supporting Documents:
${attachmentList}

Please review the updates made by the requestor and act on this request (approve, decline, or return).
Open this request: ${getPortalUrl(requestId, "review")}`;

  // HTML twin — resubmission context up top, prior return reason in an amber box.
  const html = emailLayout({
    accent:   "navy", // action needed
    bodyHtml:
      emailP("Good day!") +
      emailP("A previously returned request has been <strong>resubmitted" + escapeHtml(countNote) +
             "</strong> and requires your review.") +
      emailInfoTable(rowData) +
      emailRemarkBox("Previous Return Reason", returnReason || "No reason provided.", "amber") +
      emailSection("Supporting Documents", emailAttachmentList(requestId)) +
      emailP("Please review the updates made by the requestor and act on this request (approve, decline, or return)."),
    buttonUrl:   getPortalUrl(requestId, "review"),
    buttonLabel: "Review this resubmission",
  });

  sendBrandedEmail(currentApprover, subject, body, html);
  Logger.log(`sendResubmitApprovalRequest(): Emailed ${currentApprover} for resubmission of ${requestId}`);
}
