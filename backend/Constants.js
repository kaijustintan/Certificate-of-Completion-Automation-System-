// Constants.js
/*
  ════════════════════════════════════════════════════════════
  FILE: Constants.js
  ════════════════════════════════════════════════════════════

  LAYMAN (Tropang Ex):
  Ito yung "diksyunaryo ng mga column at status" ng buong project. Sa halip
  na tandaan kung saang column nakalagay ang bawat field (delikado sa typo),
  iisang sentral na listahan lang dito ang sinasandalan ng lahat. NORMALIZED
  na ang database: hiwalay nang sheets ang requests, approval actions, groups,
  approvers, attachments, admins, admin audit log, COC PDFs, at return flags.

  TECHNICAL:
  Central column-index maps + enums for the NORMALIZED 9-sheet schema.
  Top-level const objects; Apps Script shares ONE global scope so these are
  visible everywhere with no import. Note: approver STORAGE is N rows, but
  ROUTING is hard-capped at 3 (approve_/isChainApprover_/getApprovers_).

  ⚠️ TWO NUMBER SYSTEMS (the #1 footgun here):
    1-based → Sheet API:    sheet.getRange(row, CR.STATUS)   // CR.STATUS = 3
    0-based → array index:  row[CR.STATUS - 1]               // subtract 1

  ⚠️ NAMING NOTE: the constant `CR` historically meant "Certificate_Requests".
  After normalization the main sheet is renamed `Requests`, but the constant
  name `CR` is RETAINED (it still means "the request row's columns") to avoid
  churning every core-field read across the codebase.

  ────────────────────────────────────────────────────────────
  OUTLINE
  ────────────────────────────────────────────────────────────
  SHEET_NAMES — exact tab names for the 9 sheets
  CR          — Requests columns (25 cols; status/current_step/resubmit_count are CACHE)
  ACT         — Activity_Log columns (append-only timeline / audit log; 9 cols)
  GRP         — Groups columns (registry; surrogate group_id)
  GAP         — Group_Approvers columns (N stored; routing hard-capped at 3)
  RA          — Request_Attachments columns
  FLG         — Request_Flags columns (per-item flags raised on return)
  FLAGGABLE_FIELDS — the flaggable/editable field set (single source of truth)
  ADM         — Admins columns (allowlist)
  ADL         — Admins_Log columns (append-only admin audit)
  COCPDF      — COC_PDFs columns (one row per generated certificate PDF)
  STATUS      — request status strings (frozen DTO contract)
  ACTION      — Approval_Actions.action enum
  COC         — Certificate generation + Drive folder IDs
*/


/*
  SHEET_NAMES — exact sheet tab names.
  LAYMAN    : Para hindi mamali ng spelling ng tab name kapag tumatawag.
  TECHNICAL : Pass these to getSheet_()/getDataRows_(). The bound spreadsheet's
              tabs MUST be named exactly these strings.
*/
const SHEET_NAMES = {
  REQUESTS:            "Requests",
  ACTIVITY_LOG:        "Activity_Log",       // the append-only action/event timeline
  GROUPS:              "Groups",
  GROUP_APPROVERS:     "Group_Approvers",
  REQUEST_ATTACHMENTS: "Request_Attachments",
  ADMINS:              "Admins",
  ADMINS_LOG:          "Admins_Log",          // append-only audit of admin group/chain actions
  COC_PDFS:            "COC_PDFs",            // one row per generated certificate PDF
  REQUEST_FLAGS:       "Request_Flags",       // per-field/per-attachment flags raised on return (self-healing tab)
};


