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
      getApprovers_() 6-field shape so every downstream consumer is untouched.
    • Append-only Approval_Actions reads + a derived "view" that reconstructs the
      OLD per-step date/remark, previousApprovals, latestRemark, N-of-M, and
      resubmitHistory string — so getRequestDetail / emails / Certificate read
      identical values to before.
    • Write primitives: appendAction_() + setRequestCache_() — the only writers of
      Approval_Actions and the Requests status/step/resubmit_count cache.
    • Role: detectRole_(), isAdmin_().
    • ID generators for the new sheets.

  Depends on Utils.js (getSheet_, getDataRows_, getRowNumberByRequestId_, formatPHTime_)
  and WebApp.js (sameEmail_, normalizeEmail_). One global scope — no imports.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  ID GENERATORS
    - generateActionId_() / generateGroupId_() / generateGroupApproverId_()
  GROUPS / APPROVERS — EXECUTION-SCOPED READ CACHE
    - groupRows_() / groupApproverRows_() memoized tab reads (one per execution)
    - invalidateGroupCaches_()            drop both memos after any write
  GROUPS / APPROVERS
    - getGroupApprovers_(groupId)         ordered active approver rows
    - getApprovers_(groupId)              legacy 6-field shape (compat)
    - getCurrentApprover_(step, groupId)  email at a given sequence
    - getGroupById_ / getGroupNameById_ / getGroupIdByName
    - getApproverGroups()                [{id, name}] for the form dropdown
  GROUPS / APPROVERS — ADMIN (read incl. inactive + write primitives)
    - getAllGroups_()                     all groups incl. inactive
    - getGroupChain_(groupId)             active chain rows, full fields
    - createGroup_(name)                  append a Groups row
    - updateGroupFields_(groupId, fields) in-place name/active update
    - replaceGroupChain_(groupId, slots)  in-place update (append on grow, deactivate on shrink)
    - appendAdminLog_(admin, action, gid, details)  audit an admin action
  ROLE
    - detectRole_(email) / isAdmin_(email)
  APPROVAL ACTIONS (read)
    - getApprovalActions_(requestId)      raw timeline rows
    - getApprovalView_(requestId)         derived per-step/history view (frozen-DTO source)
  APPROVAL ACTIONS (write)
    - appendAction_(requestId, groupId, cycle, step, actor, action, remark)
    - setRequestCache_(requestId, {status, step, resubmitCount})
*/


