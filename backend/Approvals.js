// Approvals.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Approvals.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung apat na "button" ng approval workflow — Approve, Decline, Return,
  Resubmit — na nakasalin galing AppSheet bilang functions. Bawat isa ay
  binibigyan ng requestId, hahanapin ang tamang row sa Sheet, tapos babaguhin
  ang state nito. ⚠️ Low-level ito: ang authorization (kung sino ang pwede
  kumilos) ay ginagawa sa handle* wrappers sa WebApp.js — HINDI dito.

  TECHNICAL:
  Core state transitions for Certificate_Requests, invoked by the guarded
  handle* functions in WebApp.js. Each resolves the row by requestId, writes
  Step/Status/dates/remarks, and stamps LAST_ACTION_BY (audit + actioned-list).
  No authorization here by design — callers gate first.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  - approve(id)                step++, stamp AppN_Date, advance or finish
  - decline(id, remark)        status → Declined (terminal, no resubmit)
  - returnRequest(id, remark)  step → 0, status → Returned to Requestor
  - resubmit(id)               clear approvals, restart at step 1
*/


// ============================================================
// APPROVE
// AppSheet equivalent: Approve action
//   - Step = Step + 1
//   - Sets the correct AppN_Date timestamp
//   - Updates Status to next pending state or Fully Approved
// ============================================================

