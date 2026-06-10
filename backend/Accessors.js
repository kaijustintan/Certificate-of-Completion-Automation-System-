// Accessors.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Accessors.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito ang "single door" papunta sa normalized database. Lahat ng pagbasa ng
  approver chain, group, at approval history — at lahat ng pagsulat ng approval
  action — dito dumadaan. Dahil dito, kahit nagbago ang hugis ng database
  (mula sa lumang 35-column monolith papunta sa 6 na hiwalay na sheets), ang
  ibang code ay hindi na kailangang malaman kung saan eksaktong nakatago ang
  data. Ang frontend DTO ay PANATILING PAREHO — kaya hindi nasisira ang UI.

  TECHNICAL:
  The accessor seam for the normalized schema. Centralizes:
    • Group/approver reads (keyed by surrogate group_id) — preserves the legacy
      getApprovers() 6-field shape so every downstream consumer is untouched.
    • Append-only Approval_Actions reads + a derived "view" that reconstructs the
      OLD per-step date/remark, previousApprovals, latestRemark, N-of-M, and
      resubmitHistory string — so getRequestDetail / emails / Certificate read
      identical values to before.
    • Write primitives: appendAction() + setRequestCache() — the only writers of
      Approval_Actions and the Requests status/step/resubmit_count cache.
    • Role: detectRole(), isAdmin().
    • ID generators for the new sheets.

  Depends on Utils.js (getSheet, getDataRows, getRowNumberByRequestId, formatPHTime)
  and WebApp.js (sameEmail, normalizeEmail). One global scope — no imports.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  ID GENERATORS
    - generateActionId() / generateGroupId() / generateGroupApproverId()
  GROUPS / APPROVERS
    - getGroupApprovers(groupId)         ordered active approver rows
    - getApprovers(groupId)              legacy 6-field shape (compat)
    - getCurrentApprover(step, groupId)  email at a given sequence
    - getGroupById / getGroupNameById / getGroupIdByName
    - getApproverGroups()                [{id, name}] for the form dropdown
  ROLE
    - detectRole(email) / isAdmin(email)
  APPROVAL ACTIONS (read)
    - getApprovalActions(requestId)      raw timeline rows
    - getApprovalView(requestId)         derived per-step/history view (frozen-DTO source)
  APPROVAL ACTIONS (write)
    - appendAction(requestId, groupId, cycle, step, actor, action, remark)
    - setRequestCache(requestId, {status, step, resubmitCount})
*/