// ============================================================
// ID GENERATORS
// ============================================================
/* generateActionId_ — unique Approval_Actions key (e.g. "ACT-1A2B3C4D"). */
function generateActionId_() {
  return "ACT-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
}
/* generateGroupApproverId_ — unique Group_Approvers key (e.g. "GA-1A2B3C4D"). */
function generateGroupApproverId_() {
  return "GA-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
}
/* generateCocId_ — unique COC_PDFs key (e.g. "COC-1A2B3C4D"). */
function generateCocId_() {
  return "COC-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
}
/* generateAdminLogId_ — unique Admins_Log key (e.g. "ADL-1A2B3C4D"). */
function generateAdminLogId_() {
  return "ADL-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
}
/*
  generateGroupId_ — next sequential group id "G###".
  LAYMAN    : Susunod na G001, G002, … base sa pinakamataas na meron.
  TECHNICAL : Scans Groups for the max G\d+ and returns max+1 zero-padded to 3.
*/
function generateGroupId_() {
  const rows = getDataRows_(SHEET_NAMES.GROUPS);
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r[GRP.GROUP_ID - 1] || "").match(/^G(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "G" + String(max + 1).padStart(3, "0");
}


// ============================================================
// GROUPS / APPROVERS — EXECUTION-SCOPED READ CACHE
// ============================================================
/*
  LAYMAN (Tropang Ex):
  Yung Groups at Group_Approvers ay maliliit na talaan na paulit-ulit binabasa.
  Dati, tuwing kailangan ang pangalan ng group o kung sino ang approver, binabasa
  ang BUONG tab mula sa Google Sheets. Sa isang dashboard na may 50 requests,
  50 beses na buong pagbasa yun para sa parehong data. Ngayon, isang basa lang
  bawat execution, tapos gagamitin na lang ulit.

  TECHNICAL:
  Memoized readers for the two small, rarely-written lookup tables, mirroring the
  SCRIPT_PROPS_CACHE_ / scriptProps_() pattern in Constants.js. Apps Script
  discards globals between executions, so the cache lives exactly one execution
  and there is no cross-request staleness to reason about.

  ⚠️ DELIBERATELY LIMITED TO THESE TWO SHEETS. Requests and Activity_Log are NOT
  memoized: both have genuine read-after-write patterns inside a single execution
  (submitNewRequest appends a row then re-resolves it by ID for rollback;
  checkContractExpiries appends EXPIRY_* rows mid-loop). A stale cache there
  would be a correctness bug, not an optimization.

  ⚠️ THE RULE: read-only paths use these; WRITE paths read fresh and then call
  invalidateGroupCaches_(). generateGroupId_/updateGroupFields_/replaceGroupChain_
  deliberately keep their raw getDataRows_ calls because they compute sheet row
  numbers for an imminent write and run inside a lock.

  This is what keeps adminSaveChain's post-write getGroupChain_() re-read and
  notifyChainChanges_'s getCurrentApprover_() calls honest.
*/
var GROUPS_CACHE_ = null;
var GROUP_APPROVERS_CACHE_ = null;

/* groupRows_ — memoized data rows of the Groups tab (one read per execution). */
function groupRows_() {
  if (GROUPS_CACHE_ === null) GROUPS_CACHE_ = getDataRows_(SHEET_NAMES.GROUPS);
  return GROUPS_CACHE_;
}

/* groupApproverRows_ — memoized data rows of the Group_Approvers tab. */
function groupApproverRows_() {
  if (GROUP_APPROVERS_CACHE_ === null) GROUP_APPROVERS_CACHE_ = getDataRows_(SHEET_NAMES.GROUP_APPROVERS);
  return GROUP_APPROVERS_CACHE_;
}

/*
  invalidateGroupCaches_ — drop both memos so the next read hits the sheet.
  LAYMAN    : Tawagin ito pagkatapos magsulat sa Groups o Group_Approvers, para
              yung susunod na magbabasa ay makita ang bagong laman, hindi yung luma.
  TECHNICAL : Call after ANY write to either tab. Cheap (two null assignments).
              When in doubt, invalidate: a redundant call costs one sheet read,
              a missing one serves stale data for the rest of the execution.
*/
function invalidateGroupCaches_() {
  GROUPS_CACHE_ = null;
  GROUP_APPROVERS_CACHE_ = null;
}


// ============================================================
// GROUPS / APPROVERS
// ============================================================
/*
  getGroupApprovers_ — ordered active approvers for a group_id.
  RETURNS : [{ sequence, email, designation }] sorted by sequence (active only).
*/
function getGroupApprovers_(groupId) {
  const target = String(groupId);
  return groupApproverRows_()
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
  getApprovers_ — LEGACY 6-field shape from the first 3 sequences.
  LAYMAN    : Para hindi masira ang lahat ng lumang code na umaasa sa
              {approver1/2/3, designation1/2/3}, binubuo natin ito mula sa
              unang 3 sequences ng Group_Approvers.
  TECHNICAL : Preserves the exact return shape of the old Utils.getApprovers_ so
              approve_() skip-blank, Certificate signatories, buildApprovalLog_,
              N-of-M, isChainApprover_, and the detail DTO all keep working.
  RETURNS   : { approver1, designation1, approver2, designation2, approver3,
              designation3 } or null if the group has no approvers.
*/
function getApprovers_(groupId) {
  const list = getGroupApprovers_(groupId);
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
  getCurrentApprover_ — email of the approver at a given step (sequence).
  PARAMS  : step — 1-based sequence (0 → null, returned to requestor);
            groupId — the group_id FK.
  RETURNS : email string or null.
*/
function getCurrentApprover_(step, groupId) {
  if (!step || step === 0) return null;
  const match = getGroupApprovers_(groupId).find(function (a) { return a.sequence === step; });
  return match ? match.email : null;
}

/* getGroupById_ — raw Groups row (0-indexed array) or null. */
function getGroupById_(groupId) {
  const target = String(groupId);
  return groupRows_()
    .find(function (r) { return String(r[GRP.GROUP_ID - 1]) === target; }) || null;
}
/* getGroupNameById_ — display name for a group_id ("" if not found). */
function getGroupNameById_(groupId) {
  const g = getGroupById_(groupId);
  return g ? g[GRP.GROUP_NAME - 1] : "";
}
/* getGroupIdByName_ — group_id for a display name ("" if not found). Transitional.
   Trailing underscore: unreferenced today, and name→id resolution is a lookup an
   unprivileged caller has no reason to perform. Kept (not deleted) because the
   group rename flow is a plausible future caller. */
function getGroupIdByName_(name) {
  const m = groupRows_()
    .find(function (r) { return r[GRP.GROUP_NAME - 1] === name; });
  return m ? m[GRP.GROUP_ID - 1] : "";
}
/*
  getApproverGroups — selectable groups for the new-request dropdown.
  LAYMAN    : Mga group na PWEDENG piliin ng requestor — active AT may kahit
              isang approver. Kung walang approver pa ang group, hindi ito
              lalabas (kung hindi, masa-submit sa wala, ma-stuck habambuhay).
              Makikita pa rin ito ng admin (naka-flag na "no chain").
  TECHNICAL : Filters GRP.ACTIVE AND ≥1 active Group_Approvers row. The
              has-approver set is built in one pass over GROUP_APPROVERS.
  RETURNS   : [{ id, name }] (selectable groups only). NOTE: shape is objects,
              not string[] — the frontend dropdown matches.
*/
function getApproverGroups() {
  const hasApprover = {};
  groupApproverRows_().forEach(function (r) {
    if (String(r[GAP.ACTIVE - 1]).toUpperCase() !== "FALSE" && r[GAP.GROUP_ID - 1]) {
      hasApprover[String(r[GAP.GROUP_ID - 1])] = true;
    }
  });
  return groupRows_()
    .filter(function (r) {
      return r[GRP.GROUP_ID - 1] &&
             String(r[GRP.ACTIVE - 1]).toUpperCase() !== "FALSE" &&
             hasApprover[String(r[GRP.GROUP_ID - 1])];
    })
    .map(function (r) { return { id: r[GRP.GROUP_ID - 1], name: r[GRP.GROUP_NAME - 1] }; });
}


// ============================================================
// GROUPS / APPROVERS — ADMIN
// Read-incl.-inactive + write primitives for the admin page.
// MECHANICAL ONLY — validation/policy lives in Admin.js callables.
// ============================================================
/*
  getAllGroups_ — every Groups row, INCLUDING inactive.
  LAYMAN    : Lahat ng groups, pati yung naka-deactivate — para makita at
              ma-manage ng admin. (Ang getApproverGroups ay active lang,
              para sa new-request dropdown — huwag itong galawin.)
  TECHNICAL : Same projection as getApproverGroups plus active/createdAt;
              no ACTIVE filter.
  RETURNS   : [{ id, name, active(bool), createdAt(Date|"") }].
*/
function getAllGroups_() {
  return groupRows_()
    .filter(function (r) { return r[GRP.GROUP_ID - 1]; })
    .map(function (r) {
      return {
        id:        r[GRP.GROUP_ID - 1],
        name:      r[GRP.GROUP_NAME - 1] || "",
        active:    String(r[GRP.ACTIVE - 1]).toUpperCase() !== "FALSE",
        createdAt: r[GRP.CREATED_AT - 1] || "",
      };
    });
}

/*
  getGroupChain_ — active chain rows for a group, ALL fields.
  LAYMAN    : Yung kasalukuyang buhay na approver chain ng isang group, kasama
              ang row id at active flag — para sa chain editor ng admin.
  TECHNICAL : Superset of getGroupApprovers_' 3-field shape (adds id + active).
              Active rows only — deactivated rows are audit history, not the
              editable chain.
  RETURNS   : [{ id, sequence, email, designation, active }] sorted by sequence.
*/
function getGroupChain_(groupId) {
  const target = String(groupId);
  return groupApproverRows_()
    .filter(function (r) {
      return String(r[GAP.GROUP_ID - 1]) === target &&
             String(r[GAP.ACTIVE - 1]).toUpperCase() !== "FALSE";
    })
    .map(function (r) {
      return {
        id:          r[GAP.ID - 1],
        sequence:    parseInt(r[GAP.SEQUENCE - 1], 10) || 0,
        email:       r[GAP.APPROVER_EMAIL - 1] || "",
        designation: r[GAP.DESIGNATION - 1] || "",
        active:      true,
      };
    })
    .sort(function (a, b) { return a.sequence - b.sequence; });
}

/*
  createGroup_ — append a new Groups row.
  LAYMAN    : Magdagdag ng bagong group sa registry. Walang validation dito —
              ang Admin.js ang nagche-check ng pangalan bago tumawag.
  TECHNICAL : generateGroupId_() surrogate PK; ACTIVE defaults TRUE.
  PARAMS    : name — display name (caller has already validated/trimmed).
  RETURNS   : { id, name } of the new group.
*/
function createGroup_(name) {
  // Direct-call guard: this mechanical writer is reachable via google.script.run,
  // so it verifies admin identity itself rather than trusting the adminCreateGroup
  // wrapper. The lock makes generateGroupId_()'s max+1 scan collision-safe under
  // concurrent creates.
  if (!isAdmin_(Session.getActiveUser().getEmail())) throw new Error("Unauthorized");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(SHEET_NAMES.GROUPS);
    const id    = generateGroupId_();
    const row   = new Array(4).fill("");
    row[GRP.GROUP_ID - 1]   = id;
    row[GRP.GROUP_NAME - 1] = name;
    row[GRP.ACTIVE - 1]     = "TRUE";
    row[GRP.CREATED_AT - 1] = new Date();
    sheet.appendRow(row);
    invalidateGroupCaches_();   // the new group must be visible to later reads this execution
    return { id: id, name: name };
  } finally {
    lock.releaseLock();
  }
}

/*
  updateGroupFields_ — in-place update of a Groups row (name and/or active).
  LAYMAN    : Palitan ang pangalan o i-on/off ang group. Safe ang rename dahil
              group_id ang naka-FK sa requests, hindi ang pangalan.
  TECHNICAL : Only writes the fields provided (setRequestCache_ style). active
              is stored as "TRUE"/"FALSE" strings to match the seeded sheet.
  PARAMS    : groupId; fields — { name?, active?(bool) }.
  RETURNS   : true if the row was found and updated, false otherwise.
*/
function updateGroupFields_(groupId, fields) {
  // Direct-call guard (reachable via google.script.run — see createGroup_).
  if (!isAdmin_(Session.getActiveUser().getEmail())) throw new Error("Unauthorized");
  const sheet  = getSheet_(SHEET_NAMES.GROUPS);
  const rows   = getDataRows_(SHEET_NAMES.GROUPS);
  const target = String(groupId);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][GRP.GROUP_ID - 1]) === target) {
      const rowNum = i + 2; // +1 header, +1 1-based
      if (fields.name !== undefined)   sheet.getRange(rowNum, GRP.GROUP_NAME).setValue(fields.name);
      if (fields.active !== undefined) sheet.getRange(rowNum, GRP.ACTIVE).setValue(fields.active ? "TRUE" : "FALSE");
      // adminSetGroupActive reads the group name AFTER this call for its audit
      // line, so the memo has to drop here or that line reads pre-edit values.
      invalidateGroupCaches_();
      return true;
    }
  }
  return false;
}