/*
  CR — Requests column map (A=1 … Y=25).
  LAYMAN    : Bawat field ng isang request, anong column number. Ang status,
              current_step, at resubmit_count ay "cache" lang — ang totoong
              kasaysayan ay nasa Approval_Actions. Group ay group_id na ngayon
              (FK papuntang Groups), hindi na ang pangalan.
  TECHNICAL : 1-based. STATUS(3)/STEP(4)/RESUBMIT_COUNT(25) are denormalized
              read-cache, kept current by the record* write-accessors. GROUP(9)
              stores a group_id (FK → GRP.GROUP_ID). The per-approver columns,
              previous-approvals, last-action-by, resubmit_-history, and
              expected-attachments are GONE — they live in Approval_Actions.
*/
const CR = {
  REQUEST_ID:           1,   // A
  CONTROL_NUMBER:       2,   // B
  STATUS:               3,   // C  ← cache (source of truth = Approval_Actions)
  STEP:                 4,   // D  ← cache: current active approver step (0 = with requestor)
  DATE_OF_FILING:       5,   // E
  PROJECT_TITLE:        6,   // F
  REQUESTOR:            7,   // G  (requestor_email)
  REQUESTOR_DESIG:      8,   // H
  GROUP:                9,   // I  ← FK → GRP.GROUP_ID (a group_id, not a name)
  ACCOUNTABLE_PERSON:   10,  // J
  DEPARTMENT:           11,  // K
  LOCATION:             12,  // L
  PC_NAME:              13,  // M
  PRISM:                14,  // N
  PURCHASE_ORDER:       15,  // O
  IHELP_NUMBER:         16,  // P
  PRODUCT_TYPE:         17,  // Q
  PRODUCT_NAME:         18,  // R
  TYPE_OF_PURCHASE:     19,  // S
  TYPE_OF_LICENSE:      20,  // T
  CONTRACT_START:       21,  // U
  CONTRACT_END:         22,  // V
  SUPPLIER_NAME:        23,  // W
  REQUESTOR_REMARK:     24,  // X
  RESUBMIT_COUNT:       25,  // Y  ← cache (count of resubmit_ cycles)
};


/*
  ACT — Activity_Log column map (append-only timeline; the audit log).
  LAYMAN    : Bawat galaw sa isang request — submit, approve_, decline_, return,
              resubmit_ — ay isang row dito. Hindi kailanman binubura o
              binabago. Dito kinukuha ang buong kasaysayan. Tab name: "Activity_Log".
  TECHNICAL : 1-based, 9 cols. One row per action, append-only. GROUP_ID is
              denormalized here so the log is self-sufficient for audit (which
              group's approver acted) without cross-referencing Requests.
              APPROVER_STEP = the approver position (1/2/3) the action pertains to.
              Replaces the old flat App1/2/3 date+remark, Previous_Approvals,
              Last_Action_By, Resubmit_History columns. ACTION = ACTION enum.
*/
const ACT = {
  ACTION_ID:      1,  // A  ← KEY
  REQUEST_ID:     2,  // B  ← FK → CR.REQUEST_ID
  GROUP_ID:       3,  // C  ← FK → GRP.GROUP_ID (denormalized for standalone audit)
  RESUBMIT_CYCLE: 4,  // D  (0 = first cycle, 1+ after each resubmit_)
  APPROVER_STEP:  5,  // E  (approver position 1/2/3; blank for submit/resubmit_)
  ACTOR_EMAIL:    6,  // F  (who performed the action)
  ACTION:         7,  // G  ← ACTION enum
  REMARK:         8,  // H  (comment / decline_ reason / return reason)
  TIMESTAMP:      9,  // I  (server time)
};


/*
  COCPDF — COC_PDFs column map (one row per generated certificate PDF).
  LAYMAN    : Tuwing ma-generate ang COC PDF (pag fully approved), may row dito —
              link sa PDF, Drive file id, at kailan ginawa. Naka-refer sa request.
              Hiwalay na table para kung mag-re-issue/regenerate, may kasaysayan.
  TECHNICAL : 1-based. Appended by generateCOC_() on full approval. 1:many-capable
              (re-issuance) — request_id is the FK, not unique.
*/
const COCPDF = {
  COC_ID:         1,  // A  ← KEY
  REQUEST_ID:     2,  // B  ← FK → CR.REQUEST_ID
  CONTROL_NUMBER: 3,  // C  (human-readable, denormalized)
  PDF_LINK:       4,  // D  (Drive URL of the generated PDF)
  DRIVE_FILE_ID:  5,  // E
  GENERATED_AT:   6,  // F
};


/*
  GRP — Groups column map (registry; surrogate primary key).
  LAYMAN    : Listahan ng mga approver groups. May sariling group_id (hindi
              na pangalan ang susi) kaya pwedeng i-rename nang hindi nasisira
              ang routing.
  TECHNICAL : 1-based. GROUP_ID(1) is the surrogate PK referenced by CR.GROUP
              and GAP.GROUP_ID. ACTIVE soft-disables a group.
*/
const GRP = {
  GROUP_ID:   1,  // A  ← KEY (e.g. G001)
  GROUP_NAME: 2,  // B  ← unique display name
  ACTIVE:     3,  // C
  CREATED_AT: 4,  // D
};


