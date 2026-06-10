// Approvals.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Approvals.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung apat na "button" ng approval workflow — Approve, Decline, Return,
  Resubmit. Bawat isa, binibigyan ng requestId, hahanapin ang row, tapos
  itinatala ang galaw bilang ISANG ROW sa Approval_Actions (hindi na binubura
  ang dating data — append-only), at ina-update ang "cache" status/step sa
  Requests. ⚠️ Low-level ito: ang authorization ay nasa handle* wrappers sa
  WebApp.js — HINDI dito.

  TECHNICAL:
  Core state transitions, normalized schema. Each mutator reads the request's
  cache (step/group_id/resubmit_count from Requests), computes the next state,
  then writes via the Accessors seam: appendAction() (append-only timeline) +
  setRequestCache() (status/step/resubmit_count). No flat AppN_* columns. The
  per-step dates/remarks, previousApprovals, history, and audit are all DERIVED
  from Approval_Actions (see getApprovalView). No authorization here by design.

  NOTE: routing still uses the first 3 approver sequences (STATUS enum is
  PENDING_1/2/3). The schema supports N approvers; >3 routing is a later
  enhancement that needs new status strings (frozen DTO for now).

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  - approve(id)                append APPROVED, advance step / finish
  - decline(id, remark)        append DECLINED, status → Declined (terminal)
  - returnRequest(id, remark)  append RETURNED, step → 0, status → Returned
  - resubmit(id)               append RESUBMITTED, bump cycle, restart at step 1
*/


/*
  Function Name: approve
  LAYMAN    : Ina-aprubahan ang request sa kasalukuyang step. Nagdadagdag ng
              "approved" action, itinataas ang step, at ina-update ang status —
              papunta sa susunod na approver, o "Fully Approved" kung wala nang
              susunod. Nilalaktawan ang blangkong approver slots.
  TECHNICAL : Reads step/group_id/cycle from the Requests cache; getApprovers()
              for skip-blank routing; appendAction(APPROVED) at the current step;
              setRequestCache(status, step). Cycle = current resubmit_count.
  PARAMS    : requestId — request to approve.
  RETURNS   : { success:true, newStatus, step:newStep } or { success:false, message }.

  EXAMPLE
    approve("9B1")  → { success:true, newStatus:"Fully Approved", step:2 }
*/
function approve(requestId) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) {
    Logger.log(`approve(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData   = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const step      = rowData[CR.STEP - 1];
  const groupId   = rowData[CR.GROUP - 1];
  const cycle     = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;
  const approvers = getApprovers(groupId);

  if (!approvers) {
    Logger.log(`approve(): No approver config for group_id — ${groupId}`);
    return { success: false, message: "Approver group not configured." };
  }

  const newStep = step + 1;
  let newStatus;
  if (step === 1) {
    newStatus = approvers.approver2 ? STATUS.PENDING_2
              : approvers.approver3 ? STATUS.PENDING_3
              : STATUS.APPROVED;
  } else if (step === 2) {
    newStatus = approvers.approver3 ? STATUS.PENDING_3 : STATUS.APPROVED;
  } else if (step === 3) {
    newStatus = STATUS.APPROVED;
  } else {
    return { success: false, message: `Unexpected Step value: ${step}` };
  }

  appendAction(requestId, groupId, cycle, step, Session.getActiveUser().getEmail(), ACTION.APPROVED, "");
  setRequestCache(requestId, { status: newStatus, step: newStep });

  Logger.log(`approve(): ${requestId} approved at Step ${step} → ${newStatus}`);
  return { success: true, newStatus, step: newStep };
}


/*
  Function Name: decline
  LAYMAN    : Tinatanggihan ang request. Nagdadagdag ng "declined" action na may
              dahilan, at status → "Declined" (TAPOS na — bagong request na lang).
  TECHNICAL : appendAction(DECLINED, remark) at the current step; setRequestCache
              (status=DECLINED). No step change. Reason is on the action row.
  PARAMS    : requestId; approverRemark — the reason.
  RETURNS   : { success:true, newStatus:"Declined" } or { success:false, message }.
*/
function decline(requestId, approverRemark) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) {
    Logger.log(`decline(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const step    = rowData[CR.STEP - 1];
  const groupId = rowData[CR.GROUP - 1];
  const cycle   = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;

  appendAction(requestId, groupId, cycle, step, Session.getActiveUser().getEmail(), ACTION.DECLINED, approverRemark || "");
  setRequestCache(requestId, { status: STATUS.DECLINED });

  Logger.log(`decline(): ${requestId} declined at Step ${step}`);
  return { success: true, newStatus: STATUS.DECLINED };
}


/*
  Function Name: returnRequest
  LAYMAN    : Ibinabalik ang request sa requestor para ayusin. Nagdadagdag ng
              "returned" action na may dahilan; Step → 0, Status → "Returned to
              Requestor". Pwede itong i-resubmit.
  TECHNICAL : appendAction(RETURNED, remark) at the current step; setRequestCache
              (status=RETURNED, step=0). previousApprovals + history are derived
              from the timeline — no bookkeeping needed here or in handleReturn.
  PARAMS    : requestId; approverRemark — what to change.
  RETURNS   : { success:true, newStatus:"Returned to Requestor" } or { success:false, message }.
*/
function returnRequest(requestId, approverRemark) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) {
    Logger.log(`returnRequest(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const step    = rowData[CR.STEP - 1];
  const groupId = rowData[CR.GROUP - 1];
  const cycle   = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;

  appendAction(requestId, groupId, cycle, step, Session.getActiveUser().getEmail(), ACTION.RETURNED, approverRemark || "");
  setRequestCache(requestId, { status: STATUS.RETURNED, step: 0 });

  Logger.log(`returnRequest(): ${requestId} returned at Step ${step}`);
  return { success: true, newStatus: STATUS.RETURNED };
}


/*
  Function Name: resubmit
  LAYMAN    : Pag-resubmit ng requestor — binabalik sa simula ang chain.
              Nagdadagdag ng "resubmitted" action sa BAGONG cycle, bina-bump ang
              resubmit count, at babalik sa Step 1 / Pending Approver 1. Hindi na
              kailangang magbura ng dating approval — naka-tag sila sa lumang
              cycle, at ang bagong cycle ay malinis na simula.
  TECHNICAL : newCount = resubmit_count + 1. appendAction(RESUBMITTED) tagged with
              the NEW cycle (so getApprovalView pairs each RETURNED with its
              resubmit). setRequestCache(status=PENDING_1, step=1, resubmitCount).
              The frozen-DTO per-step/history fields recompute automatically off
              the cycle tag — no column clears.
  PARAMS    : requestId — the returned request to resubmit.
  RETURNS   : { success:true, newStatus:"Pending Approver 1", newCount } or { success:false, message }.
*/
function resubmit(requestId) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) {
    Logger.log(`resubmit(): Request ID not found — ${requestId}`);
    return { success: false, message: "Request not found." };
  }

  const rowData      = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const groupId      = rowData[CR.GROUP - 1];
  const currentCount = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;
  const newCount     = currentCount + 1;

  appendAction(requestId, groupId, newCount, null, Session.getActiveUser().getEmail(), ACTION.RESUBMITTED, "");
  setRequestCache(requestId, { status: STATUS.PENDING_1, step: 1, resubmitCount: newCount });

  Logger.log(`resubmit(): ${requestId} resubmitted (count: ${newCount}) → ${STATUS.PENDING_1}`);
  return { success: true, newStatus: STATUS.PENDING_1, newCount };
}