/*
  Function Name: replaceGroupChain_

  LAYMAN (Tropang Ex):
  I-update ang approver chain ng isang group nang IN-PLACE: kung pumalit lang ang
  email o nagbago ang pagkakasunod (reorder), babaguhin lang ang VALUES ng mga
  dati nang rows — WALANG bagong row, WALANG tombstone. Magdadagdag lang ng row
  kapag may DINAGDAG na approver; magmamarka lang ng inactive kapag may TINANGGAL.
  Dating buong-palit ito (bagong rows + inactive na luma), pero dahil may
  Admins_Log na tayo na may diff + timestamp, redundant na ang tombstone rows —
  kaya in-place na (mas malinis ang sheet).

  TECHNICAL:
  Position-matched in-place update under LockService.getScriptLock(). The k-th
  existing ACTIVE row (in sequence order) is reused for the k-th new slot — one
  batched setValues over the contiguous SEQUENCE/EMAIL/DESIGNATION cols (3-4-5),
  keeping its GAP.ID stable. Grow → append the extra rows; shrink → set the
  leftover old rows ACTIVE=FALSE (rare; the only remaining tombstone case).
  Server assigns sequences 1..N from array order — client numbers never trusted.
  No row deletion → existing row indices stay valid through the whole pass.

  PARAMS:
  - groupId — the group whose chain is updated.
  - slots — [{ email, designation }] in desired order (caller has validated).

  RETURNS:
  (void). Throws if the script lock cannot be acquired within 10s.

  STEPS
    Step 1 — Lock + collect existing ACTIVE rows (sequence order)
      Layman    : Pila muna; tipunin ang kasalukuyang approver rows ng group.
      Technical : waitLock(10000); scan Group_Approvers for this group's active
                  rows + their sheet row numbers; sort by sequence.
    Step 2 — Reuse rows positionally / append the surplus
      Layman    : Bawat bagong slot, gamitin ang dating row sa parehong pwesto
                  (palitan lang ang seq/email/designation). Kung kulang, magdagdag.
      Technical : For k<existing: setValues([[k+1,email,desig]]) on cols 3-5;
                  for k≥existing: collect a fresh 6-col row to append in one batch.
    Step 3 — Deactivate leftover rows (shrink only)
      Layman    : Kung umikli ang chain, markahan FALSE ang sobrang lumang rows.
      Technical : setValue(GAP.ACTIVE,"FALSE") for k = n .. existing-1.
    Step 4 — Release the lock (finally)

  EXAMPLE
    // reorder [A(1),B(2)] → [B(1),A(2)]
    replaceGroupChain_("G001", [{email:"b@x.com"}, {email:"a@x.com"}])
    → SAME two rows, emails swapped; no new rows, no inactive rows.
    // add C
    replaceGroupChain_("G001", [{email:"a@x.com"},{email:"b@x.com"},{email:"c@x.com"}])
    → rows 1–2 unchanged; ONE new row seq 3 (C).
*/
function replaceGroupChain_(groupId, slots) {
  // Direct-call guard (reachable via google.script.run — see createGroup_).
  // Without this, any authenticated user could rewrite a group's approver chain.
  if (!isAdmin_(Session.getActiveUser().getEmail())) throw new Error("Unauthorized");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet  = getSheet_(SHEET_NAMES.GROUP_APPROVERS);
    const data   = getDataRows_(SHEET_NAMES.GROUP_APPROVERS);
    const target = String(groupId);

    // Existing ACTIVE rows for this group, with sheet row numbers, in sequence order.
    const activeRows = [];
    data.forEach(function (r, i) {
      if (String(r[GAP.GROUP_ID - 1]) === target &&
          String(r[GAP.ACTIVE - 1]).toUpperCase() !== "FALSE") {
        activeRows.push({ rowNum: i + 2, sequence: parseInt(r[GAP.SEQUENCE - 1], 10) || 0 });
      }
    });
    activeRows.sort(function (a, b) { return a.sequence - b.sequence; });

    const n = slots.length;
    const appends = [];
    for (let k = 0; k < n; k++) {
      if (k < activeRows.length) {
        // Reuse the existing row at position k — overwrite SEQUENCE/EMAIL/
        // DESIGNATION (contiguous cols 3-4-5) in place. ID + ACTIVE untouched.
        sheet.getRange(activeRows[k].rowNum, GAP.SEQUENCE, 1, 3)
             .setValues([[k + 1, slots[k].email, slots[k].designation || ""]]);
      } else {
        const row = new Array(6).fill("");
        row[GAP.ID - 1]             = generateGroupApproverId_();
        row[GAP.GROUP_ID - 1]       = groupId;
        row[GAP.SEQUENCE - 1]       = k + 1;
        row[GAP.APPROVER_EMAIL - 1] = slots[k].email;
        row[GAP.DESIGNATION - 1]    = slots[k].designation || "";
        row[GAP.ACTIVE - 1]         = "TRUE";
        appends.push(row);
      }
    }

    // Shrink: deactivate leftover old rows beyond the new length.
    for (let k = n; k < activeRows.length; k++) {
      sheet.getRange(activeRows[k].rowNum, GAP.ACTIVE).setValue("FALSE");
    }

    if (appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, 6).setValues(appends);
    }
  } finally {
    // Inside the finally so the memo is dropped even on a partial write: serving
    // a pre-edit chain after a half-applied change would be worse than a re-read.
    // adminSaveChain immediately re-reads via getGroupChain_() and notifies via
    // getCurrentApprover_(), and both must observe the new chain.
    invalidateGroupCaches_();
    lock.releaseLock();
  }
}