/*
  GAP — Group_Approvers column map (normalized chain).
  LAYMAN    : Sino-sino ang approvers bawat group, at anong pagkakasunod.
              Ito ang ina-CRUD ng Admin role. ⚠️ Kahit kaya ng SHEET na mag-imbak
              ng maraming approver, TATLO pa rin ang maximum na ginagamit ng
              routing — huwag magdagdag ng sequence 4 nang kamay.
  TECHNICAL : 1-based. (GROUP_ID, SEQUENCE) is the composite key. SEQUENCE is
              the 1-based order in the chain. ACTIVE soft-disables a slot.
              ⚠️ Storage is N rows but ROUTING IS HARD-CAPPED AT 3: getApprovers_
              reads sequences 1-3 only, approve_ branches steps 1-3 only, and
              isChainApprover_ checks slots 1-3 only. A hand-added sequence=4 row
              resolves in getCurrentApprover_ but fails isChainApprover_,
              silently locking that request out permanently. adminSaveChain
              enforces the cap for UI edits.
*/
const GAP = {
  ID:             1,  // A  ← KEY
  GROUP_ID:       2,  // B  ← FK → GRP.GROUP_ID
  SEQUENCE:       3,  // C  (1, 2, 3, … N)
  APPROVER_EMAIL: 4,  // D
  DESIGNATION:    5,  // E
  ACTIVE:         6,  // F
};


/*
  RA — Request_Attachments column map.
  LAYMAN    : Mga naka-attach na supporting documents bawat request, kasama
              kung aling resubmit_ cycle at sino ang nag-upload.
  TECHNICAL : 1-based. FILE(3) holds the friendly filename (Phase 8); FILE_LINK(4)
              the Drive URL (server-side only). RESUBMIT_CYCLE/UPLOADED_BY/
              UPLOADED_AT added during normalization.
*/
const RA = {
  ATTACHMENT_ID:  1,  // A  ← KEY
  REQUEST_ID:     2,  // B  ← FK → CR.REQUEST_ID
  FILE:           3,  // C  (filename — display)
  FILE_LINK:      4,  // D  (Drive URL — server-side only)
  DESCRIPTION:    5,  // E
  RESUBMIT_CYCLE: 6,  // F
  UPLOADED_BY:    7,  // G
  UPLOADED_AT:    8,  // H
};


/*
  FLG — Request_Flags column map (per-item flags raised when a request is returned).
  LAYMAN    : Kapag ibinalik ng approver ang request, pwede niyang markahan ang
              mga SPECIFIC na field o attachment na may problema, may komento
              bawat isa. Isang row bawat markang iyon. Kapag nag-resubmit ang
              requestor, mamamarkahan ang mga ito na "resolved" (hindi binubura
              — nananatili silang kasaysayan).
  TECHNICAL : 1-based, 9 cols. Append-only EXCEPT the single RESOLVED_CYCLE cell
              write done by resolveOpenFlags_() on resubmit. CYCLE = the request's
              resubmit_count at the moment of the return (which cycle the flag
              belongs to). TARGET_TYPE = 'field' | 'attachment'. TARGET_KEY = a
              FLAGGABLE_FIELDS key (field) or an RA.ATTACHMENT_ID (attachment).
              RESOLVED_CYCLE blank = open; set to the resolving resubmit's cycle.
              The tab is SELF-HEALING (ensureRequestFlagsTab_ in Accessors.js):
              it is created on the first flagged return, and flagRows_() reads
              fail-soft to [] when it does not exist yet.
*/
const FLG = {
  FLAG_ID:        1,  // A  ← KEY (e.g. "REQ-…-FLG")
  REQUEST_ID:     2,  // B  ← FK → CR.REQUEST_ID
  CYCLE:          3,  // C  (resubmit cycle the return happened in; 0 = original)
  TARGET_TYPE:    4,  // D  'field' | 'attachment'
  TARGET_KEY:     5,  // E  FLAGGABLE_FIELDS key or RA.ATTACHMENT_ID
  COMMENT:        6,  // F  the approver's per-item comment
  FLAGGED_BY:     7,  // G  approver email
  FLAGGED_AT:     8,  // H  server time
  RESOLVED_CYCLE: 9,  // I  blank = open; the cycle of the resubmit that addressed it
};


