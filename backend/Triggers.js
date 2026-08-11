// Triggers.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Triggers.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito ang "sentry" ng system. Naghihintay siya sa bawat pagbabago sa Sheet —
  at kapag nagbago ang STATUS ng isang request o may nadagdag na attachment,
  tinatawag niya ang tamang functions. Kapalit ito ng lahat ng 5 AppSheet bots.
  ⚠️ IMPORTANTE: hindi sapat na may code dito — kailangan pang i-register
  ang trigger MINSAN sa Apps Script UI (basa ang registerTrigger() docs below).

  TECHNICAL:
  Two trigger kinds live here. (1) An installable onEdit trigger entry point that
  routes to sheet-specific handlers by tab name (STATUS-column changes only). (2)
  TWO daily TIME-BASED triggers (both ~8am Manila): checkContractExpiries (#10)
  emails the requestor about lapsing contracts; checkPendingApprovals emails the
  current approver a digest of requests still awaiting their action. All three
  need a one-time manual registration (registerTrigger / registerExpiryTrigger /
  registerApproverReminderTrigger).

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  - onSheetChange(e)                       entry point; routes by sheet name
  - handleCertificateRequestChange         STATUS-column watcher; fires emails
  - handleAttachmentChange                 new-row detector; calls sync check
  - registerTrigger()                      one-time setup; run once manually
  - checkContractExpiries()                daily 8am clock handler; expiry reminders (#10)
  - registerExpiryTrigger()                one-time setup for the expiry trigger
  - checkPendingApprovals()                daily 8am clock handler; approver nudge digest
  - registerApproverReminderTrigger()      one-time setup for the approver-reminder trigger
*/


// ============================================================
// MAIN CHANGE HANDLER
// This is the function Google calls every time the Sheet changes.
// The 'e' parameter is the event object — it tells us what changed.
// ============================================================
/*
  Function Name: onSheetChange
  LAYMAN    : Entry point — Google ang tumatawag dito sa bawat edit sa Sheet.
              Tinitignan niya kung anong tab ang nagbago, tapos pinapasa sa
              tamang handler. Error sa loob ay nilo-log (hindi nagcrash ang buong trigger).
  TECHNICAL : Registered installable onEdit handler. Routes by sheetName to
              handleCertificateRequestChange or handleAttachmentChange. Wrapped
              in try/catch so one bad row doesn't kill the trigger.
  PARAMS    : e — Apps Script onEdit event (source, range, value, etc.).
  RETURNS   : (void)
*/
function onSheetChange(e) {
  try {
    const sheet     = e.source.getActiveSheet();
    const sheetName = sheet.getName();

    // ── Route based on which sheet tab changed ──────────────

    if (sheetName === SHEET_NAMES.REQUESTS) {
      handleCertificateRequestChange(e, sheet);
    }

    if (sheetName === SHEET_NAMES.REQUEST_ATTACHMENTS) {
      handleAttachmentChange(e, sheet);
    }

    // Approver_Settings changes don't trigger any automation

  } catch (err) {
    Logger.log(`onSheetChange() ERROR: ${err.message}`);
  }
}


// ============================================================
// CERTIFICATE REQUESTS CHANGE HANDLER
// Watches for Status column changes — same as AppSheet's
// [_THISROW_BEFORE].[Status] <> [_THISROW_AFTER].[Status] condition
// ============================================================
/*
  Function Name: handleCertificateRequestChange
  LAYMAN    : Kapag may nagbago sa Certificate_Requests tab, dito pumupunta.
              Tinitingnan kung ang STATUS column ba ang nagbago (Col C); kung
              hindi, wala siyang ginagawa. Kung oo, tinutukoy kung anong bagong
              status at tinatawag ang tamang email functions.
  TECHNICAL : Guards on: row > 1 (not header) AND col === CR.STATUS (3).
              Routes by newStatus to the email pairs that replaced each AppSheet bot.
  PARAMS    : e — the onEdit event; sheet — the active Sheet object.
  RETURNS   : (void)

  STATUS → EMAIL mapping (AppSheet bot equivalents):
    "Pending Approver N"  → sendApprovalRequest (Next Approver Bot)
                            (only if attachments satisfied)
    "Declined"            → sendDeclineToApprover + sendDeclineToRequestor
    "Fully Approved"      → sendFullyApprovedToApprover + sendFullyApprovedToRequestor
    "Returned to…"        → sendReturnToRequestor + sendReturnConfirmToApprover

  NOTE: In the current portal, the handle* functions in WebApp.js already send
  these emails directly. This trigger provides a fallback for any direct sheet
  edits (e.g. manual admin corrections). Both paths are safe.
*/
function handleCertificateRequestChange(e, sheet) {
  const range = e.range;
  const row   = range.getRow();

  // Ignore the header row
  if (row === 1) return;

  // Only care about changes in the Status column (Col C = column 3)
  const col = range.getColumn();
  if (col !== CR.STATUS) return;

  const newStatus = range.getValue();
  const rowData   = sheet.getRange(row, 1, 1, CR.RESUBMIT_COUNT).getValues()[0];
  const requestId = rowData[CR.REQUEST_ID - 1];

  Logger.log(`handleCertificateRequestChange(): ${requestId} → Status = "${newStatus}"`);

  // ── Route based on new Status value ────────────────────────

  // Replaces: Next Approver Bot
  // Condition: CONTAINS([Status], "Pending Approver")
  //
  // ⚠️ DOUBLE-SEND GUARD — read before registering the trigger.
  // submitNewRequest() in WebApp.js calls sendApprovalRequest() DIRECTLY for
  // every new PENDING_1 submission (Phase 8: all submits go straight to PENDING_1).
  // If onSheetChange were registered, a new submission would fire TWO approver
  // emails — one from submitNewRequest, one here. This is PRE-EXISTING behaviour
  // (not a Phase 8 regression), and currently SAFE because the trigger is DORMANT
  // (requires manual registerTrigger()). Before registering: decide which is the
  // single authority for initial PENDING_1 approval emails and neutralize the other.
  if (newStatus.includes("Pending Approver")) {
    // Phase 8: attachments are uploaded before submit — no attachment gate
    // anymore. A Pending status always means an approver should be notified.
    sendApprovalRequest(requestId);
    return;
  }

  // Replaces: Decline Notification Bot
  // Condition: [Status] = "Declined"
  if (newStatus === STATUS.DECLINED) {
    sendDeclineToApprover(requestId);
    sendDeclineToRequestor(requestId);
    return;
  }

  // Replaces: Fully Approved Notification Bot
  // Condition: [Status] = "Fully Approved"
  if (newStatus === STATUS.APPROVED) {
    sendFullyApprovedToApprover(requestId);
    sendFullyApprovedToRequestor(requestId);
    return;
  }

  // Replaces: Return Notification Bot
  // Condition: STARTSWITH([Status], "Returned to")
  if (newStatus.startsWith("Returned to")) {
    sendReturnToRequestor(requestId);
    sendReturnConfirmToApprover(requestId);
    return;
  }
}


// ============================================================
// REQUEST ATTACHMENTS CHANGE HANDLER
// Watches for new rows added to Request_Attachments.
// Replaces: Sync Finisher Bot (Data Change Type: Adds only)
// ============================================================
/*
  Function Name: handleAttachmentChange
  LAYMAN    : Kapag may nadagdag na row sa Request_Attachments (ibig sabihin
              may na-upload na file), dito pumupunta. Tinutukoy kung anong
              request ang affected, tapos tinatawag ang sync check.
  TECHNICAL : Guards on row > 1 AND column === 1 (new row adds start at col 1).
              Reads the REQUEST_ID from the new row, calls checkAttachmentSync.
  PARAMS    : e — the onEdit event; sheet — the Request_Attachments Sheet.
  RETURNS   : (void)
*/
function handleAttachmentChange(e, sheet) {
  const range     = e.range;
  const row       = range.getRow();

  // Ignore header row
  if (row === 1) return;

  // Only care about new rows being added — not edits to existing rows
  // A new row add will always start at column 1
  if (range.getColumn() !== 1) return;

  const rowData  = sheet.getRange(row, 1, 1, 5).getValues()[0];
  const requestId = rowData[RA.REQUEST_ID - 1];

  if (!requestId) return;

  Logger.log(`handleAttachmentChange(): New attachment detected for ${requestId}`);
  checkAttachmentSync(requestId);
}


// ============================================================
// TRIGGER REGISTRATION
// Run this function ONCE manually to register onSheetChange()
// as an installable trigger on the Sheet.
//
// HOW TO RUN IT:
//   1. Open Apps Script editor
//   2. Select "registerTrigger" from the function dropdown
//   3. Click Run
//   4. Done — you only need to do this once
//
// After registration, onSheetChange() fires automatically
// every time anyone edits the Sheet.
// ============================================================
/*
  Function Name: registerTrigger
  LAYMAN    : I-run ito ISANG BESES para mag-register ng automatic watcher
              sa Sheet. Pagkatapos, awtomatiko na ang lahat — hindi na kailangang
              mano-manong tumawag. Nag-de-dedup ito: tinatanggal muna ang lumang
              trigger bago magrehistro ng bago para hindi mag-dobble.
  TECHNICAL : Removes any existing onSheetChange installable triggers, then
              registers a new onEdit installable trigger for onSheetChange().
  PARAMS    : (none) — run manually once in the Apps Script editor.
  RETURNS   : (void) — logs confirmation.
  ⚠️ NOTE   : Simple onEdit() triggers (from the editor) can't access user
              email; the INSTALLABLE trigger registered here can.
*/
function registerTrigger() {
  // ⚠️ INTENTIONALLY DISABLED — do NOT run this in production. Registering
  // onSheetChange makes it fire on every status write and send a SECOND copy of
  // every workflow email (the handle* paths already send them); worse, inside an
  // installable trigger Session.getActiveUser() resolves to the trigger OWNER,
  // not the acting approver, so receipts go to the wrong person. It sits next to
  // registerExpiryTrigger()/registerApproverReminderTrigger() (which you DO run),
  // so this guard prevents an accidental "run all three." If you ever truly need
  // the legacy sheet-change email path, remove this throw deliberately AND first
  // neutralize the email sends in handleCertificateRequestChange.
  throw new Error("registerTrigger() is intentionally disabled: it would double-send every workflow email. See the comment above this line.");

  // Remove any existing triggers first to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "onSheetChange") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Register the new trigger
  ScriptApp.newTrigger("onSheetChange")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  Logger.log("registerTrigger(): onSheetChange trigger registered successfully.");
}


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
              before the loop, whereas the previous per-row getApprovalActions()
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
  const rows = getDataRows(SHEET_NAMES.REQUESTS);
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

      const daysUntil = daysUntilContractEnd(rawEnd);
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
        sendExpiryReminderToRequestor(requestId, daysUntil);
        appendAction(requestId, groupId, 0, null, "system", ACTION.EXPIRY_WARNING, "Contract expires " + endStr);
        markExpiryFlag_(expiryFlags, requestId, ACTION.EXPIRY_WARNING);
        warned++;
      } else if (daysUntil === 0 && !hasNotice) {
        sendExpiryReminderToRequestor(requestId, daysUntil);
        appendAction(requestId, groupId, 0, null, "system", ACTION.EXPIRY_NOTICE, "Contract expires today " + endStr);
        markExpiryFlag_(expiryFlags, requestId, ACTION.EXPIRY_NOTICE);
        noticed++;
      } else if (daysUntil < 0 && !hasOverdue) {
        sendExpiryReminderToRequestor(requestId, daysUntil);
        appendAction(requestId, groupId, 0, null, "system", ACTION.EXPIRY_OVERDUE, "Contract expired " + endStr);
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
// the daily expiry sweep. Mirrors registerTrigger().
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
  getCurrentApprover(step, group) resolves the responsible approver email; rows are
  bucketed by normalizeEmail(approver) so a single approver gets ONE digest covering
  all their pending requests (regardless of step/group). Then sendPendingApprovalReminder
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
      Technical : Filter PENDING_*; getCurrentApprover→normalizeEmail key; push rowData.
    Step 2 — Send one digest per approver
      Layman    : Kada approver, isang email na listahan ng lahat niyang pending.
      Technical : Iterate buckets; sendPendingApprovalReminder(email, rows); count sends.

  EXAMPLE
    (trigger fires at 8am; approverA holds 2 pending, approverB holds 1)
    → 2 emails sent; log "reminded 2 approver(s)."
    → no pending rows: 0 emails; log "reminded 0 approver(s)."
*/
function checkPendingApprovals() {
  const rows    = getDataRows(SHEET_NAMES.REQUESTS);
  const pending = [STATUS.PENDING_1, STATUS.PENDING_2, STATUS.PENDING_3];
  const byApprover = {};   // normalized email -> [rowData, ...]

  rows.forEach(function (row) {
    try {
      if (pending.indexOf(row[CR.STATUS - 1]) === -1) return;
      const approver = getCurrentApprover(row[CR.STEP - 1], row[CR.GROUP - 1]);
      if (!approver) return;                       // unconfigured group / step 0 — skip
      const key = normalizeEmail(approver);
      if (!key) return;                            // guard against a blank approver cell
      (byApprover[key] = byApprover[key] || []).push(row);
    } catch (err) {
      Logger.log("checkPendingApprovals(): row error for " + row[CR.REQUEST_ID - 1] + " — " + err.message);
    }
  });

  let sent = 0;
  Object.keys(byApprover).forEach(function (email) {
    try {
      sendPendingApprovalReminder(email, byApprover[email]);
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