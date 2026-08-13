// Admin.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Admin.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Lahat ng kayang gawin ng ADMIN sa portal, nandito: makita LAHAT ng requests
  (kahit hindi siya ang requestor o approver), at i-manage ang mga groups at
  approver chains nang hindi binubuksan ang spreadsheet. Bawat function dito,
  unang tanong palagi: "Admin ka ba talaga?" — base sa Admins sheet, hindi sa
  kung ano ang sinasabi ng frontend. Kung hindi admin → Unauthorized agad,
  bago pa man gumalaw ang kahit ano.

  TECHNICAL:
  Tier-2 admin callables (oversight + group/chain CRUD; NO request
  intervention). Every callable resolves the caller via
  Session.getActiveUser().getEmail() and guards with isAdmin_() BEFORE any
  read/write — list getters return [] on failure, mutations return
  { success:false, error:"Unauthorized" }. All sheet access goes through the
  Accessors.js seam (getAllGroups_/getGroupChain_/createGroup_/updateGroupFields_/
  replaceGroupChain_/appendAdminLog_); this file owns validation + policy only.
  Every mutation is audited to Admins_Log (appendAdminLog_). One email path
  exists: a chain change notifies whoever NEWLY becomes the current handler of
  an in-flight request (notifyChainChanges_) — covers add / replace / reorder;
  create / rename / activate are silent.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  READS
    - adminGetAllRequests()             every request row (dashboard DTO)
    - adminGetGroups()                  all groups + chain/pending stats
    - adminGetGroupChain(groupId)       active chain for the editor
  GROUP MUTATIONS
    - adminCreateGroup(name)            new group (unique name)
    - adminRenameGroup(groupId, name)   rename (routing-safe; surrogate PK)
    - adminSetGroupActive(groupId, on)  show/hide in the new-request dropdown
  CHAIN MUTATION
    - adminSaveChain(groupId, slots)    whole-chain replace (validated)
  INTERNAL
    - adminGuard_()                     caller email if admin, null otherwise
    - validGroupName_(name, excludeId)  duplicate-name check
    - pendingRowsForGroup_(gid)         the group's PENDING_* request rows
    - notifyChainChanges_(gid, oldSeqByEmail, oldCurrentByReq)  email new current-approvers
    - chainDiffDetails_(oldChain, newChain)             before→after audit string
    - chainChangeAction_(oldChain, newChain)            classify add/remove/replace/reorder
*/


// ============================================================
// INTERNAL GUARDS
// ============================================================
/*
  adminGuard_ — resolve the caller and verify admin status.
  LAYMAN    : Sino ang tumatawag, at admin ba siya? Email kung oo, null kung hindi.
  TECHNICAL : Session identity + isAdmin_() (Accessors.js). Every callable in
              this file starts here — frontend visibility is NOT authority.
  RETURNS   : caller email string, or null if not an active admin.
*/
function adminGuard_() {
  const caller = Session.getActiveUser().getEmail();
  return isAdmin_(caller) ? caller : null;
}

