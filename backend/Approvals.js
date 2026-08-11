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
  Requests. ⚠️ May sariling guard na ang bawat mutator (tama ba ang caller at
  pwede pa bang aksyunan) bukod pa sa handle* wrappers sa WebApp.js, dahil
  direktang matatawag ang server functions via google.script.run.

  TECHNICAL:
  Core state transitions, normalized schema. Each mutator reads the request's
  cache (step/group_id/resubmit_count from Requests), computes the next state,
  then writes via the Accessors seam: appendAction_() (append-only timeline) +
  setRequestCache_() (status/step/resubmit_count). No flat AppN_* columns. The
  per-step dates/remarks, previousApprovals, history, and audit are all DERIVED
  from Approval_Actions (see getApprovalView_). Each mutator self-guards on caller
  identity + actionable status (defense in depth), and takes a LockService lock so
  a racing second action cannot double-apply, because any server function is
  reachable directly via google.script.run, not only through the handle* wrappers.

  NOTE: routing still uses the first 3 approver sequences (STATUS enum is
  PENDING_1/2/3). The schema supports N approvers; >3 routing is a later
  enhancement that needs new status strings (frozen DTO for now).

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  - approve_(id)                append APPROVED, advance step / finish
  - decline_(id, remark)        append DECLINED, status → Declined (terminal)
  - returnRequest_(id, remark)  append RETURNED, step → 0, status → Returned
  - resubmit_(id)               append RESUBMITTED, bump cycle, restart at step 1
*/


/*
  Function Name: approve_
  LAYMAN    : Ina-aprubahan ang request sa kasalukuyang step. Nagdadagdag ng
              "approved" action, itinataas ang step, at ina-update ang status —
              papunta sa susunod na approver, o "Fully Approved" kung wala nang
              susunod. Nilalaktawan ang blangkong approver slots.
  TECHNICAL : Reads step/group_id/cycle from the Requests cache; getApprovers_()
              for skip-blank routing; appendAction_(APPROVED) at the current step;
              setRequestCache_(status, step). Cycle = current resubmit_count.
  PARAMS    : requestId — request to approve_.
  RETURNS   : { success:true, newStatus, step:newStep } or { success:false, message }.

  EXAMPLE
    approve_("9B1")  → { success:true, newStatus:"Fully Approved", step:2 }
*/
function approve_(requestId) {
  // Serialize with a script lock so a re-read inside the lock is a true
  // compare-and-set: a racing second approve_ (two tabs, double email link)
  // sees the already-advanced status and is rejected, so the certificate and
  // requestor email are never generated twice.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { success: false, message: "System is busy. Please try again." }; }
  try {
    const sheet  = getSheet_(SHEET_NAMES.REQUESTS);
    const rowNum = getRowNumberByRequestId_(requestId);
    if (rowNum === -1) {
      Logger.log(`approve_(): Request ID not found — ${requestId}`);
      return { success: false, message: "Request not found." };
    }

    const rowData   = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
    const status    = rowData[CR.STATUS - 1];
    const step      = rowData[CR.STEP - 1];
    const groupId   = rowData[CR.GROUP - 1];
    const cycle     = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;
    const caller    = Session.getActiveUser().getEmail();

    // Self-guard (defense in depth): any server function is reachable directly
    // via google.script.run, so authorization must live HERE, not only in the
    // handle* wrapper. Reject unless the request is still awaiting approval AND
    // the caller is the current approver.
    if (status !== STATUS.PENDING_1 && status !== STATUS.PENDING_2 && status !== STATUS.PENDING_3) {
      return { success: false, message: "This request is no longer awaiting approval." };
    }
    if (!isCurrentApprover_(rowData, caller)) {
      // A chain approver who is not the CURRENT one almost always means the
      // request already moved on — e.g. a double-click across two tabs, where
      // the first click advanced the step. Tell them that plainly. Reserve
      // "Unauthorized" for a caller who has no business with this request.
      return isChainApprover_(rowData, caller)
        ? { success: false, message: "This request has already been actioned." }
        : { success: false, message: "Unauthorized" };
    }

    const approvers = getApprovers_(groupId);
    if (!approvers) {
      Logger.log(`approve_(): No approver config for group_id — ${groupId}`);
      return { success: false, message: "Approver group not configured." };
    }

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

    // Derive the next step FROM the next pending status, not step+1, so a gapped
    // chain (e.g. slot 2 soft-disabled) routes to the actual next approver
    // instead of an empty step. PENDING_2 -> 2, PENDING_3 -> 3, APPROVED -> terminal.
    let newStep;
    if (newStatus === STATUS.PENDING_2)      newStep = 2;
    else if (newStatus === STATUS.PENDING_3) newStep = 3;
    else                                     newStep = step + 1; // APPROVED: step no longer routes

    appendAction_(requestId, groupId, cycle, step, caller, ACTION.APPROVED, "");
    setRequestCache_(requestId, { status: newStatus, step: newStep });

    Logger.log(`approve_(): ${requestId} approved at Step ${step} → ${newStatus}`);
    return { success: true, newStatus, step: newStep };
  } finally {
    lock.releaseLock();
  }
}


