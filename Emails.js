// Emails.js
// ============================================================
// Emails.js
// All email notification functions.
// Replaces AppSheet's 5 bots and their email templates.
// AppSheet used <<[ColumnName]>> merge syntax.
// Here we use JavaScript template literals (backtick strings).
// ============================================================


// Helper — builds the supporting documents list for email body
// Replaces AppSheet's <<Start: [Related Request_Attachments]>> loop
function buildAttachmentList(requestId) {
  const attachments = getAttachmentsForRequest(requestId);
  if (attachments.length === 0) return "No supporting documents uploaded.";
  return attachments
    .map(row => `• ${row[RA.DESCRIPTION - 1]} — ${row[RA.FILE_LINK - 1]}`)
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

  const projectTitle    = rowData[CR.PROJECT_TITLE - 1];
  const controlNumber   = rowData[CR.CONTROL_NUMBER - 1];
  const requestor       = rowData[CR.REQUESTOR - 1];
  const group           = rowData[CR.GROUP - 1];
  const attachmentList  = buildAttachmentList(requestId);
  const approvalLog     = buildApprovalLog(rowData, approvers);

  const subject = `[COC] New E-Certificate Request from ${requestor} from ${group}: "${projectTitle}" (${controlNumber})`;

  const body = `Hi,

You have a new e-certificate request by ${requestor} from the ${group} department titled "${projectTitle}" that requires your review and action.

SUPPORTING DOCUMENTS:
${attachmentList}

APPROVAL PROGRESS:
${approvalLog}

Please log in to the E-Certificate portal to review, approve, decline, or return this request.`;

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
  const projectTitle  = rowData[CR.PROJECT_TITLE - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];

  const subject = `[COC] DECLINE CONFIRMATION: You have declined "${projectTitle}" (${controlNumber})`;

  const body = `Hello,

This is a confirmation that you have successfully declined the request: "${projectTitle}" (${controlNumber}).

Date of Action: ${nowFormatted()}

The requestor has been notified that this request is now closed and cannot be resubmitted.`;

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
  const projectTitle  = rowData[CR.PROJECT_TITLE - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const actioner      = Session.getActiveUser().getEmail();
  const reason        = getLatestRemark(rowData);

  const subject = `[COC] DECLINED: "${projectTitle}" (${controlNumber})`;

  const body = `Hello,

We regret to inform you that your request for "${projectTitle}" (${controlNumber}) has been declined.

Reason for Decline: ${reason}
Actioned by: ${actioner}
Date: ${nowFormatted()}

Note: If you would like to try again, you must create a brand new request.`;

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

  const projectTitle  = rowData[CR.PROJECT_TITLE - 1];
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

  const subject = `[COC] Final Confirmation: You have approved "${projectTitle}" (${controlNumber})`;

  const body = `Hi,

This is a confirmation that you provided the final approval for "${projectTitle}" on ${formatPHTime(new Date(lastDate))}.

The request is now fully approved and the requestor has been notified. Thank you!`;

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
  const projectTitle  = rowData[CR.PROJECT_TITLE - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const approvalLog   = buildApprovalLog(rowData, approvers);

  const subject = `[COC] Approved: Your E-Certificate for "${projectTitle}" (${controlNumber}) is ready!`;

  const body = `Congratulations!

Your request for "${projectTitle}" (${controlNumber}) has been fully approved.

FINAL SIGNATORY LOG:
${approvalLog}

Your Certificate of Completion will be attached separately. Thank you for using the E-Certificate Automation system!`;

  GmailApp.sendEmail(requestor, subject, body);
  Logger.log(`sendFullyApprovedToRequestor(): Approval email sent to ${requestor}`);
}


// ============================================================
// EMAIL 6 — Notify requestor their request was returned
// AppSheet equivalent: Return Bot → Process_NotifyReturn
// ============================================================
function sendReturnToRequestor(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const requestor     = rowData[CR.REQUESTOR - 1];
  const projectTitle  = rowData[CR.PROJECT_TITLE - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];
  const actioner      = Session.getActiveUser().getEmail();
  const reason        = getLatestRemark(rowData);

  const subject = `[COC] REQUEST RETURNED: "${projectTitle}" (${controlNumber}) has been returned to you for updates`;

  const body = `Hello,

Your request "${projectTitle}" (${controlNumber}) has been sent back to you for updates.

Returned by: ${actioner}
Return Date: ${nowFormatted()}
Reason for Return: ${reason}

Please log in to the E-Certificate portal to review the comments, make the necessary changes, and resubmit your request.`;

  GmailApp.sendEmail(requestor, subject, body);
  Logger.log(`sendReturnToRequestor(): Return email sent to ${requestor}`);
}


// ============================================================
// EMAIL 7 — Confirm return to the approver who returned it
// AppSheet equivalent: Return Bot → Confirm_Return_To_Approver
// ============================================================
function sendReturnConfirmToApprover(requestId) {
  const data = getRequestData(requestId);
  if (!data) return;
  const { rowData } = data;

  const actioner      = Session.getActiveUser().getEmail();
  const requestor     = rowData[CR.REQUESTOR - 1];
  const projectTitle  = rowData[CR.PROJECT_TITLE - 1];
  const controlNumber = rowData[CR.CONTROL_NUMBER - 1];

  const subject = `[COC] RETURN CONFIRMATION: "${projectTitle}" (${controlNumber}) has been returned`;

  const body = `Hello,

This is a confirmation that you have successfully returned the following request for further updates.

Returned to: ${requestor}
Date of Action: ${nowFormatted()}

The recipient has been notified to review your comments and take the necessary next steps.`;

  GmailApp.sendEmail(actioner, subject, body);
  Logger.log(`sendReturnConfirmToApprover(): Confirmation sent to ${actioner}`);
}