// ============================================================
// ID GENERATORS
// ============================================================
/* generateActionId — unique Approval_Actions key (e.g. "ACT-1A2B3C4D"). */
function generateActionId() {
  return "ACT-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
}
/* generateGroupApproverId — unique Group_Approvers key (e.g. "GA-1A2B3C4D"). */
function generateGroupApproverId() {
  return "GA-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
}
/* generateCocId — unique COC_PDFs key (e.g. "COC-1A2B3C4D"). */
function generateCocId() {
  return "COC-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
}
/*
  generateGroupId — next sequential group id "G###".
  LAYMAN    : Susunod na G001, G002, … base sa pinakamataas na meron.
  TECHNICAL : Scans Groups for the max G\d+ and returns max+1 zero-padded to 3.
*/
function generateGroupId() {
  const rows = getDataRows(SHEET_NAMES.GROUPS);
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r[GRP.GROUP_ID - 1] || "").match(/^G(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "G" + String(max + 1).padStart(3, "0");
}


// ============================================================
// GROUPS / APPROVERS
// ============================================================
/*
  getGroupApprovers — ordered active approvers for a group_id.
  RETURNS : [{ sequence, email, designation }] sorted by sequence (active only).
*/
function getGroupApprovers(groupId) {
  const target = String(groupId);
  return getDataRows(SHEET_NAMES.GROUP_APPROVERS)
    .filter(function (r) {
      return String(r[GAP.GROUP_ID - 1]) === target &&
             String(r[GAP.ACTIVE - 1]).toUpperCase() !== "FALSE";
    })
    .map(function (r) {
      return {
        sequence:    parseInt(r[GAP.SEQUENCE - 1], 10) || 0,
        email:       r[GAP.APPROVER_EMAIL - 1] || null,
        designation: r[GAP.DESIGNATION - 1] || null,
      };
    })
    .sort(function (a, b) { return a.sequence - b.sequence; });
}

/*
  getApprovers — LEGACY 6-field shape from the first 3 sequences.
  LAYMAN    : Para hindi masira ang lahat ng lumang code na umaasa sa
              {approver1/2/3, designation1/2/3}, binubuo natin ito mula sa
              unang 3 sequences ng Group_Approvers.
  TECHNICAL : Preserves the exact return shape of the old Utils.getApprovers so
              approve() skip-blank, Certificate signatories, buildApprovalLog,
              N-of-M, isChainApprover, and the detail DTO all keep working.
  RETURNS   : { approver1, designation1, approver2, designation2, approver3,
              designation3 } or null if the group has no approvers.
*/
function getApprovers(groupId) {
  const list = getGroupApprovers(groupId);
  if (!list.length) return null;
  const bySeq = {};
  list.forEach(function (a) { bySeq[a.sequence] = a; });
  return {
    approver1:    bySeq[1] ? bySeq[1].email : null,
    designation1: bySeq[1] ? bySeq[1].designation : null,
    approver2:    bySeq[2] ? bySeq[2].email : null,
    designation2: bySeq[2] ? bySeq[2].designation : null,
    approver3:    bySeq[3] ? bySeq[3].email : null,
    designation3: bySeq[3] ? bySeq[3].designation : null,
  };
}

/*
  getCurrentApprover — email of the approver at a given step (sequence).
  PARAMS  : step — 1-based sequence (0 → null, returned to requestor);
            groupId — the group_id FK.
  RETURNS : email string or null.
*/
function getCurrentApprover(step, groupId) {
  if (!step || step === 0) return null;
  const match = getGroupApprovers(groupId).find(function (a) { return a.sequence === step; });
  return match ? match.email : null;
}

/* getGroupById — raw Groups row (0-indexed array) or null. */
function getGroupById(groupId) {
  const target = String(groupId);
  return getDataRows(SHEET_NAMES.GROUPS)
    .find(function (r) { return String(r[GRP.GROUP_ID - 1]) === target; }) || null;
}
/* getGroupNameById — display name for a group_id ("" if not found). */
function getGroupNameById(groupId) {
  const g = getGroupById(groupId);
  return g ? g[GRP.GROUP_NAME - 1] : "";
}
/* getGroupIdByName — group_id for a display name ("" if not found). Transitional. */
function getGroupIdByName(name) {
  const m = getDataRows(SHEET_NAMES.GROUPS)
    .find(function (r) { return r[GRP.GROUP_NAME - 1] === name; });
  return m ? m[GRP.GROUP_ID - 1] : "";
}
/*
  getApproverGroups — active groups for the new-request dropdown.
  RETURNS : [{ id, name }] (active groups only). NOTE: shape changed from a
            string[] to objects — the frontend dropdown is updated to match.
*/
function getApproverGroups() {
  return getDataRows(SHEET_NAMES.GROUPS)
    .filter(function (r) {
      return r[GRP.GROUP_ID - 1] && String(r[GRP.ACTIVE - 1]).toUpperCase() !== "FALSE";
    })
    .map(function (r) { return { id: r[GRP.GROUP_ID - 1], name: r[GRP.GROUP_NAME - 1] }; });
}


// ============================================================
// ROLE
// ============================================================
/*
  detectRole — classify a caller as "approver" or "requestor".
  LAYMAN    : Approver ka kung nasa Group_Approvers ang email mo kahit saang
              group. (Ang admin role ay hiwalay na phase — gamitin isAdmin().)
  TECHNICAL : Scans Group_Approvers.approver_email. Admin is intentionally NOT
              returned here yet (admin UI is a later phase); isAdmin() exists
              for when it is wired.
*/
function detectRole(email) {
  if (!email) return "requestor";
  const rows = getDataRows(SHEET_NAMES.GROUP_APPROVERS);
  for (let i = 0; i < rows.length; i++) {
    if (sameEmail(rows[i][GAP.APPROVER_EMAIL - 1], email)) return "approver";
  }
  return "requestor";
}

/*
  isAdmin — is this email an active admin?
  TECHNICAL : Scans the Admins allowlist (active only). Server-side identity
              only — never trust a role flag from the frontend.
*/
function isAdmin(email) {
  if (!email) return false;
  return getDataRows(SHEET_NAMES.ADMINS).some(function (r) {
    return sameEmail(r[ADM.EMAIL - 1], email) &&
           String(r[ADM.ACTIVE - 1]).toUpperCase() !== "FALSE";
  });
}


// ============================================================
// APPROVAL ACTIONS — READ
// ============================================================
/*
  getApprovalActions — the raw append-only timeline for a request.
  RETURNS : [{ actionId, requestId, cycle, step, actor, action, remark, timestamp }]
            in append (≈ chronological) order.
*/
function getApprovalActions(requestId) {
  const target = String(requestId);
  return getDataRows(SHEET_NAMES.ACTIVITY_LOG)
    .filter(function (r) { return String(r[ACT.REQUEST_ID - 1]) === target; })
    .map(function (r) {
      const stepRaw = r[ACT.APPROVER_STEP - 1];
      return {
        actionId:  r[ACT.ACTION_ID - 1],
        requestId: r[ACT.REQUEST_ID - 1],
        groupId:   r[ACT.GROUP_ID - 1] || "",
        cycle:     parseInt(r[ACT.RESUBMIT_CYCLE - 1], 10) || 0,
        step:      (stepRaw === "" || stepRaw === null) ? null : (parseInt(stepRaw, 10) || 0),
        actor:     r[ACT.ACTOR_EMAIL - 1] || "",
        action:    r[ACT.ACTION - 1] || "",
        remark:    r[ACT.REMARK - 1] || "",
        timestamp: r[ACT.TIMESTAMP - 1] || "",
      };
    });
}

/*
  getApprovalView — derived view that reconstructs the OLD shapes from actions.
  LAYMAN    : Mula sa listahan ng actions, binubuo nito ang mga lumang field na
              inaasahan ng UI/email/COC: petsa+remark kada step, previousApprovals,
              pinakabagong remark, bilang ng aprubado, at ang resubmitHistory
              string. Kaya hindi nagbago ang DTO.
  TECHNICAL : Single pass over getApprovalActions. "Current cycle" = max cycle.
              byStep covers the current cycle. resubmitHistoryString matches the
              old "\n\n---\n\n"-separated [PENDING]/Resubmit #N contract so the
              frontend banner parser is unaffected.
  RETURNS   :
    {
      currentCycle,
      byStep: { 1:{date:Date|null, remark, actor}, 2:{…}, 3:{…} },
      previousApprovals: [{ step, email, date(formatted) }],   // approved this cycle
      approvedCount,
      latestRemark,                                            // latest decline/return remark (any cycle)
      resubmitHistory,                                         // formatted string (frozen DTO)
      hasAnyAction
    }
*/
function getApprovalView(requestId) {
  const actions = getApprovalActions(requestId);
  let currentCycle = 0;
  actions.forEach(function (a) { if (a.cycle > currentCycle) currentCycle = a.cycle; });

  const byStep = {};
  const previousApprovals = [];   // approvals of the CURRENT cycle (who has signed this round)
  const priorApprovals = [];      // approvals from EARLIER cycles (before the latest resubmit)
  let approvedCount = 0;
  let latestRemark = "";
  const historyEntries = [];

  actions.forEach(function (a) {
    // Approvals from a PRIOR cycle — used for the "you previously approved this,
    // re-review after the return" note. Empty when the request has never been
    // resubmitted (currentCycle 0), so the note can't misfire on normal progression.
    if (a.action === ACTION.APPROVED && a.cycle < currentCycle) {
      priorApprovals.push({
        step:  a.step,
        email: a.actor,
        date:  a.timestamp ? formatPHTime(new Date(a.timestamp)) : "",
      });
    }
    // Per-step date/remark for the CURRENT cycle only (mirrors AppN_Date/Remark).
    if (a.cycle === currentCycle && a.step) {
      byStep[a.step] = byStep[a.step] || { date: null, remark: "", actor: "" };
      if (a.action === ACTION.APPROVED) {
        byStep[a.step].date  = a.timestamp ? new Date(a.timestamp) : null;
        byStep[a.step].actor = a.actor;
      }
      if (a.action === ACTION.DECLINED || a.action === ACTION.RETURNED) {
        byStep[a.step].remark = a.remark;
        byStep[a.step].actor  = a.actor;
      }
    }
    // Approved actions of the current cycle == "previousApprovals" (who has signed).
    if (a.cycle === currentCycle && a.action === ACTION.APPROVED) {
      approvedCount++;
      previousApprovals.push({
        step:  a.step,
        email: a.actor,
        date:  a.timestamp ? formatPHTime(new Date(a.timestamp)) : "",
      });
    }
    // Latest decline/return remark across all cycles.
    if (a.action === ACTION.DECLINED || a.action === ACTION.RETURNED) {
      latestRemark = a.remark;
    }
    // Resubmit-history string: one entry per RETURNED action.
    if (a.action === ACTION.RETURNED) {
      const resubmitted = actions.some(function (x) {
        return x.action === ACTION.RESUBMITTED && x.cycle === a.cycle + 1;
      });
      const when   = a.timestamp ? formatPHTime(new Date(a.timestamp)) : "";
      const label  = resubmitted ? ("Resubmit #" + (a.cycle + 1) + " —") : "[PENDING]";
      historyEntries.push(
        label + " Approver " + (a.step || "?") + " (" + a.actor + ")\n" +
        "Return date: " + when + "\n" +
        "Reason: " + (a.remark || "—")
      );
    }
  });

  return {
    currentCycle:      currentCycle,
    byStep:            byStep,
    previousApprovals: previousApprovals,   // current cycle (progress / who signed this round)
    priorApprovals:    priorApprovals,      // earlier cycles (the re-review note)
    approvedCount:     approvedCount,
    latestRemark:      latestRemark,
    resubmitHistory:   historyEntries.join("\n\n---\n\n"),
    hasAnyAction:      actions.length > 0,
  };
}


// ============================================================
// APPROVAL ACTIONS — WRITE
// ============================================================
/*
  appendAction — append one row to the Activity_Log timeline (append-only).
  PARAMS : requestId; groupId (the request's group_id, denormalized for audit);
           cycle (int); step (int|null — the approver position, blank for
           submit/resubmit); actor (email); action (ACTION.*); remark (string).
  RETURNS: (void). Never updates/deletes existing rows.
*/
function appendAction(requestId, groupId, cycle, step, actor, action, remark) {
  const sheet = getSheet(SHEET_NAMES.ACTIVITY_LOG);
  const row = new Array(9).fill("");
  row[ACT.ACTION_ID - 1]      = generateActionId();
  row[ACT.REQUEST_ID - 1]     = requestId;
  row[ACT.GROUP_ID - 1]       = groupId || "";
  row[ACT.RESUBMIT_CYCLE - 1] = (cycle === null || cycle === undefined) ? 0 : cycle;
  row[ACT.APPROVER_STEP - 1]  = (step === null || step === undefined) ? "" : step;
  row[ACT.ACTOR_EMAIL - 1]    = actor;
  row[ACT.ACTION - 1]         = action;
  row[ACT.REMARK - 1]         = remark || "";
  row[ACT.TIMESTAMP - 1]      = new Date();
  sheet.appendRow(row);
}

/*
  setRequestCache — update the denormalized status/step/resubmit_count on Requests.
  LAYMAN    : Ina-update ang "cache" na column sa Requests para mabilis basahin
              ng dashboards (hindi na kailangang ipunin lahat ng actions).
  TECHNICAL : Only writes the fields provided. Source of truth stays the actions
              timeline; this keeps the cheap-read cache current.
  PARAMS    : requestId; fields — { status?, step?, resubmitCount? }.
*/
function setRequestCache(requestId, fields) {
  const sheet  = getSheet(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId(requestId);
  if (rowNum === -1) return;
  if (fields.status !== undefined)        sheet.getRange(rowNum, CR.STATUS).setValue(fields.status);
  if (fields.step !== undefined)          sheet.getRange(rowNum, CR.STEP).setValue(fields.step);
  if (fields.resubmitCount !== undefined) sheet.getRange(rowNum, CR.RESUBMIT_COUNT).setValue(fields.resubmitCount);
}