/*
  Function Name: approve
  LAYMAN    : Ina-aprubahan ang request sa kasalukuyang step. Itinataas ang
              step, nilalagyan ng petsa ang tamang AppN_Date, at ina-update ang
              status — papunta sa susunod na approver, o "Fully Approved" kung
              wala nang susunod. Nilalaktawan ang blangkong approver slots.
  TECHNICAL : Advances Step, stamps the step's AppN_Date, recomputes Status by
              skipping empty approver slots, and records LAST_ACTION_BY.
  PARAMS    : requestId — request to approve.
  RETURNS   : { success:true, newStatus, step:newStep } — or { success:false,
              message } if not found / group unconfigured / unexpected step.

  STEPS
    Step 1 — Locate row + read step/group/approvers
      Layman    : Hanapin ang row; kunin ang step, group, at approvers config.
      Technical : getRowNumberByRequestId; read 31-col row; getApprovers(group).
    Step 2 — Decide date column + next status (skip blanks)
      Layman    : Base sa step, aling AppN_Date ang lalagyan at sino ang
                  susunod — kung walang Approver 2/3, diretso na sa Approved.
      Technical : step 1/2/3 → APP1/2/3_DATE; next status skips unconfigured
                  approver slots; unexpected step → error result.
    Step 3 — Write step, status, date, audit stamp
      Layman    : Isulat ang bagong step/status/petsa at kung sino ang nag-approve.
      Technical : setValue STEP, STATUS, dateCol, LAST_ACTION_BY (session email).

  EXAMPLE
    // Single-approver group, currently step 1
    approve("REQ-9b1")
    → { success:true, newStatus:"Fully Approved", step:2 }
      (APP1_DATE stamped; no Approver 2/3 configured, so it finishes)
*/
function approve(requestId) {
  const ss        = getSpreadsheet();
  const sheet     = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum    = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`approve(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData   = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const step      = rowData[CR.STEP - 1];
  const group     = rowData[CR.GROUP - 1];
  const approvers = getApprovers(group);

  if (!approvers) {
    Logger.log(`approve(): No approver config found for group — ${group}`);
    return { success: false, message: "Approver group not configured." };
  }

  const newStep = step + 1;
  const now     = new Date();

  // Determine which date column to stamp and what the new Status should be
  let dateCol, newStatus;

  if (step === 1) {
    dateCol   = CR.APP1_DATE;
    // If Approver 2 exists, route to them. Otherwise skip to 3 or fully approve.
    if (approvers.approver2) {
      newStatus = STATUS.PENDING_2;
    } else if (approvers.approver3) {
      newStatus = STATUS.PENDING_3;
    } else {
      newStatus = STATUS.APPROVED;
    }
  } else if (step === 2) {
    dateCol   = CR.APP2_DATE;
    newStatus = approvers.approver3 ? STATUS.PENDING_3 : STATUS.APPROVED;
  } else if (step === 3) {
    dateCol   = CR.APP3_DATE;
    newStatus = STATUS.APPROVED;
  } else {
    return { success: false, message: `Unexpected Step value: ${step}` };
  }

  // Write Step, Status, and the approval timestamp
  sheet.getRange(rowNum, CR.STEP).setValue(newStep);
  sheet.getRange(rowNum, CR.STATUS).setValue(newStatus);
  sheet.getRange(rowNum, dateCol).setValue(now);
  sheet.getRange(rowNum, CR.LAST_ACTION_BY).setValue(Session.getActiveUser().getEmail());

  Logger.log(`approve(): ${requestId} approved at Step ${step} → ${newStatus}`);
  return { success: true, newStatus, step: newStep };
}


// ============================================================
// DECLINE
// AppSheet equivalent: Decline action
//   - Status = "Declined"
// Note: declined requests cannot be resubmitted — requestor
// must file a brand new request (same behavior as AppSheet)
// ============================================================

/*
  Function Name: decline
  LAYMAN    : Tinatanggihan ang request. Status → "Declined" (TAPOS na — hindi
              na pwedeng i-resubmit; bagong request na lang). Itinatala ang
              remark sa tamang approver column.
  TECHNICAL : Writes the remark to the current step's APPn_REMARK, sets Status
              to Declined, stamps LAST_ACTION_BY. No date is stamped (by design).
  PARAMS    : requestId — request to decline; approverRemark — the reason.
  RETURNS   : { success:true, newStatus:"Declined" } or { success:false, message }.

  STEPS
    Step 1 — Locate row + read step
      Layman    : Hanapin ang row; alamin ang kasalukuyang step.
      Technical : getRowNumberByRequestId; read 31-col row; step = STEP.
    Step 2 — Record the remark (per step)
      Layman    : Ilagay ang dahilan sa tamang approver remark column.
      Technical : APP{step}_REMARK = approverRemark (only when provided).
    Step 3 — Set Declined + audit stamp
      Layman    : Status → Declined; itala kung sino ang nag-decline.
      Technical : STATUS = DECLINED; LAST_ACTION_BY = session email.
      NOTE      : No AppN_Date is written — precisely why LAST_ACTION_BY exists,
                  so declines still surface in "Actioned by you".

  EXAMPLE
    decline("REQ-9b1", "Budget not approved")
    → { success:true, newStatus:"Declined" }
*/
function decline(requestId, approverRemark) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`decline(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const step    = rowData[CR.STEP - 1];

  // Write the remark into the correct approver remark column
  if (step === 1 && approverRemark) {
    sheet.getRange(rowNum, CR.APP1_REMARK).setValue(approverRemark);
  } else if (step === 2 && approverRemark) {
    sheet.getRange(rowNum, CR.APP2_REMARK).setValue(approverRemark);
  } else if (step === 3 && approverRemark) {
    sheet.getRange(rowNum, CR.APP3_REMARK).setValue(approverRemark);
  }

  sheet.getRange(rowNum, CR.STATUS).setValue(STATUS.DECLINED);
  sheet.getRange(rowNum, CR.LAST_ACTION_BY).setValue(Session.getActiveUser().getEmail());

  Logger.log(`decline(): ${requestId} declined at Step ${step}`);
  return { success: true, newStatus: STATUS.DECLINED };
}


// ============================================================
// RETURN REQUEST
// AppSheet equivalent: Return Request action
//   - Step = 0
//   - Status = "Returned to Requestor"
// Requestor receives notification and can resubmit
// ============================================================

/*
  Function Name: returnRequest
  LAYMAN    : Ibinabalik ang request sa requestor para ayusin. Step → 0 (walang
              approver muna), Status → "Returned to Requestor". Pwede itong
              i-resubmit (kaiba sa decline). Itinatala ang remark.
  TECHNICAL : Writes the remark to the current step's APPn_REMARK, sets Step=0
              and Status=Returned, stamps LAST_ACTION_BY.
  PARAMS    : requestId — request to return; approverRemark — what to change.
  RETURNS   : { success:true, newStatus:"Returned to Requestor" } or
              { success:false, message }.

  STEPS
    Step 1 — Locate row + read step
      Layman    : Hanapin ang row; alamin ang step.
      Technical : getRowNumberByRequestId; read 31-col row.
    Step 2 — Record the remark (per step)
      Layman    : Ilagay ang dahilan sa tamang remark column.
      Technical : APP{step}_REMARK = approverRemark (only when provided).
    Step 3 — Set Step=0, Returned, audit stamp
      Layman    : Step → 0, Status → Returned, itala ang nagbalik.
      Technical : STEP=0; STATUS=RETURNED; LAST_ACTION_BY = session email.
      NOTE      : Like decline, no date is stamped — LAST_ACTION_BY covers it.
                  handleReturn() (WebApp.js) does the history/AH bookkeeping
                  AROUND this low-level call.

  EXAMPLE
    returnRequest("REQ-9b1", "Wrong supplier on contract")
    → { success:true, newStatus:"Returned to Requestor" }
*/
function returnRequest(requestId, approverRemark) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`returnRequest(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
  const step    = rowData[CR.STEP - 1];

  // Write the remark into the correct approver remark column
  if (step === 1 && approverRemark) {
    sheet.getRange(rowNum, CR.APP1_REMARK).setValue(approverRemark);
  } else if (step === 2 && approverRemark) {
    sheet.getRange(rowNum, CR.APP2_REMARK).setValue(approverRemark);
  } else if (step === 3 && approverRemark) {
    sheet.getRange(rowNum, CR.APP3_REMARK).setValue(approverRemark);
  }

  sheet.getRange(rowNum, CR.STEP).setValue(0);
  sheet.getRange(rowNum, CR.STATUS).setValue(STATUS.RETURNED);
  sheet.getRange(rowNum, CR.LAST_ACTION_BY).setValue(Session.getActiveUser().getEmail());

  Logger.log(`returnRequest(): ${requestId} returned at Step ${step}`);
  return { success: true, newStatus: STATUS.RETURNED };
}


// ============================================================
// RESUBMIT
// AppSheet equivalent: Resubmit Request action
// Clears all approval history and restarts from Step 1.
// Only callable by the original requestor.
// ============================================================

/*
  Function Name: resubmit
  LAYMAN    : Pag-resubmit ng requestor — binabalik sa simula ang buong chain.
              Bina-bump ang resubmit count, ginagawang numbered ang dating
              "[PENDING]" history entry, binubura lahat ng dating approval
              (petsa + remarks + prev approvals), at babalik sa Step 1 (o
              "Syncing" kung may attachments). Requestor-only — naka-gate sa
              handleResubmit().
  TECHNICAL : Increments RESUBMIT_COUNT, promotes the "[PENDING]" history
              placeholder to "Resubmit #N —", clears AppN dates/remarks +
              PREVIOUS_APPROVALS, and resets Step=1 with Status SYNCING or PENDING_1.
  PARAMS    : requestId — the returned request to resubmit.
  RETURNS   : { success:true, newStatus } or { success:false, message }.

  STEPS
    Step 1 — Locate row + read count/history
      Layman    : Hanapin ang row; kunin ang dating count at history.
      Technical : read 34-col row; currentCount, currentHistory.
    Step 2 — Promote the [PENDING] history entry
      Layman    : Yung "[PENDING]" na tala ni handleReturn, gawing "Resubmit #N".
      Technical : newCount = currentCount+1; replace "[PENDING]" → `Resubmit #N —`.
    Step 3 — Decide restart status
      Layman    : May attachments? Syncing muna. Wala? Diretso Approver 1.
      Technical : expectedAttachments > 0 ? SYNCING : PENDING_1.
    Step 4 — Clear approvals + reset to step 1
      Layman    : Burahin lahat ng dating petsa/remark at prev approvals;
                  Step → 1, Status → bago.
      Technical : setValue STEP=1, STATUS; blank APP1/2/3 date+remark + blank
                  PREVIOUS_APPROVALS; persist new count + history.

  EXAMPLE
    resubmit("REQ-9b1")   // no attachments expected
    → { success:true, newStatus:"Pending Approver 1" }
      (history now reads "Resubmit #1 — Approver 1 (…) …"; dates cleared)
*/
function resubmit(requestId) {
  const sheet  = getSheet(SHEET_NAMES.CERTIFICATE_REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);

  if (rowNum === -1) {
    Logger.log(`resubmit(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData        = sheet.getRange(rowNum, 1, 1, 34).getValues()[0];
  const currentCount   = parseInt(rowData[CR.RESUBMIT_COUNT - 1]) || 0;
  const currentHistory = String(rowData[CR.RESUBMIT_HISTORY - 1] || "").trim();
  const newCount       = currentCount + 1;

  // handleReturn() wrote a "[PENDING] …" entry at return time, while
  // Step and the active user still pointed at the actual returner.
  // Promote that placeholder to a numbered Resubmit entry now.
  const confirmedHistory = currentHistory.replace(
    "[PENDING]",
    `Resubmit #${newCount} —`
  );

  sheet.getRange(rowNum, CR.RESUBMIT_COUNT).setValue(newCount);
  sheet.getRange(rowNum, CR.RESUBMIT_HISTORY).setValue(confirmedHistory);

  // If attachments are required, go back to Syncing Files first.
  // Otherwise go straight to Pending Approver 1.
  const expectedAttachments = rowData[CR.EXPECTED_ATTACHMENTS - 1] || 0;
  const newStatus = expectedAttachments > 0 ? STATUS.SYNCING : STATUS.PENDING_1;

  // Clear all approval history — same as AppSheet's Resubmit action
  sheet.getRange(rowNum, CR.STEP).setValue(1);
  sheet.getRange(rowNum, CR.STATUS).setValue(newStatus);
  sheet.getRange(rowNum, CR.APP1_DATE).setValue("");
  sheet.getRange(rowNum, CR.APP2_DATE).setValue("");
  sheet.getRange(rowNum, CR.APP3_DATE).setValue("");
  sheet.getRange(rowNum, CR.APP1_REMARK).setValue("");
  sheet.getRange(rowNum, CR.APP2_REMARK).setValue("");
  sheet.getRange(rowNum, CR.APP3_REMARK).setValue("");
  // Previous approvals are only relevant during the "returned" phase.
  sheet.getRange(rowNum, CR.PREVIOUS_APPROVALS).setValue("");

  Logger.log(`resubmit(): ${requestId} resubmitted (count: ${newCount}) → ${newStatus}`);
  return { success: true, newStatus };
}