/*
  Function Name: decline_
  LAYMAN    : Tinatanggihan ang request. Nagdadagdag ng "declined" action na may
              dahilan, at status → "Declined" (TAPOS na — bagong request na lang).
  TECHNICAL : appendAction_(DECLINED, remark) at the current step; setRequestCache_
              (status=DECLINED). No step change. Reason is on the action row.
  PARAMS    : requestId; approverRemark — the reason.
  RETURNS   : { success:true, newStatus:"Declined" } or { success:false, message }.
*/
function decline_(requestId, approverRemark) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { success: false, message: "System is busy. Please try again." }; }
  try {
    const sheet  = getSheet_(SHEET_NAMES.REQUESTS);
    const rowNum = getRowNumberByRequestId_(requestId);
    if (rowNum === -1) {
      Logger.log(`decline_(): Request ID not found — ${requestId}`);
      return { success: false, message: "Request not found." };
    }

    const rowData = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
    const status  = rowData[CR.STATUS - 1];
    const step    = rowData[CR.STEP - 1];
    const groupId = rowData[CR.GROUP - 1];
    const cycle   = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;
    const caller  = Session.getActiveUser().getEmail();

    // Self-guard: reject unless still awaiting approval AND caller is the current
    // approver. The status check also blocks re-declining a terminal request.
    if (status !== STATUS.PENDING_1 && status !== STATUS.PENDING_2 && status !== STATUS.PENDING_3) {
      return { success: false, message: "This request is no longer awaiting approval." };
    }
    if (!isCurrentApprover_(rowData, caller)) {
      // See approve_(): distinguish "already actioned" from a genuine outsider.
      return isChainApprover_(rowData, caller)
        ? { success: false, message: "This request has already been actioned." }
        : { success: false, message: "Unauthorized" };
    }

    const rv = validateRemark_(approverRemark);
    if (!rv.ok) return { success: false, message: rv.message };

    appendAction_(requestId, groupId, cycle, step, caller, ACTION.DECLINED, approverRemark || "");
    setRequestCache_(requestId, { status: STATUS.DECLINED });

    Logger.log(`decline_(): ${requestId} declined at Step ${step}`);
    return { success: true, newStatus: STATUS.DECLINED };
  } finally {
    lock.releaseLock();
  }
}


/*
  Function Name: validateRemark_
  LAYMAN    : Tinitingnan lang kung hindi sobrang haba ang dahilan na tinype ng
              approver. Dati walang limitasyon — pwedeng 50,000 characters, tapos
              lalabas yun sa detail page at sa lahat ng email.
  TECHNICAL : Length cap for approver-supplied free text before it enters the
              append-only Activity_Log. Rejects rather than truncates, so the
              approver is never silently robbed of their wording. Blank stays
              acceptable — this does NOT introduce a mandatory-reason rule.
  PARAMS    : remark — the caller-supplied string (may be undefined/null).
  RETURNS   : { ok:true } | { ok:false, message:"<user-facing>" }
*/
function validateRemark_(remark) {
  const MAX_REMARK = 2000;
  if (remark && String(remark).length > MAX_REMARK) {
    return { ok: false, message: "Your remark is too long (max " + MAX_REMARK + " characters)." };
  }
  return { ok: true };
}


