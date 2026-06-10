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
  approvers, attachments, admins, at COC PDFs — kaya mas malinis at walang
  3-approver cap.

  TECHNICAL:
  Central column-index maps + enums for the NORMALIZED 7-sheet schema.
  Top-level const objects; Apps Script shares ONE global scope so these are
  visible everywhere with no import.

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
  SHEET_NAMES — exact tab names for the 6 sheets
  CR          — Requests columns (25 cols; status/current_step/resubmit_count are CACHE)
  ACT         — Activity_Log columns (append-only timeline / audit log; 9 cols)
  GRP         — Groups columns (registry; surrogate group_id)
  GAP         — Group_Approvers columns (normalized chain; unlimited approvers)
  RA          — Request_Attachments columns
  ADM         — Admins columns (allowlist)
  COCPDF      — COC_PDFs columns (one row per generated certificate PDF)
  STATUS      — request status strings (frozen DTO contract)
  ACTION      — Approval_Actions.action enum
  COC         — Certificate generation + Drive folder IDs
*/


/*
  SHEET_NAMES — exact sheet tab names.
  LAYMAN    : Para hindi mamali ng spelling ng tab name kapag tumatawag.
  TECHNICAL : Pass these to getSheet()/getDataRows(). The bound spreadsheet's
              tabs MUST be named exactly these strings.
*/
const SHEET_NAMES = {
  REQUESTS:            "Requests",
  ACTIVITY_LOG:        "Activity_Log",       // the append-only action/event timeline
  GROUPS:              "Groups",
  GROUP_APPROVERS:     "Group_Approvers",
  REQUEST_ATTACHMENTS: "Request_Attachments",
  ADMINS:              "Admins",
  COC_PDFS:            "COC_PDFs",            // one row per generated certificate PDF
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
              previous-approvals, last-action-by, resubmit-history, and
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
  RESUBMIT_COUNT:       25,  // Y  ← cache (count of resubmit cycles)
};


/*
  ACT — Activity_Log column map (append-only timeline; the audit log).
  LAYMAN    : Bawat galaw sa isang request — submit, approve, decline, return,
              resubmit — ay isang row dito. Hindi kailanman binubura o
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
  RESUBMIT_CYCLE: 4,  // D  (0 = first cycle, 1+ after each resubmit)
  APPROVER_STEP:  5,  // E  (approver position 1/2/3; blank for submit/resubmit)
  ACTOR_EMAIL:    6,  // F  (who performed the action)
  ACTION:         7,  // G  ← ACTION enum
  REMARK:         8,  // H  (comment / decline reason / return reason)
  TIMESTAMP:      9,  // I  (server time)
};


/*
  COCPDF — COC_PDFs column map (one row per generated certificate PDF).
  LAYMAN    : Tuwing ma-generate ang COC PDF (pag fully approved), may row dito —
              link sa PDF, Drive file id, at kailan ginawa. Naka-refer sa request.
              Hiwalay na table para kung mag-re-issue/regenerate, may kasaysayan.
  TECHNICAL : 1-based. Appended by generateCOC() on full approval. 1:many-capable
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
  GAP — Group_Approvers column map (normalized chain — unlimited approvers).
  LAYMAN    : Sino-sino ang approvers bawat group, at anong pagkakasunod.
              Dating 3-slot lang; ngayon kasing-dami ng rows ang gusto mo.
              Ito ang ina-CRUD ng Admin role.
  TECHNICAL : 1-based. (GROUP_ID, SEQUENCE) is the composite key. SEQUENCE is
              the 1-based order in the chain. ACTIVE soft-disables a slot.
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
              kung aling resubmit cycle at sino ang nag-upload.
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
              never double-notifies for the same stage. getApprovalView() ignores
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
  COC — Certificate of Completion (Phase 9) + supporting-docs upload (Phase 8).
  LAYMAN    : Tatlong "address": (1) ang Google Docs template, (2) folder ng
              na-generate na COC PDF, (3) folder ng supporting documents.
  TECHNICAL : Used by generateCOC() (Certificate.js) and uploadAttachmentFile()
              (Attachments.js). Keep ATTACHMENTS_FOLDER_ID separate from
              ARCHIVE_FOLDER_ID. Both folders should be Restricted in Drive.
  ⚠️ SETUP  : Swap folder IDs to the Megaworld prod folders at go-live.
*/
const COC = {
  TEMPLATE_DOC_ID:       "1FBf-l49w-z_3bey0NdxZ3VABevFb2_7gbGw-l111MSs",
  ARCHIVE_FOLDER_ID:     "1LKmStUeJrJMWHBfMXlxw3HafGg1EdZ4C",
  ATTACHMENTS_FOLDER_ID: "1rJPkh0yaSEFOzzKfHZvu5h2Kx-WrhvZg",
};
