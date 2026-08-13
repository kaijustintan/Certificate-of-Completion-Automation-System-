// Triggers.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Triggers.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito ang mga "alarm clock" ng system. Dalawang araw-araw na 8am na trabaho:
  (1) paalala sa requestor kapag malapit nang mag-expire ang contract, at
  (2) paalala sa approver na may hinihintay pang pirma sa kanya.
  ⚠️ IMPORTANTE: hindi sapat na may code dito — kailangan pang i-run ang
  DALAWANG register functions MINSAN kada Google account.

  TECHNICAL:
  TWO daily TIME-BASED triggers live here (both ~8am Manila):
  checkContractExpiries (#10) emails the requestor about lapsing contracts;
  checkPendingApprovals emails the current approver a digest of requests still
  awaiting their action. The legacy installable onEdit path (onSheetChange and
  its handlers) was DELETED: it was dormant by design, held a complete parallel
  email implementation (double-send hazard), and inside an installable trigger
  Session.getActiveUser() resolves to the trigger owner, not the acting user.
  Recover from git history (commit 06de263 and earlier) if ever needed.

  ⚠️ TWO registrations exist, and both must be run once per Google account:
  registerExpiryTrigger() and registerApproverReminderTrigger(). All entry
  points are guarded by isOwnerContext_(), because a bare global is callable
  via google.script.run and checkPendingApprovals in particular has no
  idempotency flag by design.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  - checkContractExpiries()                daily 8am clock handler; expiry reminders (#10)
  - registerExpiryTrigger()                one-time setup for the expiry trigger
  - checkPendingApprovals()                daily 8am clock handler; approver nudge digest
  - registerApproverReminderTrigger()      one-time setup for the approver-reminder trigger
*/


// ============================================================
// DAILY EXPIRY SWEEP (#10)
// The system's only scheduled job. Runs every morning and emails the
// requestor when a fully-approved COC's contract is about to lapse
// (T-3 days) or has reached/passed its end date (day-of / overdue).
// ============================================================
/*
  Function Name: checkContractExpiries

  LAYMAN (Tropang Ex):
  Tuwing umaga (8am), nililibot nito lahat ng fully-approved na request at
  tinitingnan kung malapit nang mag-expire ang contract. Kung 3 araw na lang,
  may "Expiring Soon" na email sa requestor. Kung araw na mismo (o lumampas na),
  may "Expires Today/Expired" na email. Para hindi paulit-ulit, naglalagay ito
  ng marka sa Activity_Log kada padala — kaya isang beses lang bawat yugto.

  TECHNICAL:
  Time-based trigger handler (registered by registerExpiryTrigger). One pass over
  the Requests sheet; only STATUS === APPROVED rows with a non-blank CONTRACT_END
  are considered. Three stages, each idempotent via its own Activity_Log system
  action (so a manual/duplicate run never double-sends the same stage):
    • 1..3 days out + no EXPIRY_WARNING → "Expiring Soon"  + log EXPIRY_WARNING  (range; self-heals)
    • exactly 0 days + no EXPIRY_NOTICE → "Expires Today"  + log EXPIRY_NOTICE   (best-effort, exact day)
    • < 0 days       + no EXPIRY_OVERDUE → "Has Expired"   + log EXPIRY_OVERDUE  (range; self-heals)
  Rationale: the requestor often isn't watching the portal, so the post-expiry
  "has expired" push is the real awareness channel — and because it's a range
  (any run after the end date), a skipped day-of run still results in an
  "expired" email the next run. else-if → at most one email per request per run.
  Each request is wrapped in try/catch so one bad row never aborts the sweep.

  ⚠️ QUOTA: GmailApp sends count against the daily quota (~100 consumer / ~1500
  Workspace). At expected COC volume this is comfortably under, but the per-row
  try/catch + logging make a partial run observable if a quota ceiling is ever hit.

  ⚠️ RENEWAL-BY-EDIT: if a contract end date is later extended on the same row,
  the existing flags suppress new reminders. By design renewals are NEW requests,
  so this is acceptable; revisit if in-place renewals become a real workflow.

  PARAMS  : (none) — invoked by the daily trigger.
  RETURNS : (void) — logs a summary.
*/
/*
  markExpiryFlag_ — mirror a just-appended EXPIRY_* row into the in-memory map.
  LAYMAN    : Kapag nakapadala na tayo ng reminder at nag-log na tayo, itatanda
              rin natin ito sa checklist na hawak natin sa memorya — para kung
              may kaparehong request ID pa sa listahan, hindi na ito madodoble.
  TECHNICAL : Keeps getExpiryFlagMap_'s snapshot consistent with writes made
              during the same sweep. Required because the map is built ONCE
              before the loop, whereas the previous per-row getApprovalActions_()
              re-read the sheet and so observed mid-loop appends. Keyed with
              String() to match getExpiryFlagMap_.
  PARAMS    : map — the flag map; requestId; action — an ACTION.EXPIRY_* value.
  RETURNS   : (void) — mutates map.
*/
function markExpiryFlag_(map, requestId, action) {
  const id = String(requestId);
  if (!map[id]) map[id] = {};
  map[id][action] = true;
}

function checkContractExpiries() {
  // Owner/trigger only. Reachable via google.script.run otherwise, which would let
  // any authenticated user fire the whole day's send batch on demand and write
  // "system"-attributed rows into the append-only Activity_Log at will.
  if (!isOwnerContext_()) {
    Logger.log("checkContractExpiries(): refused — not an owner/trigger execution.");
    return;
  }
  const rows = getDataRows_(SHEET_NAMES.REQUESTS);
  let warned = 0, noticed = 0, overdue = 0;

  // ONE Activity_Log scan for the entire sweep (was: one full scan per approved
  // row, which is quadratic and breaches the 6-minute ceiling around ~1,450
  // lifetime requests). Kept consistent with mid-loop appends via markExpiryFlag_.
  // Deliberately NOT wrapped in a try/catch that falls back to {}: an empty map
  // reads as "no reminder has ever been sent" and would re-notify every approved
  // contract in the system. Let a scan failure abort the sweep (fail closed).
  const expiryFlags = getExpiryFlagMap_();

  rows.forEach(function (row) {
    try {
      if (row[CR.STATUS - 1] !== STATUS.APPROVED) return;
      const rawEnd = row[CR.CONTRACT_END - 1];
      if (!rawEnd) return;

      const daysUntil = daysUntilContractEnd_(rawEnd);
      if (daysUntil === null) return;

      const requestId = row[CR.REQUEST_ID - 1];
      const groupId   = row[CR.GROUP - 1];
      // Re-read from the map on EVERY iteration — it is mutated below.
      const flags      = expiryFlags[String(requestId)] || {};
      const hasWarning = flags[ACTION.EXPIRY_WARNING] === true;
      const hasNotice  = flags[ACTION.EXPIRY_NOTICE]  === true;
      const hasOverdue = flags[ACTION.EXPIRY_OVERDUE] === true;

      const endStr = Utilities.formatDate(new Date(rawEnd), "Asia/Manila", "yyyy-MM-dd");

      if (daysUntil >= 1 && daysUntil <= 3 && !hasWarning) {
        sendExpiryReminderToRequestor_(requestId, daysUntil);
        appendAction_(requestId, groupId, 0, null, "system", ACTION.EXPIRY_WARNING, "Contract expires " + endStr);
        markExpiryFlag_(expiryFlags, requestId, ACTION.EXPIRY_WARNING);
        warned++;
      } else if (daysUntil === 0 && !hasNotice) {
        sendExpiryReminderToRequestor_(requestId, daysUntil);
        appendAction_(requestId, groupId, 0, null, "system", ACTION.EXPIRY_NOTICE, "Contract expires today " + endStr);
        markExpiryFlag_(expiryFlags, requestId, ACTION.EXPIRY_NOTICE);
        noticed++;
      } else if (daysUntil < 0 && !hasOverdue) {
        sendExpiryReminderToRequestor_(requestId, daysUntil);
        appendAction_(requestId, groupId, 0, null, "system", ACTION.EXPIRY_OVERDUE, "Contract expired " + endStr);
        markExpiryFlag_(expiryFlags, requestId, ACTION.EXPIRY_OVERDUE);
        overdue++;
      }
    } catch (err) {
      Logger.log("checkContractExpiries(): row error for " + row[CR.REQUEST_ID - 1] + " — " + err.message);
    }
  });

  Logger.log("checkContractExpiries(): done — " + warned + " warning(s), " + noticed + " day-of, " + overdue + " overdue.");
}

// ============================================================
// Run this function ONCE manually (per Google account) to register
// the daily expiry sweep.
// ⚠️ Triggers are per-script-PER-USER: when the project is migrated to
// the Megaworld account, someone must run this there too.
// ============================================================
/*
  Function Name: registerExpiryTrigger
  LAYMAN    : I-run ITO ISANG BESES para mag-umpisa ang araw-araw na 8am na
              expiry check. Nagde-dedup din: tinatanggal ang lumang trigger bago
              magrehistro ng bago.
  TECHNICAL : Removes any existing checkContractExpiries triggers, then creates a
              daily time-based trigger at 8am (project timezone is Asia/Manila per
              appsscript.json).
  PARAMS    : (none) — run manually once in the Apps Script editor, per account.
  RETURNS   : (void) — logs confirmation.
*/
function registerExpiryTrigger() {
  // Owner only. This function DELETES the live trigger before re-creating it, so an
  // unprivileged caller could use it to silently remove the daily sweep (duplicates
  // are impossible thanks to the dedup, but deletion is not).
  if (!isOwnerContext_()) {
    throw new Error("registerExpiryTrigger() may only be run by the script owner from the Apps Script editor.");
  }

  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "checkContractExpiries") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("checkContractExpiries")
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();

  Logger.log("registerExpiryTrigger(): daily checkContractExpiries trigger registered for ~8am Manila.");
}


// ============================================================
// DAILY APPROVER-REMINDER SWEEP
// Second scheduled job. Runs every morning and nudges whoever is
// currently holding up a pending request — one digest email per
// approver, listing all requests awaiting their action.
// ============================================================
/*
  Function Name: checkPendingApprovals

  LAYMAN (Tropang Ex):
  Tuwing umaga (8am), nililibot nito lahat ng request na naka-PENDING pa. Para sa
  bawat isa, tinitingnan kung kaninong pirma ang hinihintay ngayon (current approver),
  tapos pinagsasama-sama lahat ng nakabinbin para sa iisang approver sa ISANG email.
  Ganito kasi minsan natatabunan yung unang email — kaya araw-araw na paalala hangga't
  pending pa. Walang marka sa Activity_Log: ang araw-araw na schedule na mismo ang
  "idempotency" — isang takbo kada araw, kaya isang padala kada araw.

  TECHNICAL:
  Time-based trigger handler (registered by registerApproverReminderTrigger). One pass
  over the Requests sheet; only the three PENDING_* statuses are considered. For each,
  getCurrentApprover_(step, group) resolves the responsible approver email; rows are
  bucketed by normalizeEmail_(approver) so a single approver gets ONE digest covering
  all their pending requests (regardless of step/group). Then sendPendingApprovalReminder_
  fires once per bucket.

  Unlike checkContractExpiries this writes NOTHING to Activity_Log and uses NO system
  ACTION flag — a daily nudge is MEANT to repeat, so the once-a-day trigger schedule is
  the idempotency. Logging each reminder would append one row per pending request per
  day and bloat the append-only timeline. Each row + each send is wrapped in try/catch
  so one bad row/approver never aborts the sweep.

  ⚠️ QUOTA: GmailApp sends count against the daily quota (~100 consumer / ~1500
  Workspace). Digest-per-approver (not per-request) keeps the send count low.

  PARAMS  : (none) — invoked by the daily trigger.
  RETURNS : (void) — logs a summary.

  STEPS
    Step 1 — Sweep + bucket
      Layman    : Lakad sa lahat ng row; kung pending, alamin kanino, isalansan.
      Technical : Filter PENDING_*; getCurrentApprover→normalizeEmail_ key; push rowData.
    Step 2 — Send one digest per approver
      Layman    : Kada approver, isang email na listahan ng lahat niyang pending.
      Technical : Iterate buckets; sendPendingApprovalReminder_(email, rows); count sends.

  EXAMPLE
    (trigger fires at 8am; approverA holds 2 pending, approverB holds 1)
    → 2 emails sent; log "reminded 2 approver(s)."
    → no pending rows: 0 emails; log "reminded 0 approver(s)."
*/
function checkPendingApprovals() {
  // ⚠️ Owner/trigger only — this is the guard that makes the "the daily schedule
  // IS the idempotency" design above actually true. Without it, any authenticated
  // user could loop this via google.script.run to mail-bomb every approver and
  // exhaust the daily Gmail quota (which then silently kills all workflow mail,
  // because sendBrandedEmail_ fails soft).
  if (!isOwnerContext_()) {
    Logger.log("checkPendingApprovals(): refused — not an owner/trigger execution.");
    return;
  }

  const rows    = getDataRows_(SHEET_NAMES.REQUESTS);
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];
  const byApprover = {};   // normalized email -> [rowData, ...]

  rows.forEach(function (row) {
    try {
      if (pending.indexOf(row[CR.STATUS - 1]) === -1) return;
      const approver = getCurrentApprover_(row[CR.STEP - 1], row[CR.GROUP - 1]);
      if (!approver) return;                       // unconfigured group / step 0 — skip
      const key = normalizeEmail_(approver);
      if (!key) return;                            // guard against a blank approver cell
      (byApprover[key] = byApprover[key] || []).push(row);
    } catch (err) {
      Logger.log("checkPendingApprovals(): row error for " + row[CR.REQUEST_ID - 1] + " — " + err.message);
    }
  });

  let sent = 0;
  Object.keys(byApprover).forEach(function (email) {
    try {
      sendPendingApprovalReminder_(email, byApprover[email]);
      sent++;
    } catch (err) {
      Logger.log("checkPendingApprovals(): email error for " + email + " — " + err.message);
    }
  });

  Logger.log("checkPendingApprovals(): done — reminded " + sent + " approver(s).");
}

