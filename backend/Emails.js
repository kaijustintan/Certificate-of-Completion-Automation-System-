// Emails.js
// ============================================================
// Emails.js
// All email notification functions.
// Replaces AppSheet's 5 bots and their email templates.
// AppSheet used <<[ColumnName]>> merge syntax.
// Here we use JavaScript template literals (backtick strings).
//
// Conventions (Cat 4 Round 2):
//   - Subjects: emailSubject(controlNumber, statusLabel, audience)
//     → "[COC Request]: <ctrl> | <Status>" (+ optional [FOR ...] dev tag)
//   - Bodies: greeting → buildInfoBlock() labeled fields → optional
//     sections → action line → portal deep-link (getPortalUrl).
// ============================================================


// TEMP DEV AID: while testing with a single account (requestor == approver),
// prefix every subject with [FOR APPROVER] / [FOR REQUESTOR] so the same inbox
// can tell them apart. Set to false for production — one-line toggle.
const EMAIL_DEV_TAG = true;


// Helper — standard minimal subject line.
// audience = 'APPROVER' | 'REQUESTOR'; statusLabel e.g. 'Action Needed', 'Approved'.
function emailSubject(controlNumber, statusLabel, audience) {
  const tag    = EMAIL_DEV_TAG ? `[FOR ${audience}] ` : "";
  const suffix = statusLabel ? ` | ${statusLabel}` : "";
  return `${tag}[COC Request]: ${controlNumber}${suffix}`;
}


// Helper — labeled request-info block shared by every email body.
// No fake colon-alignment: plain-text email uses proportional fonts,
// so "Label: value" per line is the cleanest scannable format.
function buildInfoBlock(rowData) {
  return [
    `E-Certificate Title: ${rowData[CR.PROJECT_TITLE - 1]}`,
    `E-Certificate ID: ${rowData[CR.CONTROL_NUMBER - 1]}`,
    `Requestor: ${rowData[CR.REQUESTOR - 1]}`,
    `Group: ${rowData[CR.GROUP - 1]}`,
  ].join("\n");
}


// Helper — per-request deep-link into the portal.
// Uses QUERY PARAMS (not hash): the Apps Script app runs in a sandboxed
// iframe, so hash fragments aren't readable by the client, but query params
// reach doGet() server-side and are forwarded to the page (see WebApp.doGet).
// page: 'request' (requestor view) | 'review' (approver view).
function getPortalUrl(requestId, page) {
  return `${ScriptApp.getService().getUrl()}?page=${page}&id=${encodeURIComponent(requestId)}`;
}


// Helper — builds the supporting documents list for email body
// Replaces AppSheet's <<Start: [Related Request_Attachments]>> loop
function buildAttachmentList(requestId) {
  const attachments = getAttachmentsForRequest(requestId);
  if (attachments.length === 0) return "No supporting documents uploaded.";
  return attachments
    .map(row => `- ${row[RA.DESCRIPTION - 1]} — ${row[RA.FILE_LINK - 1]}`)
    .join("\n");
}


// Helper — builds the approval progress log shown in emails
// Replaces AppSheet's <<If: ISNOTBLANK([App1_Date])>> blocks
function buildApprovalLog(rowData, approvers) {
  let log = "";
  if (rowData[CR.APP1_DATE - 1]) {
    log += `Approver 1: ${approvers.approver1 || "—"}\n`;
    log += `Approved: ${formatPHTime(new Date(rowData[CR.APP1_DATE - 1]))}\n\n`;
  }
  if (rowData[CR.APP2_DATE - 1]) {
    log += `Approver 2: ${approvers.approver2 || "—"}\n`;
    log += `Approved: ${formatPHTime(new Date(rowData[CR.APP2_DATE - 1]))}\n\n`;
  }
  if (rowData[CR.APP3_DATE - 1]) {
    log += `Approver 3: ${approvers.approver3 || "—"}\n`;
    log += `Approved: ${formatPHTime(new Date(rowData[CR.APP3_DATE - 1]))}\n\n`;
  }
  return log.trim() || "No approvals recorded yet.";
}


// Helper — gets the most recent non-blank remark from any approver
// Replaces AppSheet's IFS(ISNOTBLANK([App3's Remark]), ...) pattern
function getLatestRemark(rowData) {
  return rowData[CR.APP3_REMARK - 1]
    || rowData[CR.APP2_REMARK - 1]
    || rowData[CR.APP1_REMARK - 1]
    || "No reason provided.";
}


// Helper — loads a full request row as a flat object for easy reference
function getRequestData(requestId) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return null;
  const rowData  = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const group    = rowData[CR.GROUP - 1];
  const approvers = getApprovers(group);
  return { rowData, rowNum, group, approvers };
}


// ============================================================
// EMAIL 1 — Send approval request to current approver
// AppSheet equivalent: Next Approver Bot → Step_Update_To_Requestor
// ============================================================
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
function sendDeclineToApprover(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const actioner      = Session.getActiveUser().getEmail();
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];

  const subject = emailSubject(controlNumber, "Declined", "APPROVER");

  const body = `Good day!

This confirms that you have declined the following request.

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
function sendDeclineToRequestor(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const actioner      = Session.getActiveUser().getEmail();
  const reason        = getLatestRemark(rowData);

  const subject = emailSubject(controlNumber, "Declined", "REQUESTOR");

  const body = `Good day!

We regret to inform you that your request has been declined.

${buildInfoBlock(rowData)}

Reason for Decline: ${reason}
Actioned by: ${actioner}
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

  // Get the last approval date
  const lastDate = rowData[CR.APP3_DATE - 1]
    || rowData[CR.APP2_DATE - 1]
    || rowData[CR.APP1_DATE - 1];

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
function sendFullyApprovedToRequestor(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const approvalLog   = buildApprovalLog(rowData, approvers);

  const subject = emailSubject(controlNumber, "Approved", "REQUESTOR");

  const body = `Good day!

Great news — your request has been fully approved.

${buildInfoBlock(rowData)}

Final Signatory Log:
${approvalLog}

Your Certificate of Completion will be provided separately. Thank you for using the E-Certificate portal!
Open this request: ${getPortalUrl(requestId, "request")}`;

  GmailApp.sendEmail(requestor, subject, body);
  Logger.log(`sendFullyApprovedToRequestor(): Approval email sent to ${requestor}`);
}


// ============================================================
// EMAIL 6 — Notify requestor their request was returned
// AppSheet equivalent: Return Bot → Process_NotifyReturn
// ============================================================
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
function sendProgressUpdateToRequestor(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const approvalLog   = buildApprovalLog(rowData, approvers);

  const completed = [rowData[CR.APP1_DATE - 1], rowData[CR.APP2_DATE - 1], rowData[CR.APP3_DATE - 1]]
    .filter(function (d) { return !!d; }).length;
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
function sendResubmitConfirmToRequestor(requestId, returnReason, resubmitCount) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const countNote     = resubmitCount > 1 ? ` (Resubmission #${resubmitCount})` : "";

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
function sendResubmitApprovalRequest(requestId, returnReason, resubmitCount) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData, approvers } = data;

  const step            = rowData[CR.STEP - 1];
  const currentApprover = getCurrentApprover(step, rowData[CR.GROUP - 1]);
  if (!currentApprover) return;

  const controlNumber  = rowData[CR.CONTROL_NUMBER - 1];
  const attachmentList = buildAttachmentList(requestId);
  const countNote      = resubmitCount > 1 ? ` #${resubmitCount}` : "";

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
