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
  Installable onEdit trigger entry point. Routes to sheet-specific handlers by
  tab name; certificate-request changes route further by column (STATUS only).

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  - onSheetChange(e)                   entry point; routes by sheet name
  - handleCertificateRequestChange     STATUS-column watcher; fires emails
  - handleAttachmentChange             new-row detector; calls sync check
  - registerTrigger()                  one-time setup; run once manually
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

    if (sheetName === SHEET_NAMES.CERTIFICATE_REQUESTS) {
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
  const rowData   = sheet.getRange(row, 1, 1, 31).getValues()[0];
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
    const expectedAttachments = rowData[CR.EXPECTED_ATTACHMENTS - 1];
    const actualCount         = countAttachments(requestId);

    // Only send approval email if attachments are satisfied
    // Replaces: OR([Expected_Attachments]=0,
    //              COUNT([Related Request_Attachments])>=[Expected_Attachments])
    if (expectedAttachments === 0 || actualCount >= expectedAttachments) {
      sendApprovalRequest(requestId);
    }
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