/*
  appendAdminLog_ — append one row to the Admins_Log audit timeline (append-only).
  LAYMAN    : Itala ang ginawa ng admin: sino, ano, aling group, ano ang nabago,
              kailan. Hindi binubura. Hiwalay sa Activity_Log (iba ang klase).
  TECHNICAL : Mechanical writer (mirror of appendAction_). Never updates/deletes.
              No-op-safe: blank details allowed. Called from Admin.js mutations.
  PARAMS    : adminEmail; action (ADMIN_ACTION.*); targetGroupId; details (string).
  RETURNS   : (void).
*/
function appendAdminLog_(adminEmail, action, targetGroupId, details) {
  // Self-heal the audit tab: create Admins_Log (with headers) if it is missing,
  // so a forgotten go-live step cannot silently drop the admin audit trail.
  let sheet;
  try { sheet = ensureAdminsLogTab_(); }
  catch (e) { Logger.log("appendAdminLog_(): could not ensure Admins_Log tab — " + e); return; }
  const row = new Array(6).fill("");
  row[ADL.LOG_ID - 1]       = generateAdminLogId_();
  row[ADL.ADMIN_EMAIL - 1]  = adminEmail || "";
  row[ADL.ACTION - 1]       = action || "";
  row[ADL.TARGET_GROUP - 1] = targetGroupId || "";
  row[ADL.DETAILS - 1]      = details || "";
  row[ADL.TIMESTAMP - 1]    = new Date();
  sheet.appendRow(row);
}