/*
  FLAGGABLE_FIELDS — the request fields an approver may flag and a requestor may
  edit on resubmit. THE single source of truth for that set.

  LAYMAN    : Listahan ng mga field na pwedeng markahan ng approver na "ito ang
              ayusin mo" at pwedeng i-edit ng requestor pag nag-resubmit. Ang
              'group' ay SADYANG WALA dito: hindi pwedeng palitan ang approver
              group sa kalagitnaan (ibang chain na yun — mag-decline na lang ang
              approver at mag-file ulit ang requestor).
  TECHNICAL : key = the frontend field name (same keys as the submit payload) →
              { label (display, also used in emails/error copy), col (CR.*) }.
              Drives four things: flag-target validation (validateReturnFlags_),
              the resubmit edit-payload allowlist (validateResubmitPayload_),
              the field-column mapping for the resubmit write, and display labels
              (DTO flaggableFields). 17 of the 18 user-entered fields — 'group'
              is deliberately excluded: ACT.GROUP_ID is denormalized per action,
              so a mid-history group change would make the audit log contradict
              itself, and the whole prior-approver machinery assumes one chain.
              Server-derived columns (id/control/status/step/dates/requestor/
              resubmit_count) are structurally absent.
*/
const FLAGGABLE_FIELDS = {
  projectTitle:      { label: "Project title",       col: CR.PROJECT_TITLE },
  requestorDesig:    { label: "Requestor designation", col: CR.REQUESTOR_DESIG },
  accountablePerson: { label: "Accountable person",  col: CR.ACCOUNTABLE_PERSON },
  department:        { label: "Department",          col: CR.DEPARTMENT },
  location:          { label: "Location",            col: CR.LOCATION },
  pcName:            { label: "PC name",             col: CR.PC_NAME },
  prism:             { label: "PRISM",               col: CR.PRISM },
  purchaseOrder:     { label: "Purchase Order",      col: CR.PURCHASE_ORDER },
  ihelpNumber:       { label: "IHelp number",        col: CR.IHELP_NUMBER },
  productType:       { label: "Product type",        col: CR.PRODUCT_TYPE },
  productName:       { label: "Product name",        col: CR.PRODUCT_NAME },
  typeOfPurchase:    { label: "Type of purchase",    col: CR.TYPE_OF_PURCHASE },
  typeOfLicense:     { label: "Type of license",     col: CR.TYPE_OF_LICENSE },
  contractStart:     { label: "Contract start date", col: CR.CONTRACT_START },
  contractEnd:       { label: "Contract end date",   col: CR.CONTRACT_END },
  supplierName:      { label: "Supplier name",       col: CR.SUPPLIER_NAME },
  requestorRemark:   { label: "Purpose / remark",    col: CR.REQUESTOR_REMARK },
};

// Flag payload ceilings (server-enforced in validateReturnFlags_).
const FLAG_MAX_ITEMS   = 25;    // fields (17) + attachments — generous but bounded
const FLAG_MAX_COMMENT = 500;   // per-item comment; the overall return remark carries the essay


/*
  ADM — Admins column map (allowlist for the admin role).
  LAYMAN    : Sino ang admin. Kung nasa listahang ito ang email mo (at active),
              admin ka.
  TECHNICAL : 1-based. EMAIL(1) is the key; ACTIVE gates access.
*/
const ADM = {
  EMAIL:    1,  // A  ← KEY
  ACTIVE:   2,  // B
  ADDED_AT: 3,  // C
};


/*
  ADL — Admins_Log column map (append-only audit of admin actions).
  LAYMAN    : Bawat ginawa ng admin sa mga group/chain — gumawa, nagpangalan,
              nag-on/off, nagpalit ng approvers — isang row dito: sino, ano,
              aling group, ano ang nabago, at kailan. Hindi binubura. Hiwalay
              ito sa Activity_Log dahil iba ang klase (config-scoped, walang
              request_id). Tab name: "Admins_Log".
  TECHNICAL : 1-based, 6 cols, append-only. Written ONLY via appendAdminLog_()
              from the admin* mutations. Deliberately NOT in Activity_Log
              (request-scoped; getApprovalView_ walks it). ACTION = ADMIN_ACTION.
*/
const ADL = {
  LOG_ID:       1,  // A  ← KEY
  ADMIN_EMAIL:  2,  // B  (who performed the action)
  ACTION:       3,  // C  ← ADMIN_ACTION enum
  TARGET_GROUP: 4,  // D  (the group_id acted on)
  DETAILS:      5,  // E  (human-readable change description / before→after diff)
  TIMESTAMP:    6,  // F  (server time)
};