/*
  Function Name: returnRequest_
  LAYMAN    : Ibinabalik ang request sa requestor para ayusin. Nagdadagdag ng
              "returned" action na may dahilan; Step → 0, Status → "Returned to
              Requestor". Pwede itong i-resubmit_.
  TECHNICAL : appendAction_(RETURNED, remark) at the current step; setRequestCache_
              (status=RETURNED, step=0). previousApprovals + history are derived
              from the timeline — no bookkeeping needed here or in handleReturn.
  PARAMS    : requestId; approverRemark — what to change.
  RETURNS   : { success:true, newStatus:"Returned to Requestor" } or { success:false, message }.
*/
function returnRequest_(requestId, approverRemark) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { success: false, message: "System is busy. Please try again." }; }
  try {
    const sheet  = getSheet_(SHEET_NAMES.REQUESTS);
    const rowNum = getRowNumberByRequestId_(requestId);
    if (rowNum === -1) {
      Logger.log(`returnRequest_(): Request ID not found — ${requestId}`);
      return { success: false, message: "Request not found." };
    }

    const rowData = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
    const status  = rowData[CR.STATUS - 1];
    const step    = rowData[CR.STEP - 1];
    const groupId = rowData[CR.GROUP - 1];
    const cycle   = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;
    const caller  = Session.getActiveUser().getEmail();

    // Self-guard: reject unless still awaiting approval AND caller is the current
    // approver. Blocks re-opening a terminal (declined/approved) request.
    if (status !== STATUS.PENDING_1 && status !== STATUS.PENDING_2 && status !== STATUS.PENDING_3) {
      return { success: false, message: "This request is no longer awaiting approval." };
    }
    if (!isCurrentApprover_(rowData, caller)) {
      // See approve_(): distinguish "already actioned" from a genuine outsider.
      return isChainApprover_(rowData, caller)
        ? { success: false, message: "This request has already been actioned." }
        : { success: false, message: "Unauthorized" };
    }

    const rv = validateRemark_(approverRemark);
    if (!rv.ok) return { success: false, message: rv.message };

    appendAction_(requestId, groupId, cycle, step, caller, ACTION.RETURNED, approverRemark || "");
    setRequestCache_(requestId, { status: STATUS.RETURNED, step: 0 });

    Logger.log(`returnRequest_(): ${requestId} returned at Step ${step}`);
    return { success: true, newStatus: STATUS.RETURNED };
  } finally {
    lock.releaseLock();
  }
}


/*
  Function Name: resubmit_
  LAYMAN    : Pag-resubmit_ ng requestor — binabalik sa simula ang chain.
              Nagdadagdag ng "resubmitted" action sa BAGONG cycle, bina-bump ang
              resubmit_ count, at babalik sa Step 1 / Pending Approver 1. Hindi na
              kailangang magbura ng dating approval — naka-tag sila sa lumang
              cycle, at ang bagong cycle ay malinis na simula.
  TECHNICAL : newCount = resubmit_count + 1. appendAction_(RESUBMITTED) tagged with
              the NEW cycle (so getApprovalView_ pairs each RETURNED with its
              resubmit_). setRequestCache_(status=PENDING_1, step=1, resubmitCount).
              The frozen-DTO per-step/history fields recompute automatically off
              the cycle tag — no column clears.
  PARAMS    : requestId — the returned request to resubmit_.
  RETURNS   : { success:true, newStatus:"Pending Approver 1", newCount } or { success:false, message }.
*/
function resubmit_(requestId) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { return { success: false, message: "System is busy. Please try again." }; }
  try {
    const sheet  = getSheet_(SHEET_NAMES.REQUESTS);
    const rowNum = getRowNumberByRequestId_(requestId);
    if (rowNum === -1) {
      Logger.log(`resubmit_(): Request ID not found — ${requestId}`);
      return { success: false, message: "Request not found." };
    }

    const rowData      = sheet.getRange(rowNum, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
    const groupId      = rowData[CR.GROUP - 1];
    const currentCount = parseInt(rowData[CR.RESUBMIT_COUNT - 1], 10) || 0;
    const newCount     = currentCount + 1;
    const caller       = Session.getActiveUser().getEmail();

    // Self-guard: only the requestor may resubmit_, and only a Returned request.
    // Re-checked inside the lock so two rapid resubmits cannot both bump the cycle.
    if (!sameEmail_(rowData[CR.REQUESTOR - 1], caller) || rowData[CR.STATUS - 1] !== STATUS.RETURNED) {
      return { success: false, message: "Unauthorized" };
    }

    appendAction_(requestId, groupId, newCount, null, caller, ACTION.RESUBMITTED, "");
    setRequestCache_(requestId, { status: STATUS.PENDING_1, step: 1, resubmitCount: newCount });

    Logger.log(`resubmit_(): ${requestId} resubmitted (count: ${newCount}) → ${STATUS.PENDING_1}`);
    return { success: true, newStatus: STATUS.PENDING_1, newCount };
  } finally {
    lock.releaseLock();
  }
}