// ============================================================
// Run this function ONCE manually (per Google account) to register
// the daily approver-reminder sweep. Mirrors registerExpiryTrigger().
// ⚠️ Triggers are per-script-PER-USER: when the project is migrated to
// the Megaworld account, someone must run this there too.
// ============================================================
/*
  Function Name: registerApproverReminderTrigger
  LAYMAN    : I-run ITO ISANG BESES para mag-umpisa ang araw-araw na 8am na
              paalala sa mga approver. Nagde-dedup din: tinatanggal ang lumang
              trigger bago magrehistro ng bago.
  TECHNICAL : Removes any existing checkPendingApprovals triggers, then creates a
              daily time-based trigger at 8am (project timezone is Asia/Manila per
              appsscript.json). Independent of registerExpiryTrigger — two separate
              daily jobs, both must be registered once per account.
  PARAMS    : (none) — run manually once in the Apps Script editor, per account.
  RETURNS   : (void) — logs confirmation.
*/
function registerApproverReminderTrigger() {
  // Owner only — same delete-then-create exposure as registerExpiryTrigger().
  if (!isOwnerContext_()) {
    throw new Error("registerApproverReminderTrigger() may only be run by the script owner from the Apps Script editor.");
  }

  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "checkPendingApprovals") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("checkPendingApprovals")
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();

  Logger.log("registerApproverReminderTrigger(): daily checkPendingApprovals trigger registered for ~8am Manila.");
}