/*
  validGroupName_ — is this name non-blank, within length, safe, and unused?
  LAYMAN    : May laman ba ang pangalan, hindi sobrang haba, hindi nagsisimula
              sa "=", at wala pa bang ibang group (kahit inactive) na ganito ang
              pangalan? Case-insensitive ang banggaan.
  TECHNICAL : Length cap matches the client maxlength=80 (which is UX, not a
              control — adminCreateGroup/adminRenameGroup are directly callable
              via google.script.run, so the server cap here is the real one).
              startsWithFormula_ blocks a formula-injection write into
              GRP.GROUP_NAME. Uniqueness compares trimmed lowercase against ALL
              groups (incl. inactive — reactivating later must not collide).
              excludeId skips self on rename.
  PARAMS    : name — candidate display name; excludeId — group_id to skip (rename).
  RETURNS   : { ok:true, name:<trimmed> } or { ok:false, error }.
*/
function validGroupName_(name, excludeId) {
  const MAX_GROUP_NAME = 80;   // keep in sync with maxlength in Admin.html
  const trimmed = String(name || "").trim();
  if (!trimmed) return { ok: false, error: "Group name is required." };
  if (trimmed.length > MAX_GROUP_NAME) {
    return { ok: false, error: "Group name is too long (max " + MAX_GROUP_NAME + " characters)." };
  }
  if (startsWithFormula_(trimmed)) {
    return { ok: false, error: 'Group name must not start with "=".' };
  }
  const lower = trimmed.toLowerCase();
  const clash = getAllGroups_().some(function (g) {
    return g.id !== excludeId && String(g.name).trim().toLowerCase() === lower;
  });
  if (clash) return { ok: false, error: 'A group named "' + trimmed + '" already exists.' };
  return { ok: true, name: trimmed };
}

/*
  pendingRowsForGroup_ — the group's in-flight requests (PENDING_1/2/3).
  RETURNS : array of 0-indexed Requests rows. Used by the chain-change notifier
            to compute who is the current approver of each live request.
*/
function pendingRowsForGroup_(groupId) {
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];
  const target  = String(groupId);
  return getDataRows_(SHEET_NAMES.REQUESTS).filter(function (row) {
    return String(row[CR.GROUP - 1]) === target && pending.includes(row[CR.STATUS - 1]);
  });
}

/*
  Function Name: notifyChainChanges_

  LAYMAN (Tropang Ex):
  Pagkatapos i-save ang bagong chain, ito ang nagpapadala ng "ikaw na ngayon ang
  approver" email. HINDI lang sa bagong dagdag — kundi sa kahit sinong NAGING
  bagong humahawak ng isang buhay na request dahil sa pagbabago. Kaya kahit
  REORDER lang (hal. ginawang Approver 1 si dating Approver 2 habang may request
  na nasa step 1), maa-notify ang bagong humahawak — dati hindi. Ang pure
  designation rename ay walang ipapadala (walang nagbagong humahawak).

  TECHNICAL:
  Current-approver-change trigger, not membership. Recipients =
  {emails newly in the chain} ∪ {new current-approver of any PENDING_* request
  whose current-approver changed}. oldCurrentByReq is captured BEFORE
  replaceGroupChain_; new current-approver is read AFTER. Each recipient gets
  their sequence in the NEW chain ("You are Approver N") + the rows they newly
  hold. This is the only email path from an admin action; the caller wraps it in
  try/catch so an email failure never reports the committed save as failed.

  PARAMS:
  - groupId — the group whose chain was just replaced.
  - oldSeqByEmail — { normalizedEmail: oldSequence } of chain approvers BEFORE the
                    save. Key presence = membership; the value = their prior position
                    (so the email can say "you were Approver M, now Approver N").
  - oldCurrentByReq — { requestId: currentApproverEmail } per pending row, BEFORE the save.

  RETURNS:
  (void).
*/
function notifyChainChanges_(groupId, oldSeqByEmail, oldCurrentByReq) {
  const groupName = getGroupNameById_(groupId);
  const newChain  = getGroupChain_(groupId);

  // sequence lookup by normalized email (for the "You are Approver N" line)
  const seqByEmail = {};
  newChain.forEach(function (slot) { seqByEmail[normalizeEmail_(slot.email)] = slot.sequence; });

  // Bucket the now-current pending rows by the approver who NEWLY holds them.
  const rowsByRecipient = {};   // normalizedEmail -> [rows]
  const emailByKey      = {};   // normalizedEmail -> display email
  pendingRowsForGroup_(groupId).forEach(function (row) {
    const reqId      = String(row[CR.REQUEST_ID - 1]);
    const newCurrent = getCurrentApprover_(row[CR.STEP - 1], groupId);
    if (!newCurrent) return;
    if (sameEmail_(newCurrent, oldCurrentByReq[reqId])) return; // same handler — no change
    const key = normalizeEmail_(newCurrent);
    (rowsByRecipient[key] = rowsByRecipient[key] || []).push(row);
    emailByKey[key] = newCurrent;
  });

  // Recipients: anyone newly in the chain, OR anyone who newly became a current handler.
  const recipients = {};
  newChain.forEach(function (slot) {
    const key = normalizeEmail_(slot.email);
    if (oldSeqByEmail[key] === undefined) recipients[key] = slot.email; // brand-new to the chain
  });
  Object.keys(rowsByRecipient).forEach(function (key) { recipients[key] = emailByKey[key]; });

  Object.keys(recipients).forEach(function (key) {
    const email       = recipients[key];
    const newStep     = seqByEmail[key] || null;
    const prevStep    = (oldSeqByEmail[key] === undefined) ? null : oldSeqByEmail[key];
    // Per-recipient isolation: one failed notice (bad address, transient error)
    // must not suppress the notices to the other new approvers.
    try {
      sendNewApproverNotice_(email, groupName, newStep, prevStep, rowsByRecipient[key] || []);
    } catch (e) {
      Logger.log("notifyChainChanges_(): notice to " + email + " failed — " + e);
    }
  });
}