/*
  STATUS — the request status strings (Requests.status / CR.STATUS).
  LAYMAN    : Buong "buhay" ng request: routed sa approver 1/2/3 → tapos
              (approved / declined / returned). Wala nang "Syncing Files" —
              upload-before-submit na (Phase 8).
  TECHNICAL : Canonical status strings — FROZEN DTO contract (compared in
              filters, email subjects, frontend badges). Always reference
              STATUS.* — a raw-string typo silently breaks routing.
*/
const STATUS = {
  PENDING_1: "Pending Approver 1",     // routed to Approver 1
  PENDING_2: "Pending Approver 2",     // routed to Approver 2
  PENDING_3: "Pending Approver 3",     // routed to Approver 3
  APPROVED:  "Fully Approved",         // all approvers signed off
  DECLINED:  "Declined",               // rejected at any step
  RETURNED:  "Returned to Requestor",  // sent back for revision
};


/*
  ACTION — the Activity_Log.action enum (ACT.ACTION values).
  LAYMAN    : Anong klaseng galaw — sumite, aprubado, tinanggihan, ibinalik,
              muling sinumite, o paalala ng pag-expire ng contract.
  TECHNICAL : Stored lowercase in ACT.ACTION. The first five drive derived
              status, history, who-acted, and N-of-M from the append-only
              timeline. The three EXPIRY_* values are SYSTEM-written idempotency
              flags (#10) — appended by checkContractExpiries() when each renewal
              reminder is emailed (T-3 / day-of / overdue), so the daily sweep
              never double-notifies for the same stage. getApprovalView_() ignores
              them (it only branches on approved/declined/returned/resubmitted),
              so history reconstruction is unaffected.
*/
const ACTION = {
  SUBMITTED:      "submitted",
  APPROVED:       "approved",
  DECLINED:       "declined",
  RETURNED:       "returned",
  RESUBMITTED:    "resubmitted",
  EXPIRY_WARNING: "expiry_warning",  // system: T-3 "expiring soon" reminder sent
  EXPIRY_NOTICE:  "expiry_notice",   // system: day-of "expires today" reminder sent
  EXPIRY_OVERDUE: "expiry_overdue",  // system: post-expiry "has expired" reminder sent
};


/*
  ADMIN_ACTION — the Admins_Log.action enum (ADL.ACTION values).
  LAYMAN    : Anong klaseng galaw ng admin — gumawa ng group, nagpangalan,
              nag-activate/deactivate, o nagpalit ng approver chain.
  TECHNICAL : Stored lowercase in ADL.ACTION. Written by appendAdminLog_() from
              the admin* mutations in Admin.js. Config-scoped audit — separate
              from the request-scoped ACTION enum.
*/
const ADMIN_ACTION = {
  GROUP_CREATED:     "group_created",
  GROUP_RENAMED:     "group_renamed",
  GROUP_ACTIVATED:   "group_activated",
  GROUP_DEACTIVATED: "group_deactivated",
  // Chain edits are classified by what actually changed (chainChangeAction_ in
  // Admin.js) so the log reads "approver_added" / "_removed" etc. instead of a
  // generic label. CHAIN_CHANGED is the fallback for a designation-only edit or
  // a mixed change that doesn't fit one bucket.
  APPROVER_ADDED:    "approver_added",     // grew: someone new, nobody dropped
  APPROVER_REMOVED:  "approver_removed",   // shrank: someone dropped, nobody new
  APPROVER_REPLACED: "approver_replaced",  // swap: someone in AND someone out
  CHAIN_REORDERED:   "chain_reordered",    // same people, different order
  CHAIN_CHANGED:     "chain_changed",      // fallback (designation-only / mixed)
};


/*
  COC — Certificate of Completion (Phase 9) + supporting-docs upload (Phase 8).
  LAYMAN    : Dalawang "address": (1) folder ng na-generate na COC PDF,
              (2) folder ng supporting documents.
  TECHNICAL : Used by generateCOC_() (Certificate.js) and uploadAttachmentFile_()
              (Attachments.js). Keep ATTACHMENTS_FOLDER_ID separate from
              ARCHIVE_FOLDER_ID. Both folders should be Restricted in Drive.
  ⚠️ SETUP  : Swap folder IDs to the Megaworld prod folders at go-live.

  ⚠️ TEMPLATE_DOC_ID WAS REMOVED (2026-08-11). The certificate is no longer built
  from a Google Doc template; buildCertificateHtml_ (Certificate.js) renders it
  directly, so there is no external Doc to configure, lose, or silently edit. If
  a stale TEMPLATE_DOC_ID Script Property still exists on a deployment, it is
  simply ignored, but delete it so it does not read as live config.
*/
const COC = {
  ARCHIVE_FOLDER_ID:     "1LKmStUeJrJMWHBfMXlxw3HafGg1EdZ4C",
  ATTACHMENTS_FOLDER_ID: "1rJPkh0yaSEFOzzKfHZvu5h2Kx-WrhvZg",
};