/*
  ensureAdminsLogTab_ — return the Admins_Log sheet, creating it with headers if
  the tab does not exist yet.
  LAYMAN    : Kung wala pang "Admins_Log" tab, gagawin ito kasama ang headers,
              para hindi tahimik na mawala ang admin audit trail kung nakalimutang
              gawin nang mano-mano sa go-live.
  TECHNICAL : insertSheet + header row when missing; returns the existing sheet
              otherwise. Called by appendAdminLog_ so the audit self-heals.
  RETURNS   : the Admins_Log Sheet object.
*/
function ensureAdminsLogTab_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.ADMINS_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.ADMINS_LOG);
    sheet.appendRow(["log_id", "admin_email", "action", "target_group", "details", "timestamp"]);
  }
  return sheet;
}


// ============================================================
// ROLE
// ============================================================
/*
  detectRole_ — classify a caller as "approver" or "requestor".
  LAYMAN    : Approver ka kung nasa Group_Approvers ang email mo kahit saang
              group. (Ang admin role ay hiwalay na phase — gamitin isAdmin_().)
  TECHNICAL : Scans Group_Approvers.approver_email. Admin is intentionally NOT
              returned here yet (admin UI is a later phase); isAdmin_() exists
              for when it is wired.
*/
function detectRole_(email) {
  if (!email) return "requestor";
  const rows = groupApproverRows_();
  for (let i = 0; i < rows.length; i++) {
    if (sameEmail_(rows[i][GAP.APPROVER_EMAIL - 1], email)) return "approver";
  }
  return "requestor";
}

