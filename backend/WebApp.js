// ============================================================
// WebApp.gs
// The entry point for the web app.
// Every time someone opens the portal URL, Google calls doGet().
// This function reads the URL parameters and decides what page
// to show — like a traffic controller for the web app.
//
// URL structure:
//   /exec                          → login / landing
//   /exec?page=dashboard           → requestor or approver dashboard
//   /exec?page=new                 → new request form
//   /exec?page=request&id=XXX      → request detail (requestor view)
//   /exec?page=review&id=XXX       → request detail (approver view)
// ============================================================


// ============================================================
// MAIN ENTRY POINT
// Google calls this automatically when someone opens the web app URL
// ============================================================
function doGet(e) {
  const page     = e.parameter.page || "dashboard";
  const id       = e.parameter.id   || "";
  const userEmail = Session.getActiveUser().getEmail();

  // Detect role — is this user an approver or a requestor?
  const role = detectRole(userEmail);

  // Build the HTML page
  const html = HtmlService
    .createTemplateFromFile("frontend/Index")
    .evaluate()
    .setTitle("E-Certificate Portal — Megaworld")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  return html;
}


// ============================================================
// ROLE DETECTION
// Checks if the logged-in user is an approver in any group.
// Returns "approver" or "requestor".
// ============================================================
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

// Normalize an email for safe comparison (trim + lowercase).
// Guards against Google account casing differences.
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// True only if both emails are non-blank and refer to the same account.
function sameEmail(a, b) {
  const na = normalizeEmail(a);
  return na !== "" && na === normalizeEmail(b);
}

// Read a request's full 34-column row by Request ID.
// Returns the row array (0-indexed — use CR.* - 1) or null if not found.
function getRequestRowData(requestId) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return null;
  return sheet.getRange(rowNum, 1, 1, 34).getValues()[0];
}

// True if the caller is the approver who should act on this request
// right now (its current Step/Group).
function isCurrentApprover(row, callerEmail) {
  return sameEmail(getCurrentApprover(row[CR.STEP - 1], row[CR.GROUP - 1]), callerEmail);
}

// True if the caller occupies any of the 3 approver slots for this
// request's group — used to allow approvers to view a request detail.
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

// Returns the current user's email and role
function getCurrentUser() {
  const email = Session.getActiveUser().getEmail();
  const role  = detectRole(email);
  return { email, role };
}


// Returns all requests for the requestor dashboard
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


// Returns all requests pending the approver's action
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


// Returns all requests the current user has already acted on (approved/declined/returned).
// Includes a request if the caller occupies any approver slot for its group AND the
// matching AppN_Date is non-null — regardless of the request's current status.
// Returns the same DTO shape as getPendingApprovals() so the frontend renders identically.
function getMyActionedRequests() {
  const email = Session.getActiveUser().getEmail();
  const rows  = getDataRows(SHEET_NAMES.CERTIFICATE_REQUESTS);

  return rows
    .filter(function (row) {
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


// Returns full detail of one request by ID
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


// Returns the list of approver groups for the new request form dropdown
function getApproverGroups() {
  return getDataRows(SHEET_NAMES.APPROVER_SETTINGS)
    .map(row => row[AS.GROUP - 1])
    .filter(Boolean);
}


// Submits a new certificate request — called from the new request form
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


// Action handlers — called from the approver detail page
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
      sendApprovalRequest(requestId);
    }
  }
  return result;
}

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
    sendReturnToRequestor(requestId);
    sendReturnConfirmToApprover(requestId);
  }
  return result;
}

function handleResubmit(requestId) {
  const caller = Session.getActiveUser().getEmail();
  const row    = getRequestRowData(requestId);
  if (!row) return { success: false, error: "Request not found." };
  // Only the requestor may resubmit, and only a returned request can be resubmitted.
  if (!sameEmail(row[CR.REQUESTOR - 1], caller) || row[CR.STATUS - 1] !== STATUS.RETURNED) {
    return { success: false, error: "Unauthorized" };
  }

  return resubmit(requestId);
}


// Helper — include other HTML files (for CSS and JS partials)
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}