/*
  ORG — organization / tenant configuration.

  LAYMAN (Tropang Ex):
  Dito nakalagay kung anong email domain ang pinapayagan sa portal. Kapag
  na-deploy ito sa Megaworld account, ilagay dito ang "megaworldcorp.com" para
  kahit sakaling mali ang pagka-set ng deployment (napili ang "Anyone" imbes na
  "Anyone within Megaworld"), hindi pa rin makakapasok ang taga-labas. Kapag
  WALANG laman ang listahan, lahat pinapayagan — ganito habang nagte-test sa
  personal/DLSU account.

  TECHNICAL:
  Deployment-scoped allowlist, checked server-side by isAllowedDomain_()
  (WebApp.js) at the app entry point (getCurrentUser) and at request creation
  (submitNewRequest). This is DEFENCE IN DEPTH, not the primary gate — the
  real gate is the Apps Script deployment setting "Who has access: Anyone
  within <Workspace domain>" plus "Execute as: Me", which Google enforces
  before any of this code runs. This backstop exists because a misconfigured
  "Anyone" deployment makes Session.getActiveUser().getEmail() return "" for
  outsiders, and a blank caller must never be able to write rows.

  ⚠️ It is an ARRAY on purpose: organizations often have more than one valid
  domain (subsidiaries, contractors, a legacy domain). Add every domain that
  should be allowed. An empty array disables the check entirely.

  ⚠️ AN EMPTY ARRAY IS NOT "THE DEV SETTING", IT IS "NO SETTING". It allows every
  Google account on earth, including personal gmail. Listing the real dev domain
  explicitly is strictly SAFER than leaving it empty, and it is why this now
  ships with two entries rather than none.

  Values are compared lowercase, without the "@".

  EXAMPLE
    ALLOWED_DOMAINS: []                                   // allow ALL (never do this)
    ALLOWED_DOMAINS: ["megaworldcorp.com"]                // final production state
    ALLOWED_DOMAINS: ["megaworldcorp.com", "megaworld.com.ph"]  // multi-domain org
*/
const ORG = {
  // Both the production domain and the current maintainer's domain. The portal
  // presently runs on a personal DLSU-owned Apps Script project, and the
  // maintainer has no Megaworld account, so removing dlsu.edu.ph today would
  // lock the only person who can deploy it out of the system entirely.
  //
  // This is deliberately NOT an empty array: [] would allow ANY Google account,
  // so naming both domains is the tighter of the two options available.
  ALLOWED_DOMAINS: ["megaworldcorp.com", "dlsu.edu.ph"],

  // ⚠️ REMOVE-BEFORE-HANDOVER LIST. Anything named here is a temporary access
  // exception, not a real organization domain. _testConfig() prints a loud
  // warning for every entry that is still live in ALLOWED_DOMAINS above, so the
  // go-live smoke test catches a forgotten one instead of relying on memory.
  //
  // To finish the handover: delete "dlsu.edu.ph" from BOTH arrays. That is the
  // whole change. Confirm by running _testConfig() and seeing the warning gone.
  TRANSITIONAL_DOMAINS: ["dlsu.edu.ph"],
};


// =========================================================================================================
// RUNTIME CONFIG RESOLVER (Script Properties, with the constants above as fallback)
// =========================================================================================================
/*
  LAYMAN (Tropang Ex):
  Dati, kapag ilipat ang portal sa ibang Google account, kailangang i-edit ang
  source code (yung mga Drive folder ID sa itaas) tapos i-redeploy. Ngayon,
  pwede nang ilagay ang mga halagang iyon sa "Script Properties" ng Apps Script
  project (Project Settings → Script Properties) — settings lang, hindi code.

  Ang order ng paghahanap: (1) Script Property, (2) yung literal sa itaas
  bilang fallback, (3) kung wala sa dalawa, malinaw na error na may pangalan ng
  susi. Dahil may fallback, WALANG masisira sa dev account kahit wala pang
  naka-set na kahit isang property — ganito rin ang paraan para i-rollback:
  burahin lang ang properties at babalik sa mga literal.

  TECHNICAL:
  Script-Property-first config resolution with a Constants.js literal fallback.
  Properties are project-scoped (shared by /dev and /exec), are NOT pushed by
  clasp, and are NOT in git — they must be re-entered by hand on a new project.

  ⚠️ TRAILING UNDERSCORE IS A SECURITY BOUNDARY, not style. Any non-underscored
  top-level function is callable from the browser via google.script.run, so a
  bare config("ARCHIVE_FOLDER_ID") would leak every Drive ID to any signed-in
  user. Keep these private. (_testConfig uses a LEADING underscore instead
  because trailing-underscore functions do not appear in the editor's Run menu.)

  ⚠️ NO SERVICE CALLS AT FILE-LOAD TIME. Everything here runs inside a function
  body. A PropertiesService call in a top-level initializer would fire on every
  single execution (every doGet, every google.script.run, every trigger) and a
  failure there is an uncatchable script-load error that breaks the whole app.
*/