/*
  isAdmin_ — is this email an active admin?
  TECHNICAL : Scans the Admins allowlist (active only). Server-side identity
              only — never trust a role flag from the frontend.
*/
function isAdmin_(email) {
  if (!email) return false;
  return getDataRows_(SHEET_NAMES.ADMINS).some(function (r) {
    return sameEmail_(r[ADM.EMAIL - 1], email) &&
           String(r[ADM.ACTIVE - 1]).toUpperCase() !== "FALSE";
  });
}


// ============================================================
// APPROVAL ACTIONS — READ
// ============================================================
/*
  getApprovalActions_ — the raw append-only timeline for a request.
  RETURNS : [{ actionId, requestId, cycle, step, actor, action, remark, timestamp }]
            in append (≈ chronological) order.
*/
function getApprovalActions_(requestId) {
  const target = String(requestId);
  return getDataRows_(SHEET_NAMES.ACTIVITY_LOG)
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
  Function Name: getExpiryFlagMap_

  LAYMAN (Tropang Ex):
  Isang beses lang basahin ang BUONG Activity_Log, tapos gagawa ng "checklist"
  kung aling request na ang napadalhan na ng expiry reminder (T-3, day-of, o
  lumipas na). Dati, bawat request may sariling buong pagbabasa ng Activity_Log
  — sobrang mabagal kapag dumami na (nag-6-minutong limit ng Apps Script sa mga
  1,450 requests). Ngayon, isang basa lang para sa lahat.

  TECHNICAL:
  ONE full Activity_Log scan reduced to a lookup map for the daily expiry sweep,
  replacing an O(N) getApprovalActions_() call per approved row (O(N²) overall).
  Only the three system EXPIRY_* actions are indexed — workflow actions are
  irrelevant to expiry idempotency and are skipped.

  ⚠️ Predicate parity with the code this replaces is deliberate and must hold:
  same String() coercion on request_id, same `|| ""` on the action cell, same
  strict === comparison against the ACTION.EXPIRY_* constants, and NO trimming
  or case-folding (adding either would change behaviour on malformed rows).

  ⚠️ Callers that append EXPIRY_* rows mid-loop MUST mirror the write into this
  map (see markExpiryFlag_ in Triggers.js), because a snapshot taken before the
  loop cannot see rows written during it, whereas the old per-row re-scan could.

  PARAMS:
  (none)

  RETURNS:
  { "<requestId>": { "expiry_warning": true, "expiry_notice": true, "expiry_overdue": true } }
  Only keys/flags that actually exist are present; look up with String(requestId)
  and default to {} for requests with no expiry history.

  EXAMPLE
    getExpiryFlagMap_()
    → { "REQ-1A2B": { "expiry_warning": true },
        "REQ-9C8D": { "expiry_warning": true, "expiry_overdue": true } }
*/
function getExpiryFlagMap_() {
  const map = {};
  getDataRows_(SHEET_NAMES.ACTIVITY_LOG).forEach(function (r) {
    const act = r[ACT.ACTION - 1] || "";
    if (act !== ACTION.EXPIRY_WARNING &&
        act !== ACTION.EXPIRY_NOTICE  &&
        act !== ACTION.EXPIRY_OVERDUE) return;
    const id = String(r[ACT.REQUEST_ID - 1]);
    if (!map[id]) map[id] = {};
    map[id][act] = true;
  });
  return map;
}

/*
  getApprovalView_ — derived view that reconstructs the OLD shapes from actions.
  LAYMAN    : Mula sa listahan ng actions, binubuo nito ang mga lumang field na
              inaasahan ng UI/email/COC: petsa+remark kada step, previousApprovals,
              pinakabagong remark, bilang ng aprubado, at ang resubmitHistory
              string. Kaya hindi nagbago ang DTO.
  TECHNICAL : Single pass over getApprovalActions_. "Current cycle" = max cycle.
              byStep covers the current cycle. resubmitHistoryString matches the
              old "\n\n---\n\n"-separated [PENDING]/Resubmit #N contract so the
              frontend banner parser is unaffected.
  RETURNS   :
    {
      currentCycle,
      byStep: { 1:{date:Date|null, remark, actor}, 2:{…}, 3:{…} },
      previousApprovals: [{ step, email, date(formatted) }],   // approved this cycle
      approvedCount,
      latestRemark,                                            // latest decline_/return remark (any cycle)
      resubmitHistory,                                         // formatted string (frozen DTO)
      hasAnyAction
    }
*/
function getApprovalView_(requestId) {
  const actions = getApprovalActions_(requestId);
  let currentCycle = 0;
  actions.forEach(function (a) { if (a.cycle > currentCycle) currentCycle = a.cycle; });

  const byStep = {};
  const previousApprovals = [];   // approvals of the CURRENT cycle (who has signed this round)
  const priorApprovals = [];      // approvals from EARLIER cycles (before the latest resubmit_)
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
        date:  a.timestamp ? formatPHTime_(new Date(a.timestamp)) : "",
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
        date:  a.timestamp ? formatPHTime_(new Date(a.timestamp)) : "",
      });
    }
    // Latest decline_/return remark across all cycles.
    if (a.action === ACTION.DECLINED || a.action === ACTION.RETURNED) {
      latestRemark = a.remark;
    }
    // Resubmit-history string: one entry per RETURNED action.
    if (a.action === ACTION.RETURNED) {
      const resubmitted = actions.some(function (x) {
        return x.action === ACTION.RESUBMITTED && x.cycle === a.cycle + 1;
      });
      const when   = a.timestamp ? formatPHTime_(new Date(a.timestamp)) : "";
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
  appendAction_ — append one row to the Activity_Log timeline (append-only).
  PARAMS : requestId; groupId (the request's group_id, denormalized for audit);
           cycle (int); step (int|null — the approver position, blank for
           submit/resubmit_); actor (email); action (ACTION.*); remark (string).
  RETURNS: (void). Never updates/deletes existing rows.
*/
function appendAction_(requestId, groupId, cycle, step, actor, action, remark) {
  const sheet = getSheet_(SHEET_NAMES.ACTIVITY_LOG);
  const row = new Array(9).fill("");
  row[ACT.ACTION_ID - 1]      = generateActionId_();
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
  setRequestCache_ — update the denormalized status/step/resubmit_count on Requests.
  LAYMAN    : Ina-update ang "cache" na column sa Requests para mabilis basahin
              ng dashboards (hindi na kailangang ipunin lahat ng actions).
  TECHNICAL : Only writes the fields provided. Source of truth stays the actions
              timeline; this keeps the cheap-read cache current.
  PARAMS    : requestId; fields — { status?, step?, resubmitCount? }.
*/
function setRequestCache_(requestId, fields) {
  const sheet  = getSheet_(SHEET_NAMES.REQUESTS);
  const rowNum = getRowNumberByRequestId_(requestId);
  if (rowNum === -1) return;
  if (fields.status !== undefined)        sheet.getRange(rowNum, CR.STATUS).setValue(fields.status);
  if (fields.step !== undefined)          sheet.getRange(rowNum, CR.STEP).setValue(fields.step);
  if (fields.resubmitCount !== undefined) sheet.getRange(rowNum, CR.RESUBMIT_COUNT).setValue(fields.resubmitCount);
}