/*
  chainDiffDetails_ — human-readable before→after chain string for the audit log.
  LAYMAN    : Para sa Admins_Log: "ano ang dating chain → ano ang bago," kasama
              ang designation kung meron — para makita kaagad ang nabago (palit,
              dagdag, tanggal, o reorder).
  TECHNICAL : Renders each chain as "N. email (designation)" lines joined by
              " | ", then "before → after". Pure formatting; no side-effects.
  PARAMS    : oldChain, newChain — getGroupChain_() shapes ([{sequence,email,designation}]).
  RETURNS   : string.
*/
function chainDiffDetails_(oldChain, newChain) {
  const fmt = function (chain) {
    if (!chain.length) return "(empty)";
    return chain.map(function (s) {
      return s.sequence + ". " + s.email + (s.designation ? " (" + s.designation + ")" : "");
    }).join(" | ");
  };
  return "Before: " + fmt(oldChain) + "  →  After: " + fmt(newChain);
}

/*
  chainChangeAction_ — classify a chain edit for the audit log (#).
  LAYMAN    : Para descriptive ang Admins_Log: dinagdagan ba (approver_added),
              binawasan (approver_removed), pinalitan (approver_replaced), o
              inayos lang ang pagkakasunod (chain_reordered)? Kung designation
              lang o halo-halo, chain_changed.
  TECHNICAL : Compares old vs new approver SETS (by normalizeEmail_) to pick the
              most specific ADMIN_ACTION. Same set + different order → reordered.
              Same set + same order (designation-only) → CHAIN_CHANGED fallback.
  PARAMS    : oldChain, newChain — getGroupChain_() shapes.
  RETURNS   : an ADMIN_ACTION.* value.
*/
function chainChangeAction_(oldChain, newChain) {
  const oldE = oldChain.map(function (s) { return normalizeEmail_(s.email); });
  const newE = newChain.map(function (s) { return normalizeEmail_(s.email); });
  const oldSet = {}; oldE.forEach(function (e) { oldSet[e] = true; });
  const newSet = {}; newE.forEach(function (e) { newSet[e] = true; });
  const added   = newE.filter(function (e) { return !oldSet[e]; });
  const removed = oldE.filter(function (e) { return !newSet[e]; });

  if (added.length && !removed.length) return ADMIN_ACTION.APPROVER_ADDED;
  if (removed.length && !added.length) return ADMIN_ACTION.APPROVER_REMOVED;
  if (added.length && removed.length)  return ADMIN_ACTION.APPROVER_REPLACED;
  // Same set of people — reorder if positions differ, else designation-only.
  const reordered = oldE.length !== newE.length ||
                    oldE.some(function (e, i) { return e !== newE[i]; });
  return reordered ? ADMIN_ACTION.CHAIN_REORDERED : ADMIN_ACTION.CHAIN_CHANGED;
}