// Execution-scoped memo. Apps Script discards globals after each execution, so
// this is one cached read per call, and a property edit takes effect on the very
// next execution with no cache to clear. Plain null literal — no service call.
var SCRIPT_PROPS_CACHE_ = null;

/*
  scriptProps_ — all script properties as a plain object, read at most once per execution.
  LAYMAN    : Isang beses lang kunin lahat ng settings, tapos i-reuse.
  TECHNICAL : Memoized single getProperties() call. Never throws: on failure it
              logs and memoizes {} so callers fall through to their literals
              instead of retrying the failing service N times.
  RETURNS   : Object of key → string value (possibly empty).
*/
function scriptProps_() {
  if (SCRIPT_PROPS_CACHE_ === null) {
    try {
      SCRIPT_PROPS_CACHE_ = PropertiesService.getScriptProperties().getProperties() || {};
    } catch (e) {
      Logger.log("scriptProps_(): could not read Script Properties, using Constants.js fallbacks — " + e);
      SCRIPT_PROPS_CACHE_ = {};
    }
  }
  return SCRIPT_PROPS_CACHE_;
}

/*
  configFallback_ — the Constants.js literal for a config key, or null.
  LAYMAN    : Kung wala sa Script Properties, ito ang hahanapin sa code.
  TECHNICAL : switch INSIDE the function body on purpose (a top-level const map
              would add load-time evaluation). ORG.ALLOWED_DOMAINS is
              deliberately absent: it is a version-controlled security control,
              so a stray config_("ALLOWED_DOMAINS") throws rather than resolving.
  PARAMS    : key — the bare property key.
  RETURNS   : String literal or null if the key has no source fallback.
*/
function configFallback_(key) {
  switch (key) {
    // TEMPLATE_DOC_ID intentionally absent — the Doc-template engine is gone.
    case "ARCHIVE_FOLDER_ID":     return COC.ARCHIVE_FOLDER_ID;
    case "ATTACHMENTS_FOLDER_ID": return COC.ATTACHMENTS_FOLDER_ID;
    default:                      return null;
  }
}

/*
  config_ — resolve a required config value. FAIL-LOUD.
  LAYMAN    : Kunin ang setting. Kung wala kahit sa Script Properties kahit sa
              code, mag-e-error agad na may pangalan ng susi — para hindi ka
              maghanap kung anong mali (ito ang aral sa maling template Doc ID
              na nagbigay ng malabong Drive error).
  TECHNICAL : Property → Constants.js fallback → throw a named Error. Values are
              trimmed: pasting a Drive ID into the Properties UI routinely picks
              up trailing whitespace, and getFolderById(" 1abc ") fails opaquely.
              Trimming is a no-op on the fallback path (literals are clean), so
              this introduces zero behaviour change until properties are used.
  PARAMS    : key — the bare property key (e.g. "ARCHIVE_FOLDER_ID").
  RETURNS   : Non-empty trimmed string.
  THROWS    : Error naming the key when neither source has a usable value.

  EXAMPLE
    config_("ARCHIVE_FOLDER_ID")  → "1LKmStUeJrJMWHBfMXlxw3HafGg1EdZ4C"
*/
function config_(key) {
  const fromProp = scriptProps_()[key];
  if (fromProp !== undefined && fromProp !== null && String(fromProp).trim() !== "") {
    return String(fromProp).trim();
  }
  const fromSource = configFallback_(key);
  if (fromSource !== undefined && fromSource !== null && String(fromSource).trim() !== "") {
    return String(fromSource).trim();
  }
  throw new Error("Script property " + key + " is not set and no fallback exists in Constants.js.");
}

