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
  ng body + subject, at nagpapadala gamit ang GmailApp.

  TECHNICAL:
  12 send* functions (one per notification event) + 7 shared helpers. All
  called by the handle* functions in WebApp.js immediately after a successful
  state change. Identity for actioner-confirmation emails comes from
  Session.getActiveUser(); caller-independent data comes from getRequestData().

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
  EMAIL FUNCTIONS (12)
  #   Function                          To              Fires when
  1   sendApprovalRequest               next approver   submit + resubmit (SYNCING→PENDING)
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
*/


// TEMP DEV AID: while testing with a single account (requestor == approver),
// prefix every subject with [FOR APPROVER] / [FOR REQUESTOR] so the same inbox
// can tell them apart. Set to false for production — one-line toggle.
// ⚠️ FLIP TO FALSE BEFORE GO-LIVE
const EMAIL_DEV_TAG = true;


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

  GmailApp.sendEmail(currentApprover, subject, body);
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

  GmailApp.sendEmail(actioner, subject, body);
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

  GmailApp.sendEmail(requestor, subject, body);
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

  GmailApp.sendEmail(recipient, subject, body);
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
      Layman    : Buuin ang email; ikabit ang PDF kung meron; ipadala.
      Technical : conditional body line + 4-arg GmailApp.sendEmail with
                  { attachments:[cocBlob] } when present.
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

  const options = cocBlob ? { attachments: [cocBlob] } : {};
  GmailApp.sendEmail(requestor, subject, body, options);
  Logger.log(`sendFullyApprovedToRequestor(): Approval email sent to ${requestor}${cocBlob ? " (COC attached)" : " (no COC)"}`);
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

  GmailApp.sendEmail(requestor, subject, body);
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

  GmailApp.sendEmail(actioner, subject, body);
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

  GmailApp.sendEmail(actioner, subject, body);
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
Open this request: ${getPortalUrl(requestId, "request")}`;

  GmailApp.sendEmail(requestor, subject, body);
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

  previousApprovals.forEach(function (entry) {
    if (!entry.email) return;
    GmailApp.sendEmail(entry.email, subject, body);
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
Open this request: ${getPortalUrl(requestId, "request")}`;

  GmailApp.sendEmail(requestor, subject, body);
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

  GmailApp.sendEmail(currentApprover, subject, body);
  Logger.log(`sendResubmitApprovalRequest(): Emailed ${currentApprover} for resubmission of ${requestId}`);
}