// ============================================================
// READS
// ============================================================
/*
  Function Name: adminGetAllRequests

  LAYMAN (Tropang Ex):
  Lahat-lahat ng requests sa system, walang filter — yung "helicopter view" ng
  admin. Kapag may nagtanong na "nasaan na yung request ni ganito?", dito
  makikita nang hindi hinahalughog ang spreadsheet. Parehong hugis ng listahan
  sa ibang dashboards para parehong table/filter/sort ang gamit ng UI.

  TECHNICAL:
  Same frozen flat DTO as getPendingApprovals()/getMyActionedRequests() —
  the admin list reuses the existing table renderer, sortRequests, and the
  expired chip unchanged. No row filter; admin-only via adminGuard_().

  PARAMS:
  - (none) — identity from Session.

  RETURNS:
  Array of { requestId, controlNumber, projectTitle, requestor, group, status,
  step, dateFiled, contractEnd, isExpired }. [] if the caller is not an admin.

  STEPS
    Step 1 — Guard
      Layman    : Hindi admin? Walang makikita — empty list.
      Technical : adminGuard_() → null ⇒ return [].
    Step 2 — Project every row
      Layman    : Bawat request row, gawing DTO; petsa naka-PH format.
      Technical : getDataRows_(REQUESTS).map — identical projection to
                  getPendingApprovals() minus the filter.

  EXAMPLE
    adminGetAllRequests()
    → [ { requestId:"REQ-9b1", status:"Pending Approver 2", … }, … ]
    adminGetAllRequests()   // called by a non-admin
    → []
*/
function adminGetAllRequests() {
  if (!adminGuard_()) return [];

  return getDataRows_(SHEET_NAMES.REQUESTS).map(function (row) {
    return {
      requestId:     row[CR.REQUEST_ID - 1],
      controlNumber: row[CR.CONTROL_NUMBER - 1],
      projectTitle:  row[CR.PROJECT_TITLE - 1],
      requestor:     row[CR.REQUESTOR - 1],
      group:         getGroupNameById_(row[CR.GROUP - 1]),
      status:        row[CR.STATUS - 1],
      step:          row[CR.STEP - 1],
      dateFiled:     row[CR.DATE_OF_FILING - 1]
        ? Utilities.formatDate(new Date(row[CR.DATE_OF_FILING - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      contractEnd:   row[CR.CONTRACT_END - 1]
        ? Utilities.formatDate(new Date(row[CR.CONTRACT_END - 1]), "Asia/Manila", "MMM dd, yyyy")
        : "",
      isExpired:     isContractExpired_(row[CR.CONTRACT_END - 1]),
    };
  });
}

/*
  Function Name: adminGetGroups

  LAYMAN (Tropang Ex):
  Lahat ng groups (pati naka-deactivate) na may kasamang mga bilang na kailangan
  ng admin page: ilan ang approvers sa chain, ilan ang requests na pending pa sa
  group, at hanggang anong step na ang pinakamalayo sa mga pending. Yung huli ang
  pinakaimportante — ito ang nagsasabi kung gaano kaikli pwedeng gawin ang chain
  nang walang request na maiipit.

  TECHNICAL:
  getAllGroups_() + two single-pass aggregations: approverCount from
  Group_Approvers (active rows), pendingCount/maxPendingStep from Requests
  (status ∈ PENDING_1/2/3, bucketed by group_id). maxPendingStep is the guard
  input for adminSaveChain's shrink check and the UI's pre-save warning.

  PARAMS:
  - (none) — identity from Session.

  RETURNS:
  [{ id, name, active, createdAt(formatted), approverCount, pendingCount,
  maxPendingStep }]. [] if the caller is not an admin.

  STEPS
    Step 1 — Guard
    Step 2 — Count active approvers per group
      Layman    : Isang pass sa Group_Approvers: ilan ang buhay na slot kada group.
      Technical : getDataRows_(GROUP_APPROVERS) → counts map keyed by group_id.
    Step 3 — Count pending requests + max step per group
      Layman    : Isang pass sa Requests: ilan ang pending kada group, at anong
                  pinakamataas na step ang inuupuan ngayon.
      Technical : status ∈ pending set → pendingCount++, maxPendingStep = max(step).
    Step 4 — Merge into the groups list

  EXAMPLE
    adminGetGroups()
    → [ { id:"G001", name:"Engineering", active:true, approverCount:3,
          pendingCount:2, maxPendingStep:2, createdAt:"Jan 05, 2026" }, … ]
*/
function adminGetGroups() {
  if (!adminGuard_()) return [];

  const approverCounts = {};
  groupApproverRows_().forEach(function (r) {
    if (String(r[GAP.ACTIVE - 1]).toUpperCase() === "FALSE") return;
    const gid = String(r[GAP.GROUP_ID - 1]);
    approverCounts[gid] = (approverCounts[gid] || 0) + 1;
  });

  const pendingStats = {};
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];
  getDataRows_(SHEET_NAMES.REQUESTS).forEach(function (row) {
    if (!pending.includes(row[CR.STATUS - 1])) return;
    const gid  = String(row[CR.GROUP - 1]);
    const step = parseInt(row[CR.STEP - 1], 10) || 0;
    pendingStats[gid] = pendingStats[gid] || { count: 0, maxStep: 0 };
    pendingStats[gid].count++;
    if (step > pendingStats[gid].maxStep) pendingStats[gid].maxStep = step;
  });

  return getAllGroups_().map(function (g) {
    const stats = pendingStats[String(g.id)] || { count: 0, maxStep: 0 };
    return {
      id:             g.id,
      name:           g.name,
      active:         g.active,
      createdAt:      g.createdAt
        ? Utilities.formatDate(new Date(g.createdAt), "Asia/Manila", "MMM dd, yyyy")
        : "",
      approverCount:  approverCounts[String(g.id)] || 0,
      pendingCount:   stats.count,
      maxPendingStep: stats.maxStep,
    };
  });
}

/*
  adminGetGroupChain — the editable chain for one group.
  LAYMAN    : Yung kasalukuyang approver chain ng group para sa editor —
              kasunod-sunod, active lang.
  TECHNICAL : Thin guarded pass-through to getGroupChain_() (Accessors.js).
  PARAMS    : groupId — the group to load.
  RETURNS   : [{ id, sequence, email, designation, active }] or [] if not admin.
*/
function adminGetGroupChain(groupId) {
  if (!adminGuard_()) return [];
  return getGroupChain_(groupId);
}


// ============================================================
// GROUP MUTATIONS
// ============================================================
/*
  adminCreateGroup — add a new group to the registry.
  LAYMAN    : Bagong group/department. Kailangan may pangalan at hindi pa gamit
              (kahit ng inactive na group). Walang approvers pa ito pagka-create
              — hindi pa siya lalabas sa new-request dropdown* hangga't hindi
              nalalagyan ng chain. (*Lalabas siya sa dropdown pero hindi
              makaka-submit nang maayos ang request kung walang approver — kaya
              ang UI ang magpapaalala na lagyan agad ng chain.)
  TECHNICAL : Guard → validGroupName_ → createGroup_() accessor. New groups are
              ACTIVE=TRUE immediately; the admin UI nudges chain setup next.
  PARAMS    : name — display name.
  RETURNS   : { success:true, group:{id, name} } or { success:false, error }.
*/
function adminCreateGroup(name) {
  const caller = adminGuard_();
  if (!caller) return { success: false, error: "Unauthorized" };
  const check = validGroupName_(name, null);
  if (!check.ok) return { success: false, error: check.error };
  const group = createGroup_(check.name);
  try { appendAdminLog_(caller, ADMIN_ACTION.GROUP_CREATED, group.id, 'Created group "' + group.name + '"'); }
  catch (e) { Logger.log("adminCreateGroup(): admin-log failed: " + e); }
  return { success: true, group: group };
}

/*
  adminRenameGroup — change a group's display name.
  LAYMAN    : Palitan ang pangalan. Safe ito kahit may mga lumang request —
              naka-link sila sa group_id (G001), hindi sa pangalan, kaya lahat
              ng lists/details ay magpapakita na lang ng bagong pangalan.
  TECHNICAL : Guard → validGroupName_ (excluding self) → updateGroupFields_().
  PARAMS    : groupId; name — new display name.
  RETURNS   : { success:true } or { success:false, error }.
*/
function adminRenameGroup(groupId, name) {
  const caller = adminGuard_();
  if (!caller) return { success: false, error: "Unauthorized" };
  const check = validGroupName_(name, groupId);
  if (!check.ok) return { success: false, error: check.error };
  const oldName = getGroupNameById_(groupId);
  if (!updateGroupFields_(groupId, { name: check.name })) {
    return { success: false, error: "Group not found." };
  }
  try { appendAdminLog_(caller, ADMIN_ACTION.GROUP_RENAMED, groupId, '"' + oldName + '" → "' + check.name + '"'); }
  catch (e) { Logger.log("adminRenameGroup(): admin-log failed: " + e); }
  return { success: true };
}

/*
  adminSetGroupActive — show/hide a group in the new-request dropdown.
  LAYMAN    : I-off ang group → hindi na siya mapipili sa bagong request. Pero
              ang mga request na NASA LOOB na ng group, tuloy pa rin ang daloy —
              hindi ito nakakaapekto sa routing (verified: ang chain reads ay
              hindi tumitingin sa group active flag). Reversible — i-on ulit anumang oras.
  TECHNICAL : Guard → updateGroupFields_(). Deliberately NO pending-request
              block: GRP.ACTIVE only gates getApproverGroups() (the form
              dropdown); getGroupApprovers_()/getCurrentApprover_() ignore it.
  PARAMS    : groupId; active — boolean.
  RETURNS   : { success:true } or { success:false, error }.
*/
function adminSetGroupActive(groupId, active) {
  const caller = adminGuard_();
  if (!caller) return { success: false, error: "Unauthorized" };
  if (!updateGroupFields_(groupId, { active: !!active })) {
    return { success: false, error: "Group not found." };
  }
  try {
    appendAdminLog_(caller, active ? ADMIN_ACTION.GROUP_ACTIVATED : ADMIN_ACTION.GROUP_DEACTIVATED,
                   groupId, (active ? "Reactivated" : "Deactivated") + ' "' + getGroupNameById_(groupId) + '"');
  } catch (e) { Logger.log("adminSetGroupActive(): admin-log failed: " + e); }
  return { success: true };
}


// ============================================================
// CHAIN MUTATION
// ============================================================
/*
  Function Name: adminSaveChain

  LAYMAN (Tropang Ex):
  I-save ang bagong approver chain ng isang group — ito ang pinaka-puso ng
  admin page. Buong palit: ang ipapasa ng UI ay ang kumpletong bagong listahan
  (1 hanggang 3 approvers, naka-ayos), at ang server ang maglalagay ng sequence
  numbers. May mga bakod bago payagan: may laman dapat (kung gusto mong patayin
  ang group, i-deactivate, huwag burahin ang chain), max 3 (yan ang kaya ng
  workflow engine), walang duplicate o blangkong email, at HINDI pwedeng paikliin
  ang chain kung may request na nakaupo sa step na mawawala — kung papayagan
  yon, mawawala ang request sa lahat ng pending lists nang tuluyan.

  Kapag pinalitan o ni-reorder ang approver kaya nagbago kung sino ang humahawak
  ng isang nakabinbin na request, ang BAGONG humahawak agad ang aaksyon — live ang
  pagbasa ng chain. Padadalhan siya agad ng "ikaw na ang approver" email (tingnan
  notifyChainChanges_). Ang bawat galaw ay naitatala rin sa Admins_Log (appendAdminLog_).

  TECHNICAL:
  Guard → validate (group exists; 1–3 slots; emails non-blank, well-formed,
  unique via normalizeEmail_; slots.length ≥ maxPendingStep of the group's
  PENDING_1/2/3 rows — violation returns the blocking control numbers) →
  replaceGroupChain_() (Accessors.js: lock + soft-delete + batch append).
  Sequences are server-assigned 1..N from array order; client numbering is
  never trusted. Designation is optional (blank allowed — it only feeds the
  COC signatory block and email labels).

  PARAMS:
  - groupId — the group whose chain is being replaced.
  - slots — [{ email, designation }] in desired approval order.

  RETURNS:
  { success:true, chain:[{id, sequence, email, designation, active}] } with the
  freshly-written chain, or { success:false, error } on any validation failure.

  STEPS
    Step 1 — Guard + group existence
      Layman    : Admin ka ba, at totoo bang group ito?
      Technical : adminGuard_(); getGroupById_() → null ⇒ "Group not found."
    Step 2 — Shape + length validation
      Layman    : Listahan ba talaga, may 1–3 laman?
      Technical : Array.isArray; 0 ⇒ "deactivate instead" error; >3 ⇒ engine cap
                  (approve_() only branches steps 1–3; STATUS has only PENDING_1/2/3).
    Step 3 — Per-slot + duplicate validation
      Layman    : Bawat slot may maayos na email; walang inuulit na tao.
      Technical : trim; /\S+@\S+\.\S+/ shape check; normalizeEmail_() set for dupes.
    Step 4 — In-flight shrink guard
      Layman    : May request bang nakaupo sa step na mawawala? Kung meron,
                  bawal — isama sa error ang control numbers para alam ng admin
                  kung ano ang nakaharang.
      Technical : One Requests pass: pending rows of this group with
                  step > slots.length → collect control numbers ⇒ reject.
    Step 5 — Replace, audit, notify, return the new chain
      Layman    : Isagawa ang palit; itala sa Admins_Log; padalhan ng email ang
                  bagong humahawak; ibalik ang bagong chain para i-refresh ng UI.
      Technical : capture old chain + old current-approver-per-pending-row →
                  replaceGroupChain_() → appendAdminLog_(chainDiffDetails_) →
                  notifyChainChanges_() (each try/catch) → getGroupChain_() re-read.

  EXAMPLE
    adminSaveChain("G001", [{email:"a@mw.com", designation:"Manager"},
                            {email:"b@mw.com", designation:"AVP"}])
    → { success:true, chain:[ {sequence:1, email:"a@mw.com", …}, … ] }
    adminSaveChain("G001", [{email:"a@mw.com"}])   // a request sits at step 2
    → { success:false, error:"1 in-flight request is at step 2 … : EC-2026-00007-145" }
*/
function adminSaveChain(groupId, slots) {
  const caller = adminGuard_();
  if (!caller) return { success: false, error: "Unauthorized" };
  if (!getGroupById_(groupId)) return { success: false, error: "Group not found." };

  if (!Array.isArray(slots)) return { success: false, error: "Invalid chain payload." };
  if (slots.length === 0) {
    return { success: false, error: "A chain needs at least one approver. To retire this group, deactivate it instead." };
  }
  if (slots.length > 3) {
    return { success: false, error: "A chain can have at most 3 approvers (workflow limit)." };
  }

  const cleaned = [];
  const seen = {};
  const MAX_APPROVER_EMAIL = 254;  // RFC 5321 practical ceiling
  const MAX_DESIGNATION    = 200;  // matches MAX_SHORT_TEXT elsewhere
  for (let i = 0; i < slots.length; i++) {
    const email       = String((slots[i] && slots[i].email) || "").trim();
    const designation = String((slots[i] && slots[i].designation) || "").trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return { success: false, error: "Approver " + (i + 1) + " needs a valid email address." };
    }
    if (email.length > MAX_APPROVER_EMAIL) {
      return { success: false, error: "Approver " + (i + 1) + "'s email address is too long." };
    }
    // Designation renders on the COC signatory block and in email labels, and
    // is written to a cell — cap it and block a leading "=".
    if (designation.length > MAX_DESIGNATION) {
      return { success: false, error: "Approver " + (i + 1) + "'s designation is too long (max " + MAX_DESIGNATION + " characters)." };
    }
    if (startsWithFormula_(designation)) {
      return { success: false, error: 'Approver ' + (i + 1) + '\'s designation must not start with "=".' };
    }
    const key = normalizeEmail_(email);
    if (seen[key]) {
      return { success: false, error: "The same person cannot appear twice in one chain (" + email + ")." };
    }
    seen[key] = true;
    cleaned.push({ email: email, designation: designation });
  }

  // In-flight shrink guard: a pending request sitting at a step beyond the new
  // chain length would vanish from every pending list (getCurrentApprover_ →
  // null) with no way to recover short of editing the sheet. Hard-block it.
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];
  const target  = String(groupId);
  const blockers = [];
  getDataRows_(SHEET_NAMES.REQUESTS).forEach(function (row) {
    if (String(row[CR.GROUP - 1]) !== target) return;
    if (!pending.includes(row[CR.STATUS - 1])) return;
    const step = parseInt(row[CR.STEP - 1], 10) || 0;
    if (step > cleaned.length) blockers.push(row[CR.CONTROL_NUMBER - 1]);
  });
  if (blockers.length > 0) {
    return {
      success: false,
      error: blockers.length + " in-flight request" + (blockers.length === 1 ? " is" : "s are") +
             " at a step beyond the new chain length. Keep at least enough approvers to cover: " +
             blockers.join(", "),
    };
  }

  // Capture pre-change state BEFORE the replace:
  //  - oldChain      : for the audit diff
  //  - oldSeqByEmail : { normalizedEmail: oldSequence } — membership + prior position
  //  - oldCurrent    : { requestId: currentApproverEmail } per in-flight request
  const oldChain = getGroupChain_(groupId);
  const oldSeqByEmail = {};
  oldChain.forEach(function (s) { oldSeqByEmail[normalizeEmail_(s.email)] = s.sequence; });
  const oldCurrent = {};
  pendingRowsForGroup_(groupId).forEach(function (row) {
    oldCurrent[String(row[CR.REQUEST_ID - 1])] = getCurrentApprover_(row[CR.STEP - 1], groupId);
  });

  replaceGroupChain_(groupId, cleaned);
  const newChain = getGroupChain_(groupId);

  // Audit (best-effort — never fail the committed save over logging). The action
  // is classified (added / removed / replaced / reordered) so the log is specific.
  try {
    appendAdminLog_(caller, chainChangeAction_(oldChain, newChain), groupId,
                   chainDiffDetails_(oldChain, newChain));
  } catch (e) {
    Logger.log("adminSaveChain(): admin-log failed: " + e);
  }

  // Notify whoever NEWLY holds an in-flight request (covers add / replace /
  // reorder) plus anyone newly in the chain. The ONLY email an admin action
  // sends; wrapped so an email hiccup never reports the committed save as failed.
  try {
    notifyChainChanges_(groupId, oldSeqByEmail, oldCurrent);
  } catch (e) {
    Logger.log("adminSaveChain(): chain-change notice failed: " + e);
  }

  return { success: true, chain: newChain };
}