/*
  configFlag_ — resolve an optional boolean config value. FAIL-SOFT.
  LAYMAN    : Para sa mga on/off na setting. Kung wala o hindi mabasa, gagamitin
              ang default — hindi mag-e-error.
  TECHNICAL : Reads scriptProps_() DIRECTLY (never via config_, which throws).
              Accepts true/1/yes and false/0/no, case-insensitive and trimmed.
              Anything unrecognized logs and returns the default.
  PARAMS    : key — bare property key; dflt — boolean returned when unresolvable.
  RETURNS   : Boolean.

  EXAMPLE
    configFlag_("EMAIL_DEV_TAG", true)  → false   // when the property is "false"
    configFlag_("EMAIL_DEV_TAG", true)  → true    // when the property is unset
*/
function configFlag_(key, dflt) {
  const raw = scriptProps_()[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return dflt;
  const v = String(raw).trim().toLowerCase();
  if (v === "true"  || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no")  return false;
  Logger.log("configFlag_(): unrecognized value for " + key + " ('" + raw + "'), using default " + dflt);
  return dflt;
}

/*
  _testConfig — editor smoke test for the config resolver. Logs only.
  LAYMAN    : I-Run ito sa Apps Script editor para makita kung saan nanggagaling
              ang bawat setting: sa Script Property o sa code (fallback). Wala
              itong ibinabalik at wala itong binabago — tingin lang.
  TECHNICAL : Prints each resolved value with a [PROPERTY] / [fallback] source
              tag, the EMAIL_DEV_TAG flag, then exercises the fail-loud path with
              a nonexistent key so the exact error text is visible. Returns
              nothing, so nothing crosses the google.script.run boundary.
  PARAMS    : (none) — run from the editor.
  RETURNS   : (void).
*/
function _testConfig() {
  const props = scriptProps_();
  ["ARCHIVE_FOLDER_ID", "ATTACHMENTS_FOLDER_ID"].forEach(function (k) {
    const hasProp = props[k] !== undefined && props[k] !== null && String(props[k]).trim() !== "";
    let resolved;
    try { resolved = config_(k); } catch (e) { resolved = "<<UNRESOLVED: " + e.message + ">>"; }
    Logger.log(k + " = " + resolved + "   " + (hasProp ? "[PROPERTY]" : "[fallback(Constants.js)]"));
  });
  Logger.log("EMAIL_DEV_TAG = " + configFlag_("EMAIL_DEV_TAG", EMAIL_DEV_TAG) +
             "   (source literal = " + EMAIL_DEV_TAG + ")");
  // ⚠️ This control FAILS OPEN by design (empty array = allow every domain), which
  // is correct for dev and wrong for production. Because a forgotten setting here
  // is silent — everyone simply keeps working — the smoke test has to shout.
  const domains = (typeof ORG !== "undefined" && ORG.ALLOWED_DOMAINS) || [];
  Logger.log("ORG.ALLOWED_DOMAINS = " + JSON.stringify(domains) +
             "   [source only — deliberately NOT a Script Property]");
  Logger.log(domains.length
    ? "  → domain gate ACTIVE: only these domains may sign in."
    : "  → ⚠️ DOMAIN GATE OFF — ANY Google account that can open the app is allowed, " +
      "including personal gmail. Set ORG.ALLOWED_DOMAINS in Constants.js " +
      "(e.g. [\"megaworldcorp.com\"]). See GO_LIVE_RUNBOOK Phase D1b.");

  // Temporary access exceptions still live? Shout. This is the check that stops a
  // maintainer-access domain from silently surviving into production, which is
  // otherwise invisible: everything keeps working, so nothing ever surfaces it.
  const transitional = (typeof ORG !== "undefined" && ORG.TRANSITIONAL_DOMAINS) || [];
  const stillLive = transitional.filter(function (t) {
    const tl = String(t).trim().toLowerCase();
    return domains.some(function (d) { return String(d).trim().toLowerCase() === tl; });
  });
  if (stillLive.length) {
    Logger.log("  → ⚠️ TEMPORARY DOMAIN EXCEPTION STILL ACTIVE: " + JSON.stringify(stillLive));
    Logger.log("     These are maintainer-access domains, NOT organization domains. Anyone with " +
               "an account on them can sign in and file requests.");
    Logger.log("     BEFORE FINAL HANDOVER: delete them from BOTH ORG.ALLOWED_DOMAINS and " +
               "ORG.TRANSITIONAL_DOMAINS in Constants.js, then re-run _testConfig to confirm " +
               "this warning is gone.");
  } else if (transitional.length) {
    Logger.log("  → temporary domain exceptions: all cleared. ✅");
  }
  // Fail-loud proof, using a key that can never hold a real value.
  try {
    config_("NO_SUCH_KEY_SMOKE_TEST");
    Logger.log("UNEXPECTED: fail-loud path did not throw.");
  } catch (e) {
    Logger.log("fail-loud OK → " + e.message);
  }
}
