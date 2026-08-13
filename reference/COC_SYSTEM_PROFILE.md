# COC System Profile for Cross-Repository Review

**Repository:** `megaworld-COC-automation`
**System:** Megaworld E-Certificate (Certificate of Completion) Portal
**Profiled at commit:** `bf20b31`, plus four uncommitted fixes described in 12.1, 12.4, and 12.13
**Profile date:** 2026-08-11 (revised same day after the fixes landed)
**Audience:** an AI agent working inside the DCS repository, with no prior knowledge of this codebase.

> **Read this first.** This document describes the system *as built*, including things that are wrong with it. It is not a sales pitch and not a spec. Where the code and its own documentation disagree, this document follows the code and says so. Section 12 lists weaknesses, including one live regression that is currently in `main` and pushed to the Apps Script project.

> ## ⚠️ ADDENDUM — final audit batch (2026-08-13). Read before trusting counts below.
>
> A final pre-handover batch landed after this profile was written. `reference/FINAL_AUDIT_REPORT.md` is the authoritative account; the deltas that invalidate statements below:
>
> 1. **New feature: per-field/per-attachment flagging on return + fully editable resubmit.** A 9th sheet `Request_Flags` (self-healing tab, `FLG.*`), `FLAGGABLE_FIELDS` allowlist in `Constants.js` (17 fields; `group` deliberately excluded), optional 3rd args on `handleReturn`/`handleResubmit` (no new callables), a full prefilled edit form on resubmit, flag highlights + "What needs fixing" card on both detail pages, flag list in the return email, and a "Changed: <fields>" summary on the RESUBMITTED timeline action. This retires 12.12's "requestors can only re-upload, not edit" limitation.
> 2. **The database is now 9 tabs**, not 8 (§1, §4 counts are stale by one).
> 3. **The callable surface is now exactly 27**, not 31: the dormant `onSheetChange` trigger family (`handleCertificateRequestChange`'s parallel email path, `handleAttachmentChange`, `registerTrigger`) was DELETED, along with `checkAttachmentSync_`, `deleteAttachment_`, `countAttachments_`, frontend `emotionFor`, and `backend/Code.js`. This resolves 12.9 entirely. The call-graph checker is now COMMITTED at `tools/callable-surface.js` (partially addresses 12.8).
> 4. **Concurrency (12.5 adjacent):** `submitNewRequest` now takes the script lock around its sheet writes; `writeAttachmentRows_` runs inside `resubmit_`'s lock (the racy `getLastRow()+1` interleave is closed); `updateGroupFields_` is locked.
> 5. **Performance (12.4):** `getRowNumberByRequestId_` is now a `createTextFinder` lookup (the "still open" linear scan is closed); `isAdmin_` and `Request_Attachments` reads are execution-memoized with writer-side invalidation.
> 6. **Validation (12.13):** leading-`=` formula injection is now REJECTED at every free-text write path (fields, remarks, file descriptions, flag comments, admin group names/designations); admin group name (80), approver email (254), and designation (200) now have server-side caps.
> 7. **12.10 (documentation drift) and 12.14 (frontend copies of the request table / filter builders) are substantially resolved**; the three near-identical tables now share `renderRequestTable` in `UI.html`.
> 8. Still true and still the largest risk: **none of this has ever executed** (12.2). The consolidated execution order is `reference/TEST_SCRIPT.md`, now with Phase 8 for this batch.

---

## 1. What this system is

A single-tenant internal approval portal that replaces a legacy Google AppSheet application. An employee ("requestor") files a request for a software or license Certificate of Completion, attaches supporting documents, and the request routes through a sequential chain of up to three named approvers. On full approval the system generates a branded PDF certificate from a Google Docs template, archives it to Drive, and emails it to the requestor as an attachment.

It is not a general workflow engine. The domain is hardcoded: one request type, one certificate type, one organization.

**Runtime:** Google Apps Script (V8), container-bound to a Google Spreadsheet.
**Database:** Google Sheets (8 tabs).
**Frontend:** a custom single-page application served as one HTML document via `HtmlService`.
**Deployment:** `clasp` from VS Code, pushed to an Apps Script project, published as a web app.
**Timezone:** `Asia/Manila`, set in `appsscript.json` and used consistently in every date format call.

### OAuth scopes requested (`appsscript.json`)

```
spreadsheets · drive · documents · mail.google.com · userinfo.email · script.scriptapp
```

Note that `drive` and `mail.google.com` are both **full-access** scopes, not the narrower `drive.file` / `gmail.send`. This matters for the security model in Section 9: the script runs as its owner with these permissions, so any callable function is effectively an API endpoint executing with the owner's full Drive and Gmail authority.

---

## 2. The two runtime constraints that shape everything

Almost every unusual decision in this codebase traces back to one of these two facts. Understand them before judging any design choice.

### 2.1 One global scope, no module system

Apps Script concatenates every `.js` file in the project into a single global scope. There are no imports, no exports, no modules, no namespacing. A function defined in `Utils.js` is directly callable from `Emails.js` with no ceremony. Consequences that show up throughout:

- File organization is purely a human convention. It carries zero enforcement.
- Name collisions are a real hazard. The codebase has explicit comments where a function was *moved* between files, warning that re-declaring it would collide (`Utils.js` still carries a comment block where `getApprovers_` used to live, pointing to `Accessors.js`).
- Load order matters for top-level `const` evaluation. `Constants.js` is deliberately first in the push order so its bindings exist before any other file evaluates.
- There is no dependency injection and no seam for unit testing. There is no test suite (see 12.8).

### 2.2 Every top-level function is a public HTTP endpoint

This is the single most important thing to know about this codebase.

There is no route table. Any top-level function in any `.js` file is directly invocable from any authenticated user's browser console via `google.script.run.functionName(args)`. Hiding a button, gating a page, or simply never calling a function from the frontend provides **zero** security.

The only mechanism that removes a function from that surface is a **trailing underscore** (`fnName_`), which Apps Script refuses to expose over `google.script.run` while keeping it callable server-side. A **leading** underscore (`_fnName`) does nothing at all.

The current numbers, verified by static analysis of the repository:

| Metric | Count |
|---|---|
| Top-level functions defined across 12 backend files | 148 |
| Hidden from `google.script.run` (trailing `_`) | 109 |
| Still callable from a browser console | 39 |
| Actually invoked by the frontend | 16 |

The gap between 39 and 16 is intentional and consists of trigger handlers, the `doGet` entry point, `include`, and editor-run test helpers, all of which cannot take a trailing underscore for structural reasons and are instead guarded by `isOwnerContext_()` (see 9.4).

This surface was 118 callable functions as recently as commit `b8869de`. Commit `bf20b31` closed it. That sweep is the source of the live regression in 12.1.

---

## 3. Folder structure

```
megaworld-COC-automation/
├── appsscript.json              manifest: timezone, V8 runtime, OAuth scopes
├── CLAUDE.md                    project conventions (agent-facing, checked in)
├── README.md                    2 lines; effectively unmaintained
├── backend/                     12 .js files, ~7,000 lines
│   ├── Constants.js    (532)    column maps, enums, config resolver
│   ├── Utils.js        (336)    sheet access, dates, ID generators
│   ├── Accessors.js    (719)    THE normalized-DB seam
│   ├── WebApp.js      (1207)    doGet, auth helpers, read DTOs, submit, action handlers
│   ├── Approvals.js    (312)    the 4 state mutators
│   ├── Admin.js        (603)    Tier-2 admin callables
│   ├── Attachments.js  (482)    upload, validation, gated serving
│   ├── Certificate.js  (407)    COC PDF generation
│   ├── Emails.js      (1378)    15 notification functions
│   ├── EmailHtml.js    (484)    HTML email layout primitives
│   ├── Triggers.js     (539)    2 daily sweeps + 1 dormant sheet-change path
│   └── Code.js          (21)    empty placeholder
├── frontend/                    ~6,900 lines of HTML/CSS/JS
│   ├── Index.html      (84)     SPA shell; load order is critical
│   ├── Stylesheet.html(1716)    one global stylesheet, design tokens in :root
│   ├── JavaScript.html (694)    state, router, server bridge, utilities, bootstrap
│   ├── components/              StatusBadge, EmptyState, MigaWidget, Navbar, UI
│   └── pages/                   Login, Dashboard, NewRequest, RequestDetail,
│                                ApproverDashboard, ReviewDetail, Admin
├── reference/                   architecture, flows, column map, runbook, roadmap
├── migration-context/           9 numbered handoff docs
└── assets/                      mascot PNGs ("Miga")
```

Backend and frontend are cleanly separated by directory, but remember 2.1: at runtime the backend files share one scope, and the frontend files are concatenated into one HTML document with one browser-global scope. The directory structure is documentation, not isolation.

---

## 4. Database design

The database was migrated from a 35-column monolithic sheet into 8 purpose-built tabs. This normalization is the most consequential architectural decision in the repository.

### 4.1 The 8 tabs

| Tab | Constant | Cols | Role |
|---|---|---|---|
| `Requests` | `CR` | 25 | The core request row. One per request. |
| `Activity_Log` | `ACT` | 9 | Append-only action timeline. **Source of truth.** |
| `Groups` | `GRP` | 4 | Approver-group registry, surrogate PK `G001`. |
| `Group_Approvers` | `GAP` | 6 | The approver chain. Composite key (group_id, sequence). |
| `Request_Attachments` | `RA` | 8 | One row per uploaded file. |
| `Admins` | `ADM` | 3 | Admin allowlist. Hand-managed, no UI. |
| `Admins_Log` | `ADL` | 6 | Append-only audit of admin config actions. |
| `COC_PDFs` | `COCPDF` | 6 | One row per generated certificate. Re-issuance capable. |

Column indices are never hardcoded. Every read and write goes through a constant map in `Constants.js`. There are two number systems in play and the codebase warns about it repeatedly:

```js
sheet.getRange(row, CR.STATUS)   // 1-based, Sheet API
row[CR.STATUS - 1]               // 0-based, array index
```

### 4.2 The event-sourcing decision

`Activity_Log` is the source of truth for workflow state. It is strictly append-only: no row is ever updated or deleted. Each row records `(action_id, request_id, group_id, resubmit_cycle, approver_step, actor_email, action, remark, timestamp)`.

`Requests.status`, `Requests.current_step`, and `Requests.resubmit_count` are a **denormalized read-cache** over that timeline, maintained solely by `setRequestCache_()`. They exist so dashboards can filter without replaying the log.

Everything else historical is *derived on read*, not stored. `getApprovalView_(requestId)` in `Accessors.js` does a single pass over one request's timeline and reconstructs:

- `byStep` — per-approver date and remark for the current cycle
- `previousApprovals` — who has signed this cycle
- `priorApprovals` — who signed in earlier cycles (drives the "you approved this before, please re-review" note)
- `approvedCount` — the N in "N of M"
- `latestRemark` — most recent decline or return reason across all cycles
- `resubmitHistory` — a formatted string in a frozen legacy format
- `currentCycle`

This is why the migration from the 35-column monolith barely touched the UI. The DTO shape returned to the frontend is deliberately frozen and identical to the pre-normalization shape.

### 4.3 The Accessors seam

`Accessors.js` is the single door to the normalized schema. Feature code never reads `Activity_Log`, `Groups`, or `Group_Approvers` directly. It calls accessors. The seam preserves a legacy 6-field shape:

```js
getApprovers_(groupId)
// → { approver1, designation1, approver2, designation2, approver3, designation3 }
```

built from the first three rows of `Group_Approvers`. This compatibility shim is why the 3-approver cap in 12.6 persists even though the schema supports N.

Write primitives are similarly centralized: `appendAction_()` and `setRequestCache_()` are the only writers of the timeline and the cache.

### 4.4 Enums (frozen contracts)

`STATUS` (6 values): `Pending Approver 1|2|3`, `Fully Approved`, `Declined`, `Returned to Requestor`. These exact strings are compared in filters, email subjects, and frontend badge maps. A raw-string typo silently breaks routing, which is why the codebase mandates `STATUS.*` everywhere.

`ACTION` (8 values): five workflow actions (`submitted`, `approved`, `declined`, `returned`, `resubmitted`) plus three **system** flags (`expiry_warning`, `expiry_notice`, `expiry_overdue`). The system flags are idempotency markers written by the daily expiry sweep, not approval events. `getApprovalView_()` ignores them.

`ADMIN_ACTION` (9 values): `group_created`, `group_renamed`, `group_activated`, `group_deactivated`, plus five chain-edit classifications (`approver_added`, `approver_removed`, `approver_replaced`, `chain_reordered`, `chain_changed`).

A `SYNCING` status existed historically and was removed when upload-before-submit landed. There is no waiting-for-files state.

---

## 5. The end-to-end workflow

### 5.1 Submission

Entry: `submitNewRequest(formData)` in `WebApp.js`. The ordering here is deliberate and is the clearest example of the codebase's atomicity thinking.

1. **Identity gate.** `isAllowedDomain_(caller)`. Rejects a blank or out-of-domain email before anything else.
2. **Validate files.** `validateAttachmentPayload_()`. Pure, no I/O. Caps: 5 MB per file (estimated from base64 length), 15 MB total, 10 files max, every file must carry a non-blank description, at least one file required.
3. **Validate text.** `validateRequestFields_()`. 200-char cap on 14 short fields, 2000 on the remark, and a contract-end-not-before-start ordering check. Blanks stay acceptable: this does not newly require any field.
4. **Reject a chain-less group.** `getApprovers_(group)` must return a usable `approver1`. A group with an active row but a blank email is rejected too, because such a request would route to nobody and sit invisible forever.
5. **Generate identifiers.** `generateRequestId_()` returns `REQ-<32 hex>`; the loop regenerates until unique. `generateControlNumber_()` produces the human-facing `EC-YYYY-NNNNN-XXX`.
6. **Upload every file to Drive first.** If any upload throws, every already-uploaded file is trashed and no sheet row is written. Drive uploads can fail; sheet appends cannot be cleanly rolled back, so all risky I/O happens before any sheet write.
7. **Write the request row** (`PENDING_1`, step 1, resubmit_count 0), then the attachment child rows in one batched `setValues`, then append the `submitted` action **last**. The timeline write is last on purpose: it is append-only and can never be un-written, so stranding a `submitted` row for a request that failed to write would poison the audit trail.
8. **On any failure in step 7:** trash the files, and re-resolve the row *by request ID* (never by a captured row index, since a concurrent submit could have shifted rows) and delete it.
9. **Email Approver 1 last.** A mail failure must not roll back a committed request.

### 5.2 Approval

Entry: `handleApprove(requestId)` (`WebApp.js`) → `approve_(requestId)` (`Approvals.js`).

Both layers guard. The handler checks `isCurrentApprover_`. The mutator re-checks independently, because it is reachable directly via `google.script.run` around the handler. The mutator takes a `LockService` script lock and re-reads status *inside* the lock, making it a true compare-and-set.

Routing rule, and this is a real business rule worth carrying across:

> `approve_()` **skips blank approver slots**. If a group has only slot 1 configured, approving at step 1 goes straight to `Fully Approved`, skipping steps 2 and 3.

The next step is derived from the next *pending status*, not from `step + 1`. This fixes a gapped-chain case where slot 2 is soft-disabled: `step+1` would route to an empty step and orphan the request.

Because of skip-blank, **`step` is not a reliable "N of M" counter**. Any progress display must compute N as `getApprovalView_().approvedCount` and M as the count of non-null approver slots from `getApprovers_()`.

On full approval: two emails fire, and the requestor's email triggers COC generation (5.6). On an intermediate approval: three emails fire (next approver, actioner receipt, requestor progress update).

### 5.3 Decline

`handleDecline` → `decline_`. Appends a `declined` action with the reason and sets status to `Declined`. **Terminal.** There is no resubmit path from a declined request; the requestor must file a new one. `step` is deliberately not reset, but the status guard in all four mutators blocks any further action on a non-pending request, which is what closes the "decliner re-opens their own decline" hole.

### 5.4 Return and resubmit (the revision loop)

`handleReturn` → `returnRequest_`. Appends a `returned` action with the reason, sets status to `Returned to Requestor` and step to 0. Three emails fire: the requestor, the returner (receipt), and every approver who had already signed this cycle.

`handleResubmit(requestId, newFiles)`. Owner-only, and only from `Returned`. New files are optional; **prior files are always kept**. Ordering:

1. Validate the new payload (`requireAtLeastOne = false`).
2. Upload new files to Drive, rolling back on failure. No state has changed yet.
3. Flip state via `resubmit_()`: cycle becomes N+1, status returns to `PENDING_1`, step to 1. If this fails on a lock timeout, the uploaded files are trashed.
4. **Only then** write the attachment rows, tagged with the new cycle. The state flip precedes the row write specifically so that files are never filed under a "Resubmit #N" that never happened.
5. Email the requestor a confirmation and Approver 1 a dedicated resubmission notice.

Cycle tagging is what makes history work. Approvals from cycle N-1 remain in the timeline tagged to that cycle, so the new cycle starts clean without deleting anything. Attachments carry `RA.RESUBMIT_CYCLE`, and the detail page groups them into "Current submission" versus "Previous versions" (sub-labeled Original / Resubmit #N). A never-resubmitted request renders a flat list with no headers.

**The `[PENDING]` contract** (frozen, do not change): `resubmitHistory` is a string, entries separated by `\n\n---\n\n`. A `returned` action with no matching later `resubmitted` at cycle+1 is prefixed `[PENDING]`. One that was followed by a resubmit is labeled `Resubmit #N —`. Only the latest return can be `[PENDING]`. The frontend banner parser splits on the separator and detects the marker to distinguish the current return from historical ones.

### 5.5 Contract expiry (a derived lens, not a status)

Expiry is deliberately **not** a `STATUS` value. `isContractExpired_(rawEnd)` computes it live, comparing end-of-day of the contract end date against now, so a contract is not expired *on* its end date, only after it. All four list DTOs expose `isExpired` and `contractEnd` as additive fields. The UI shows an "Expired" chip *next to*, never instead of, the status badge.

### 5.6 Certificate generation

`generateCOC_(requestId)` in `Certificate.js`, invoked from `sendFullyApprovedToRequestor_`.

It re-checks authority itself (`isChainApprover_ || isAdmin_`, plus `status === APPROVED`), because it is a callable global and not merely a step in the approval flow.

Mechanism: resolve every value into a flat context object → `buildCertificateHtml_(ctx)` → `Utilities.newBlob(html, HTML).getAs(PDF)` → save to the archive folder → append a `COC_PDFs` row.

**⚠️ This was rewritten on 2026-08-11 and the previous design is worth recording, because it is the shape most Apps Script certificate generators start with.**

It used to copy a Google Docs template, then run ~70 `[regexPattern, value]` rules through `body.replaceText()`. That carried real costs:

- **Two parallel token vocabularies.** The template held both original AppSheet expressions (`<<[Project Title]>>`, `<<IF(ISNOTBLANK([PRISM])…)>>`) and clean `{{token}}` equivalents. The clean set existed *only* because a long AppSheet expression can wrap across a line in a Doc and silently stop matching its regex. Roughly half the rule array was a workaround for text wrapping.
- **Positional table surgery.** Unused approver columns were blanked by taking "the last table in the body" and clearing cells by index, in a helper that swallowed out-of-range errors silently. Then leftover `<<If:…>>` / `<<EndIf>>` wrappers were stripped by regex.
- **An external mutable dependency.** The design lived in a Doc: not diffable, not code-reviewed, no git history, and one careless edit silently changed every future certificate. It was also a go-live config item (`TEMPLATE_DOC_ID`) with its own failure modes.

The rewrite deleted all of that. Unused approver slots are simply not emitted; the `documents` OAuth scope and `TEMPLATE_DOC_ID` were both dropped. The trade accepted knowingly: the Apps Script HTML-to-PDF converter is not a browser (no web fonts, no flexbox/grid, no page-break control), so layout is table-based with inline styles, the same discipline `EmailHtml.js` works under. Non-developers also lose the ability to reword the certificate without a code change and redeploy, which was judged acceptable here.

One deliberate layout change came with it: the item details were a 9-column table inherited from AppSheet, but the schema stores exactly **one** item per request (`PRODUCT_TYPE`, `PRODUCT_NAME`, … are scalar columns on the `Requests` row, not a child table). A 9-wide table with a permanent single data row is now a two-column specification block carrying identical fields in identical order.

The function is documented to **never throw**. Every failure path returns `{ success: false, error }`. Error messages are deliberately generic to the caller while the real exception is logged server-side, because Drive exceptions echo the offending resource ID and would leak the archive folder ID.

A COC failure never blocks the approval email; the caller wraps it in try/catch and falls back to "your certificate will be provided separately."

### 5.7 Audit and history

**The unified timeline (added 2026-08-11).** `getApprovalView_()` exposes `timeline`: every workflow action across every cycle, chronological. One shared renderer serves the requestor (`RequestDetail`), the approver (`ReviewDetail`), and 13 single-request emails, so all three finally see the same story. Before this, each audience saw a different fragment: the requestor saw **returns only and never any approval**, the approver saw the current cycle plus a note about their own prior approval, and emails showed the current cycle only.

Two implementation notes worth carrying to a sibling system:

- **The system-action filter is load-bearing.** `Activity_Log` also holds three `EXPIRY_*` idempotency flags written by the daily sweep. Every *other* output of `getApprovalView_` filters them only by accident, because each branches on a workflow action by name. The timeline is the first generic walk over the actions, so it needs an explicit allowlist or a requestor's approval history shows `expiry_warning · system`.
- **Digest emails are deliberately excluded.** `sendPendingApprovalReminder_` and `sendNewApproverNotice_` loop over many requests; they keep a compact current-cycle rendering (`buildApprovalSummary_` / `emailApprovalSummary_`) because a full timeline per request makes a digest unreadable.

Two separate append-only logs, deliberately not merged:

- `Activity_Log` is **request-scoped**. Every workflow action, plus system expiry flags.
- `Admins_Log` is **config-scoped**. Admin actions have no `request_id` and must not pollute `getApprovalView_()`, which walks the timeline.

`Admins_Log` self-heals: `appendAdminLog_()` calls `ensureAdminsLogTab_()`, which creates the tab with headers if a go-live step was forgotten. Admin logging is best-effort and wrapped in try/catch so it never fails an already-committed mutation.

---

## 6. Roles and permissions

Three concepts, and the distinction matters:

**Role** is binary and derived: `detectRole_(email)` returns `"approver"` if the email appears anywhere in `Group_Approvers`, else `"requestor"`. It is computed server-side and read from `state.user.role` on the client.

**Admin is not a role.** It is an additive boolean from the `Admins` allowlist. An admin who is also an approver keeps `role: "approver"`. Admin only gates the Admin nav link, the Admin page, and the `admin*` callables. Role logic never branches on admin.

**Per-request authority** is separate again and computed per action:

| Predicate | Meaning | Gates |
|---|---|---|
| `sameEmail_(row[REQUESTOR], caller)` | owner | resubmit, delete attachment, view |
| `isCurrentApprover_(row, caller)` | due to act *now* | approve, decline, return |
| `isChainApprover_(row, caller)` | any approver of this group | view detail, download attachment, generate COC |
| `isAdmin_(caller)` | on the allowlist | view all, group/chain CRUD |

### Admin scope (Tier 2 only)

Deliberately limited to oversight plus group and chain CRUD:

- **Included:** see all requests read-only, create/rename/activate/deactivate groups, edit approver chains.
- **Excluded on purpose:** force-approve, reassign, or otherwise intervene in a request (deferred as "Tier 3", post-go-live).
- **Excluded on purpose:** any UI for the `Admins` sheet. It is hand-managed so an admin cannot mint admins.

Admin read access is read-only *by construction*, not by a flag: the resubmit panel is owner-gated, action buttons are current-approver-gated, and every handler re-verifies server-side.

---

## 7. Backend architecture and API design

There is no REST API. The "API" is the set of 16 function names the frontend invokes over `google.script.run`.

### 7.1 The complete callable surface used by the frontend

| Function | Returns | Guard |
|---|---|---|
| `getCurrentUser()` | `{email, role, isAdmin_}` | domain allowlist |
| `getMyRequests()` | list DTO | Session identity |
| `getPendingApprovals()` | list DTO | Session identity |
| `getMyActionedRequests()` | list DTO | Session identity |
| `getRequestDetail(id)` | detail DTO or `null` | owner ∪ chain ∪ admin |
| `getApproverGroups()` | `[{id, name}]` | none (selectable groups only) |
| `submitNewRequest(formData)` | `{success, requestId, controlNumber}` | domain + validation |
| `handleApprove(id)` | `{success, newStatus, step}` | current approver |
| `handleDecline(id, remark)` | `{success, newStatus}` | current approver |
| `handleReturn(id, remark)` | `{success, newStatus}` | current approver |
| `handleResubmit(id, files)` | `{success, newStatus, newCount}` | owner + Returned |
| `downloadAttachment(id)` | `{success, base64, mimeType, filename}` | owner ∪ chain ∪ admin |
| `adminGetAllRequests()` | list DTO or `[]` | `adminGuard_()` |
| `adminGetGroups()` | groups + stats or `[]` | `adminGuard_()` |
| `adminGetGroupChain(gid)` | chain or `[]` | `adminGuard_()` |
| `adminCreateGroup` / `adminRenameGroup` / `adminSetGroupActive` / `adminSaveChain` | `{success}` | `adminGuard_()` |

### 7.2 Response conventions

Mutations return `{success: boolean, ...}` with either `error` or `message` on failure. This is **inconsistent**: some paths return `error`, some `message`, and a few return both across a call chain (`handleApprove` returns `error`; the underlying `approve_` returns `message`). See 12.11.

One deliberate exception: **`getRequestDetail()` returns `null` for both "not found" and "unauthorized."** This is intentional and documented as a frozen contract. The detail renderer treats `null` as "not found or no access" and renders an empty state; returning an object would break the renderer. It also avoids leaking the existence of a request to an unauthorized caller.

List getters return `[]` on authorization failure rather than an error object, so the UI degrades to an empty list.

### 7.3 The layered guard pattern

The canonical shape for a sensitive callable:

```js
const caller = Session.getActiveUser().getEmail();      // 1. identity from Session, NEVER a parameter
const row    = getRequestRowData_(requestId);           // 2. load state
if (!isCurrentApprover_(row, caller))                   // 3. guard BEFORE the first side effect
  return { success: false, error: "Unauthorized" };
```

Critically, the guard is duplicated at both the handler layer and the mutator layer. Guarding only the wrapper is insufficient when the primitive underneath is itself callable. That was the exact gap behind the `Approvals.js` hardening: the mutators were guarded while `setRequestCache_` and `appendAction_` were not, which meant `setRequestCache("REQ-x", {status: "Fully Approved"})` self-approved any request from a browser console.

A nice detail in the guard failure messaging: a legitimate chain approver who is no longer the current step gets "This request has already been actioned" (the two-tabs double-click case), while a genuine outsider gets "Unauthorized". The distinction is made by `isChainApprover_`.

---

## 8. Configuration and environment handling

### 8.1 The resolver

`Constants.js` implements a three-tier config resolver:

```
Script Property  →  Constants.js source literal  →  throw a named Error
```

`config_(key)` is fail-loud: it throws an error naming the missing key rather than failing opaquely deep inside a Drive call. `configFlag_(key, default)` is fail-soft for booleans. `scriptProps_()` memoizes a single `getProperties()` call per execution and never throws (on failure it memoizes `{}` so callers fall through to literals instead of retrying a failing service N times).

Three keys are resolved this way: `TEMPLATE_DOC_ID`, `ARCHIVE_FOLDER_ID`, `ATTACHMENTS_FOLDER_ID`. Plus one flag: `EMAIL_DEV_TAG`.

Two rules are enforced and worth carrying:

- **No service calls at file-load time.** Every resolver body runs inside a function. A `PropertiesService` call in a top-level initializer would fire on every single execution, and a failure there is an *uncatchable script-load error* that breaks the entire app.
- **Values are trimmed.** Pasting a Drive ID into the Properties UI routinely picks up trailing whitespace, and `getFolderById(" 1abc ")` fails opaquely.

Script Properties are project-scoped (shared by `/dev` and `/exec`), are **not** in git, and are **not** pushed by clasp. They must be re-entered by hand on a new project. Deleting them is a complete rollback to the source literals.

### 8.2 What is deliberately NOT a Script Property

`ORG.ALLOWED_DOMAINS` lives only in source, with no property fallback. The stated reasoning: it is a security control, not an environment value, so it should be version-controlled, diffable, and code-reviewed rather than silently editable with no audit trail. `configFallback_` deliberately omits the key so a stray `config_("ALLOWED_DOMAINS")` throws rather than resolving.

### 8.3 Deploy gotcha

`clasp push` updates `/dev` immediately, but `/exec` continues running the last **published** version. Email deep-links use `ScriptApp.getService().getUrl()`, which returns the `/exec` URL. So a push without a republish leaves every email link pointing at old code. Triggers are per-Google-account and are not created by `clasp push`; two must be registered by hand on any new account.

---

## 9. Security model

### 9.1 Identity

Always `Session.getActiveUser().getEmail()`. An email is **never** accepted as a parameter from the frontend. This rule is stated in the project conventions and is followed consistently across every callable I reviewed.

### 9.2 Email comparison

Never `===`. Always `sameEmail_(a, b)`, which normalizes (trim + lowercase) and carries a **non-blank guard**. Both halves matter: Google accounts show casing drift across sessions, and two empty cells must never compare as "the same approver". The frontend has its own `sameEmail()` twin, necessarily separate since it is a different runtime.

### 9.3 The trailing-underscore boundary

Covered in 2.2. When adding a backend function the codebase mandates picking one of three options:

1. Internal helper → name it `fnName_`. This is the default and should be preferred.
2. Genuinely called by the frontend → keep the bare name **and** guard it.
3. Trigger handler or editor-run helper (cannot take an underscore) → guard with `isOwnerContext_()`.

### 9.4 `isOwnerContext_()`

For entry points that cannot be hidden. Under an "execute as me" deployment, `getEffectiveUser()` is always the owner while `getActiveUser()` is the calling visitor. In a time-driven trigger or an editor Run, both resolve to the owner. Equality therefore implies owner-or-trigger context. It fails closed: a blank active user will not match, because `sameEmail_` rejects blanks.

Applied to `checkContractExpiries`, `checkPendingApprovals`, `registerExpiryTrigger`, `registerApproverReminderTrigger`, and `_testGenerateCOC`.

The motivating case is instructive: `checkPendingApprovals` has **no idempotency flag by design** (see 10.2). Without this guard, any authenticated user could loop it via `google.script.run` to mass-mail every approver and burn the account's daily Gmail quota, which then silently disables all workflow mail because `sendBrandedEmail_` fails soft.

### 9.5 Domain allowlist

`ORG.ALLOWED_DOMAINS` is a server-side backstop behind the deployment's "Anyone within &lt;domain&gt;" setting, enforced by `isAllowedDomain_()` at `getCurrentUser()` and `submitNewRequest()`.

**It fails open: an empty array allows every domain.** It currently ships as `[]`. This is correct for the dev account and wrong for production. A rejected caller is logged by *domain only*, never the full address, so the execution log does not accumulate a list of non-employee identities readable by any project editor. A blank email is rejected regardless of the setting.

### 9.6 File confidentiality

Uploaded files are created with `DriveApp.createFile()` and **no `setSharing` call**, leaving them owner-only private. No Drive URL is ever sent to the frontend. The UI holds only an `attachmentId` and fetches bytes through `downloadAttachment()`, which applies the same authorization gate as `getRequestDetail`. Emails list attachment filenames but carry no links, since a raw link would 404 for the recipient anyway.

A notable removal: `addAttachment()` was deleted outright rather than kept. Its owner guard was correct, but it wrote a **caller-supplied** Drive file ID into `RA.FILE_LINK`, which `downloadAttachment()` then trusts. On your own request you passed the guard and could then read *any* file in the script owner's Drive, served with the owner's full `drive` scope. Ownership of a request is not ownership of a file. This is a confused-deputy pattern worth checking for in any sibling system.

### 9.7 XSS and injection

Two separate `escapeHtml` implementations, one per runtime (`EmailHtml.js` server-side, `JavaScript.html` client-side). Every `email*` helper escapes its own inputs, so the escaping obligation sits with the helper rather than the call site. The frontend escapes before every `innerHTML` insertion.

Sheets formula injection is not specifically defended against (a value beginning with `=` written into a cell). In practice the data is only ever read back through the Sheets API rather than evaluated in a spreadsheet UI context, so the exposure is low, but it is not an explicit control.

### 9.8 Concurrency

`LockService.getScriptLock()` with a 10-second `waitLock` wraps all four workflow mutators, `createGroup_`, and `replaceGroupChain_`. Each mutator re-reads status *inside* the lock, making it a genuine compare-and-set. This is what prevents a double-click across two tabs from generating two certificates and two emails.

`submitNewRequest` deliberately takes **no** lock. The consequence is a `getLastRow()` race on the control-number sequence, which is downgraded to cosmetic because the human-facing suffix derives from the unique request ID, so two simultaneous submits still produce distinct control numbers.

---

## 10. Notifications

### 10.1 Architecture

15 `send*` functions in `Emails.js`, all funneling through one door: `sendBrandedEmail_(recipient, subject, textBody, htmlBody, extraOptions)`.

Every email is **dual-format**. The plain-text body stays the fallback and the source of truth for copy (3rd positional argument to `GmailApp.sendEmail`); the branded HTML twin rides in `options.htmlBody`. PDF attachments ride in `extraOptions`.

`sendBrandedEmail_` is **non-fatal by design**. A send failure is logged and swallowed, never thrown. The workflow state is already committed by the time emails fire, so a Gmail quota error must not abort the action, roll back a saved request, or block the certificate.

The HTML layer is `EmailHtml.js`: table-based, inline styles, 600px centered, with a 4px accent band that carries the status signal (navy = action needed, green = approved, red = declined, amber = returned or expiry). The CTA button is always navy, since the band already carries the status. Helpers: `emailLayout_`, `emailButton_`, `emailInfoTable_`, `emailSection_`, `emailKeyValueRows_`, `emailAttachmentList_`, `emailApprovalLog_`, `emailRemarkBox_`, `emailDivider_`, `emailP_`.

Subjects come from `emailSubject_(controlNumber, statusLabel, audience)` → `[COC Request]: <ctrl> | <Status>`. A dev-mode prefix (`[FOR APPROVER]` / `[FOR REQUESTOR]`) lets a single test inbox distinguish audiences.

Deep-links use **query params** (`?page=review&id=XXX`), not hash fragments, because the app runs in a sandboxed iframe where the client cannot read the outer URL's hash, while query params reach `doGet()` server-side.

### 10.2 The notification matrix

| # | Function | To | Fires when |
|---|---|---|---|
| 1 | `sendApprovalRequest_` | next approver | submit + intermediate approval |
| 2 | `sendDeclineToApprover_` | decliner | declined |
| 3 | `sendDeclineToRequestor_` | requestor | declined |
| 4 | `sendFullyApprovedToApprover_` | last approver | fully approved |
| 5 | `sendFullyApprovedToRequestor_` | requestor | fully approved (**generates + attaches the COC**) |
| 6 | `sendReturnToRequestor_` | requestor | returned |
| 7 | `sendReturnConfirmToApprover_` | returner | returned |
| 8 | `sendApproveConfirmToApprover_` | approver | intermediate approval only |
| 9 | `sendProgressUpdateToRequestor_` | requestor | intermediate approval |
| 10 | `sendReturnedChainNotification_` | prior approvers | any return |
| 11 | `sendResubmitConfirmToRequestor_` | requestor | resubmit |
| 12 | `sendResubmitApprovalRequest_` | approver 1 | resubmit |
| 13 | `sendExpiryReminderToRequestor_` | requestor | daily expiry sweep |
| 14 | `sendPendingApprovalReminder_` | current approver | daily approver nudge (digest) |
| 15 | `sendNewApproverNotice_` | new/changed approver | chain add or reorder |

### 10.3 The two daily triggers, and their opposite idempotency models

This contrast is the most transferable design lesson in the notification layer.

**`checkContractExpiries()`** (daily ~8am). Sweeps fully-approved rows with a contract end date. Three stages, each idempotent via its own `Activity_Log` system action:

- T-3 to T-1 → "Expiring Soon" + log `EXPIRY_WARNING`
- exactly day-of → "Expires Today" + log `EXPIRY_NOTICE`
- past end date → "Has Expired" + log `EXPIRY_OVERDUE`

The warning and overdue stages use **ranges**, so a skipped run catches up on the next one; day-of is exact. `else if` chaining caps it at one email per request per run. The post-expiry email exists because requestors rarely watch the portal, so email is the real awareness channel and a passive "Expired" label is not enough.

Performance note: the flag lookup was recently changed from a full `Activity_Log` re-scan per approved row (quadratic, breaching the 6-minute execution ceiling around ~1,450 lifetime requests) to a single `getExpiryFlagMap_()` pass. Because that map is a snapshot taken before the loop, `markExpiryFlag_()` mirrors mid-loop appends into it so writes made during the sweep stay visible to later iterations. The map build is deliberately **not** wrapped in a try/catch that falls back to `{}`: an empty map reads as "no reminder ever sent" and would re-notify every approved contract in the system, so a scan failure aborts the sweep (fail closed).

**`checkPendingApprovals()`** (daily ~8am). Nudges whoever is currently holding up a pending request, bucketed by normalized email so each approver gets **one digest** rather than one email per request.

> Its idempotency is **the schedule itself**, deliberately the opposite of the expiry sweep. A daily nudge is *meant* to repeat, so the once-a-day trigger run is the only guard. It writes nothing to `Activity_Log` and adds no `ACTION` enum value, because logging one row per pending request per day would bloat the append-only timeline.

Exactly **two** trigger registrations exist, both per-Google-account and both requiring a manual editor run: `registerExpiryTrigger()` and `registerApproverReminderTrigger()`.

`registerTrigger()` is **not** a third. It is intentionally disabled and throws immediately. Registering the legacy `onSheetChange` path would double-send every workflow email (the `handle*` functions already send them), and worse, inside an installable trigger `Session.getActiveUser()` resolves to the trigger *owner*, not the acting approver, so receipts would go to the wrong person.

### 10.4 Chain-change notification

`notifyChainChanges_()` is triggered by **current-approver change, not membership**. It captures each pending request's current approver *before* the chain replace and compares *after*. Recipients are the union of "anyone newly in the chain" and "anyone who newly became the current handler of an in-flight request."

This means a pure **reorder** correctly fires (ex-Approver-2 becoming Approver-1 of a `PENDING_1` request now holds it), while a **designation-only edit sends nothing**. The email branches on the recipient's prior sequence: a fresh add reads "added as approver, your role: Approver N"; a reorder reads "you were Approver M, you are now Approver N". Each send is isolated in its own try/catch so one bad address does not suppress the others.

Removed approvers are deliberately **not** emailed (a supervisor decision: the approver themselves requests the move). Requestors are not emailed on chain changes either; instead, in-flight requestor emails carry a standing `REQUESTOR_PORTAL_NOTE` telling them approvers may change and to check the portal for the current handler.

---

## 11. Frontend

### 11.1 Shell and load order

`Index.html` is the only document served. `doGet()` evaluates it as an Apps Script template, injecting `initialPage` and `initialId` from query params into `window.__INITIAL_ROUTE`.

Load order is critical and explicitly documented as non-reorderable: Stylesheet → components (StatusBadge, EmptyState, MigaWidget, then UI, which needs `migaImageFor` from MigaWidget) → pages → the `__INITIAL_ROUTE` scriptlet → `JavaScript.html` last, because the router needs every page render function to already be defined.

### 11.2 State

One mutable global singleton:

```js
const state = {
  user: null,           // { email, role, isAdmin } after getCurrentUser()
  currentPage: null,
  params: {},
  approverGroups: null,
};
```

Pages **read** state and go through `navigateTo()` to write it. There is no reactive binding, no framework, no virtual DOM. Rendering is string concatenation into `innerHTML`.

### 11.3 Router

`navigateTo(page, params)` is the single entry point for every page change. It resolves `'home'` to a role-based dashboard, sets state, paints a loading placeholder, awaits the page renderer, swaps `#app.innerHTML`, restarts the page-in CSS animation via a forced reflow, syncs the URL hash, and then calls an optional `afterRender_<page>(params)` hook.

Two details worth noting:

- It uses `history.replaceState`, **not** `pushState`, so navigation does not push browser history entries. This is intentional: the app supplies its own per-page Back buttons instead of relying on the browser stack.
- The hook name must use the **exact lowercase route key** from the switch (`afterRender_approverDashboard`, not `afterRender_ApproverDashboard`). A casing mismatch fails silently, and this was a real pre-existing bug from the AppSheet migration.

Routing priority at bootstrap: email deep-link (`__INITIAL_ROUTE`) → existing URL hash → role-based home.

### 11.4 Server bridge

```js
function callServer(fnName, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fnName](...args);
  });
}
```

Every server call goes through this. Pages never touch `google.script.run` directly. All 16 call sites pass a string literal, none dynamic, which is what makes the callable surface statically verifiable.

### 11.5 Shared UI primitives (`components/UI.html`)

`renderIcon(name, size)` returns an inline Lucide SVG using `currentColor`. Zero network requests, which matters inside a sandboxed iframe. `renderHeroCard`, `renderStatCard` / `renderStatGrid`, `renderSearchBar`, `renderPagination` + `paginate`, `friendlyName(email)`, and `uiKeyActivate(event)` for Enter/Space activation of `role="button"` elements.

Because markup is injected via `innerHTML`, closures cannot survive the string boundary, so **callbacks are passed as global function-name strings** (`onInput: 'dashboardSearch'`). This is an unusual but coherent pattern forced by the rendering model.

### 11.6 Client-side search, filter, and pagination

Caches are fetched once per page entry; search, filter, sort, and paging are all client-side. One specific rule keeps this usable:

> The search `onInput` handler must re-render **only** the list region (`#…-list`), never the controls region containing the `<input>`, or focus drops mid-keystroke. Filter, sort, and stat-card changes may re-render controls, and must reset the page variable to 1.

Stat cards double as clickable filters via `data-filter` / `data-statkey` attributes.

### 11.7 Interaction conventions

`showLoading('Verb…')` before every `callServer` action, with `hideLoading()` in **every** branch (success, failure, catch). `await showConfirm({title, message, confirmLabel, danger})` instead of `window.confirm()`. `showToast(message, type)` for transient feedback. Two-column detail pages use a `.detail-layout` grid with a sticky right rail.

### 11.8 Design system

Tokens live in `:root` in `Stylesheet.html`. A navy-anchored palette (`--navy-900: #0a2744`) with gray neutrals and five semantic color pairs (blue, green, amber, red, purple), three radii, three shadows, plus role-named semantic aliases (`--bg`, `--surface`, `--border`, `--text-primary`) layered over the raw ramps so a future re-theme touches only that block.

The stylesheet is one 1,716-line file organized by comment header, with a documented section index at the top. Conventions: all new CSS goes here, using existing `:root` variables only. No inline styles, no new color values.

Accessibility and responsiveness work that has landed: `.table-scroll` wrappers so wide tables scroll independently rather than forcing the page sideways, `:focus-visible` styles on nav links and tabs, keyboard activation on clickable rows, label/id association on all form fields, and an amber text token darkened to `#8a5510` for AA contrast. Three breakpoints (1024 / 768 / 640).

There is a mascot ("Miga") with per-status emotion variants, mapped through the same `STATUS_LABELS` table that drives badge classes.

### 11.9 File upload path

The browser reads each file with `FileReader` into base64, strips the `data:` prefix, and posts the array inside `formData.files`. Client-side size checks use real `file.size`; the server re-estimates from base64 length. The server does all Drive work. Nothing about the client-side validation is a control, since `submitNewRequest` is directly callable.

---

## 12. Weaknesses, debt, and risks

Ordered roughly by severity.

### 12.1 ✅ FIXED: the Admin console regression (kept here for the lesson)

**Status: resolved.** Recorded in full because the failure mode is the transferable part, and a sibling repo running its own underscore sweep will hit it.

The security sweep in `bf20b31` renamed `isAdmin` → `isAdmin_` throughout the backend. It also renamed the **DTO property key** in `getCurrentUser()`'s return value:

```js
// broken (bf20b31)
return { email, role, isAdmin_: isAdmin_(email) };

// correct (b8869de, and again now)
return { email, role, isAdmin: isAdmin_(email) };   // key bare, function underscored
```

The frontend reads the un-suffixed key in two places (`JavaScript.html` `refreshNavbar`, `Admin.html` `renderAdminPage`), so `state.user.isAdmin` was `undefined` for everyone. The Admin nav link never rendered and direct navigation to the admin route bailed out. The entire Tier-2 admin console was inaccessible to every user including real admins, for the whole life of that commit.

Three things make this worth carrying:

- **A call-graph checker cannot catch it.** The name resolves fine as a function. What broke was an object property, which no call-graph analysis inspects. The repo now also greps for property keys ending in `_` as a separate pre-push check.
- **The function and the key are supposed to differ, permanently.** The trailing underscore is a security boundary (it hides the function from `google.script.run`); the key is a frozen frontend contract. "Making them consistent" is the bug. Both sites now carry a warning comment saying exactly that.
- **The backend guards were never affected.** `getRequestDetail`, `downloadAttachment`, and every `admin*` callable used `isAdmin_()` correctly throughout. This was a pure UI-access failure, not a security hole. Nothing was *exposed*; something was *hidden*. Worth stating plainly, because "admin check broken" reads far more alarming than it was.

### 12.2 The system has never been executed in its current form

**This is now the single largest risk in the repository**, and the fixes recorded above make it larger, not smaller.

Three layers of change are stacked, none of which has ever run:

1. `b8869de` configuration externalization (Script Properties resolver, domain allowlist, expiry-sweep performance)
2. `bf20b31` the callable-surface security sweep (118 → 39 callable functions, ~90 renames)
3. The four fixes in 12.1 / 12.4 / 12.13 (admin key, group memo, mandatory reasons, upload validation)

Apps Script cannot be run locally, so there was no way to test incrementally. The verification burden is concentrated into one manual pass, and because three layers are stacked, a failure is not cleanly bisectable.

What *has* been verified is static only, and the distinction matters when reading this document: all 12 backend files parse; the call-graph checker reports 152 defined / 113 hidden / **0 unresolved** with the callable surface unchanged at 39; no object property key ends in `_`; the cross-file constants (`isAdmin`, `MIN_REMARK`/`REVIEW_MIN_REMARK`, the extension allowlists) agree; and the magic-byte logic was unit-tested locally against real file headers for all six accepted formats plus four renamed-file attacks. **None of that exercises Sheets, Drive, Gmail, or Session**, which is where the remaining risk lives.

`reference/GO_LIVE_RUNBOOK.md` carries the re-test checklist.

### 12.3 Production configuration is still on dev values

- `ORG.ALLOWED_DOMAINS` is `[]`, which **fails open** and allows every domain. Correct for dev, wrong for production, and silent when wrong: everyone simply keeps working. `_testConfig` prints a loud warning while it is empty.
- `EMAIL_DEV_TAG` is `true`, so every subject still carries `[FOR APPROVER]` / `[FOR REQUESTOR]`.
- `COC.ARCHIVE_FOLDER_ID` and `COC.ATTACHMENTS_FOLDER_ID` still point at dev Drive folders.

A subtle trap in the flag: the Script Property **overrides** the source literal, so editing `Emails.js` while a stale property exists silently does nothing.

### 12.4 ⚠️ PARTIALLY FIXED: Sheets-as-database N+1 reads

`getDataRows_(name)` performs a full `getDataRange().getValues()` on every call, with **no memoization**. It was being called inside `.map()` and `.filter()` loops.

Concretely, `getMyRequests()` maps over every request row and calls `getGroupNameById_(groupId)` per row, a full `Groups` read each time. For a user with 50 requests, that was 50 complete reads of the same tab in one call. `getPendingApprovals()` was worse: `getCurrentApprover_(step, groupId)` inside its filter meant a full `Group_Approvers` read **per row scanned**, before any narrowing.

**✅ Fixed for the dominant case.** `Accessors.js` now memoizes the two small lookup tables per execution (`groupRows_()` / `groupApproverRows_()`), mirroring the `SCRIPT_PROPS_CACHE_` pattern in `Constants.js`. Apps Script discards globals between executions, so the cache lives exactly one execution. The three write paths (`createGroup_`, `updateGroupFields_`, `replaceGroupChain_`) read fresh and call `invalidateGroupCaches_()`, which is what keeps `adminSaveChain`'s post-write re-read and `notifyChainChanges_`'s current-approver comparison correct.

`Activity_Log` was subsequently memoized too, on the same read-fresh-and-invalidate rule, once the timeline work made it acute: `buildApprovalLog_` and `emailApprovalLog_` are called back to back in the same email function and **each independently triggered a full scan of the entire activity table**, so every email was already scanning it twice. `appendAction_` is the sole writer and is therefore the sole invalidation point.

`Requests` is still **deliberately not memoized**: `submitNewRequest` appends a row then re-resolves it by ID for rollback, so a stale cache there would be a correctness bug rather than an optimization.

**⚠️ Still open.** `getRowNumberByRequestId_()` remains a linear scan of the whole `Requests` tab, called repeatedly within single operations (each mutator calls it, then `setRequestCache_` calls it again, so roughly three full `Requests` reads per approval). This is a constant factor rather than an N+1, so it was left alone. The right fix is `createTextFinder()` with `findAll()` + take-last and a re-read inside the lock; note that `.find()` returning the *first* match is a subtle bug when duplicates exist.

Context: the daily expiry sweep was already refactored away from quadratic behavior after it was found to breach the 6-minute execution ceiling around ~1,450 lifetime requests.

### 12.5 Global script lock serializes all mutations

`LockService.getScriptLock()` is a *script*-wide lock, not per-request. Every approve, decline, return, resubmit, group create, and chain replace across the entire organization contends on it, with a 10-second wait before returning "System is busy." At current volume this is invisible. It is a hard ceiling on concurrency that no amount of tuning will raise without redesigning to per-request locking (which Sheets does not natively support).

### 12.6 The approver chain is hard-capped at 3, while the schema and its own docs say otherwise

`Group_Approvers` stores N approvers with a `sequence` column, and the constant's comment literally says "unlimited approvers." **Routing is capped at three.**

- `getApprovers_()` reads only sequences 1 to 3.
- `approve_()` only branches steps 1, 2, 3.
- `isChainApprover_()` only checks slots 1 to 3.
- `STATUS` only has `PENDING_1|2|3`.

A hand-added `sequence = 4` row resolves in `getCurrentApprover_()` but **fails `isChainApprover_()`**, which silently locks that request out permanently: the assigned approver can neither view nor act on it, and no error is raised anywhere. `adminSaveChain` hard-blocks more than 3 slots, so this is only reachable by direct sheet editing, but the data model invites it.

Lifting the cap is a real, unstarted change touching those functions plus the `STATUS` enum, which is a frozen DTO contract compared in filters, email subjects, and frontend badge maps.

### 12.7 No reconciler for cache drift

`Requests.status/step/resubmit_count` is a denormalized cache over `Activity_Log`. Nothing detects or repairs divergence. A direct sheet edit, a partial failure between `appendAction_` and `setRequestCache_` (they are separate writes, not one transaction), or a manual correction leaves the cache and the timeline disagreeing, with the cache winning every read. A `rebuildCacheFromTimeline()` reconciler is noted as deferred in the runbook and does not exist.

### 12.8 No tests of any kind

No test directory, no test framework, no fixtures, no CI. Verification is entirely a manual browser and editor checklist. This is partly forced by Apps Script (no local runtime, everything depends on live Sheets, Drive, Gmail, and Session state), but nothing has been extracted into pure, testable functions either, even though several are naturally pure: `validateRequestFields_`, `validateAttachmentPayload_`, `daysUntilContractEnd_`, `isContractExpired_`, `getApprovalView_`, `chainChangeAction_`, `chainDiffDetails_`, `sortRequests`. These could all be unit-tested with a small harness and are not.

The custom call-graph checker used to verify the rename sweep lives in a temp scratchpad directory and is **not committed to the repository**, so it will be lost.

### 12.9 Dead and dormant code with live hazards

- `checkAttachmentSync_()` is a documented permanent no-op, kept only so its dormant caller does not error.
- `handleAttachmentChange()` and `onSheetChange()` are unregistered and unreachable.
- `handleCertificateRequestChange()` contains a **complete parallel email-sending implementation** that would double-send every workflow notification if the trigger were ever registered. The mitigation is a `throw` inside `registerTrigger()` plus a warning comment. That is defense by comment: the hazardous code path is fully intact and one deleted line away from firing.
- `Code.js` is 21 lines of comment and nothing else.
- Comments on live functions still reference the removed `SYNCING` status and `EXPECTED_ATTACHMENTS` column.

### 12.10 Documentation drift

The documentation in this repository is unusually thorough (see 13.6), which makes drift especially misleading:

- `Constants.js` describes itself as a "NORMALIZED 7-sheet schema" in its header and "the 6 sheets" in its OUTLINE. There are **8**.
- `Accessors.js` refers to "6 na hiwalay na sheets."
- The `GAP` constant comment says "unlimited approvers," which is false (12.6).
- `WebApp.js` doc blocks still reference a "34-col row" and "33-col array" in the `OUTLINE` and STEPS sections; the row is 25 columns.
- `handleReturn`'s doc block describes a six-step algorithm involving `PREVIOUS_APPROVALS` JSON snapshots and `[PENDING]` history writes that **no longer exists** in the function body (it was replaced by timeline derivation). Anyone reading the doc block instead of the code will be badly misled.
- The `README.md` is two lines and does not mention the SPA, the normalized schema, the admin console, or how to deploy.

### 12.11 Inconsistent error shapes

Mutations variously return `{success:false, error}` or `{success:false, message}`. `handleApprove` returns `error` while the `approve_` it wraps returns `message`, so the caller receives different key names depending on which layer rejected. The frontend must check both. There is no error-code vocabulary, only human-readable strings, so the UI cannot branch on failure *type* (busy vs unauthorized vs already-actioned) without string matching.

### 12.12 Workflow limitations

- **Declined is fully terminal.** No appeal, no reopen, no admin override. The requestor must file an entirely new request, losing the audit thread.
- **No delegation or out-of-office.** If an approver is unavailable, the only remedy is an admin editing the chain, which changes it for every in-flight request in that group at once.
- **No Tier-3 intervention.** No force-approve, no reassign, no cancel, no withdraw. A stuck request requires direct spreadsheet editing.
- **Requestors cannot cancel their own request.**
- **Renewal by editing a contract end date is not supported.** Existing expiry flags suppress new reminders. The design assumes renewals are new requests, which is documented but is a real constraint.
- **Attachments cannot be removed by the requestor through the UI.** `deleteAttachment_` exists and is owner-guarded, but it now carries a trailing underscore and is therefore not callable from the frontend.

### 12.13 ⚠️ PARTIALLY FIXED: Missing validations

**✅ Fixed — mandatory decline/return reason.** `validateRemark_` now rejects blank, whitespace-only, and anything under 20 characters, in addition to the existing 2000-char cap. It applies to `decline_` and `returnRequest_` only, and only to new actions, so no existing `Activity_Log` row is affected. `ReviewDetail.html` mirrors it with a live character counter and a disabled confirm button, but that is UX: the server check is the control, since both mutators are reachable via `google.script.run`.

**✅ Fixed — upload type validation.** `validateAttachmentPayload_` now runs three layers before any Drive I/O: an extension allowlist (`pdf doc docx xls xlsx jpg jpeg png`), a MIME allowlist, and a **magic-byte signature check** on the real decoded bytes. The signature check is the only actual control, because filename and `mimeType` both arrive from the browser. `application/octet-stream` is accepted as a MIME precisely because browsers misreport valid PDFs that way, which is why the byte check exists as the backstop. Note two deliberate limits: the signature proves the *container*, not the document type (OLE2 is shared by `.doc`/`.xls`, ZIP by all OOXML), and there is no macro scanning. What it stops is an executable, script, or archive wearing a document extension.

**Still open:**

- No required-field enforcement on submit beyond the group. Every text field may be blank, deliberately, to preserve existing accepted behavior.
- Email format is validated only in `adminSaveChain` (`/^\S+@\S+\.\S+$/`), not on any other path.
- No defense against a value starting with `=` being written into a cell. Exposure is low here because data is read back through the Sheets API rather than evaluated in a spreadsheet UI, but that reasoning does **not** transfer to any sibling system that exports rows into a new Spreadsheet a human then opens.

### 12.14 Code duplication

`Emails.js` is 1,378 lines containing 15 send functions that are structurally near-identical: load request data, build a plain-text body, build a parallel HTML body from the same values, compose a subject, send. The plain-text and HTML bodies restate the same content twice in every one of the 15, which is roughly 30 near-duplicate body constructions. A table-driven approach with per-event content descriptors would collapse most of it, at the cost of readability that the current explicit style provides.

The four list DTO projections (`getMyRequests`, `getPendingApprovals`, `getMyActionedRequests`, `adminGetAllRequests`) are also copy-pasted, differing only in their filter.

### 12.15 Operational fragility

- Two triggers must be registered by hand, per Google account, and are not created by `clasp push`. Forgetting either silently disables that entire notification stream with no error anywhere.
- Sheet tabs are created manually and must match `SHEET_NAMES` exactly. Only `Admins_Log` self-heals; the other seven do not.
- `clasp push` does not publish. Email deep-links point at the last *published* `/exec` version, so a push without a republish leaves every link running old code.
- Gmail's daily quota (~1,500 on Workspace) is a hard ceiling, and because `sendBrandedEmail_` fails soft, hitting it disables all workflow mail *silently*.

---

## 13. What this implementation does well

Documented without comparison, as requested.

### 13.1 Defense in depth against a genuinely hostile runtime

The `google.script.run` exposure problem is the defining constraint of Apps Script, and this codebase confronts it directly rather than assuming frontend gating is sufficient. The trailing-underscore convention is applied systematically (109 of 148 functions hidden), the residue is guarded by `isOwnerContext_()`, and guards are deliberately duplicated at both the handler and the primitive layer. The threat model is written down in `CLAUDE.md` so it survives handoff.

The `addAttachment` removal is a good example of the reasoning quality: the function was deleted rather than patched, with a written explanation of *why* an ownership guard was insufficient (owning a request is not owning a file), and a note on how to reinstate the capability safely if ever needed.

### 13.2 Event sourcing with a read-cache, behind an accessor seam

The append-only `Activity_Log` plus derived-on-read history is a strong fit for an approval workflow, where the audit trail *is* the product. Combining it with a narrow denormalized cache for dashboard filtering is a pragmatic compromise rather than event-sourcing purism.

The `Accessors.js` seam is what made the migration survivable: a 35-column monolith became 8 tables while the frontend DTO stayed frozen, so the UI was barely touched. That is a genuinely hard refactor executed cleanly.

### 13.3 Atomicity reasoning under a database with no transactions

Sheets has no transactions, and this code takes that seriously rather than hoping. The upload-before-write ordering in `submitNewRequest`, the deliberate placement of the append-only timeline write **last**, the rollback that re-resolves the row by identity rather than by a captured index, and the state-flip-before-attachment-rows ordering in `handleResubmit` are each accompanied by a comment explaining the failure mode being prevented. These are not obvious orderings, and each one is the *correct* one.

### 13.4 Fail-open versus fail-closed decided per control, on purpose

- Config resolution fails **loud** (throws naming the missing key) because a silent misconfiguration produced an opaque Drive error once already.
- Boolean flags fail **soft** toward the safer value (`EMAIL_DEV_TAG` defaults to `true`, so a forgotten setting sends visibly-test mail rather than silently-production mail).
- The expiry flag map fails **closed** (a scan failure aborts the sweep, because an empty map would re-notify every contract in the system).
- Email sending fails **soft** (a Gmail hiccup must never roll back a committed approval).
- `isOwnerContext_` fails **closed** on a blank user.

Each of these is a considered choice with the reasoning recorded next to it.

### 13.5 Correct handling of subtle domain edge cases

Several of these are the kind that normally ship as bugs:

- Email comparison with a non-blank guard, so two empty cells never match as "the same approver."
- Contract expiry computed at end-of-day, so a contract is not expired *on* its end date.
- `daysUntilContractEnd_` reducing both dates to a Manila calendar day before differencing, rather than dividing milliseconds, so the result is stable regardless of what time the trigger fires.
- Skip-blank approval routing deriving the next step from the next *pending status* rather than `step + 1`, handling gapped chains.
- N-of-M computed from timeline actions rather than from `step`, because skip-blank makes `step` unreliable as a counter.
- The chain-change notifier keying on *current-approver change* rather than membership, so a reorder correctly notifies and a designation-only edit correctly stays silent.
- In-place, position-matched chain updates, so a reorder or an email change writes zero new rows and zero tombstones.
- The in-flight shrink guard, which blocks shortening a chain below the step any live request currently sits at, and names the blocking control numbers in the error.

### 13.6 Documentation as a first-class artifact

Every file carries a header with a plain-language explanation, a technical explanation, and an outline. Every non-trivial function carries a doc block with both registers, params, returns, numbered steps, and a worked example. Depth is scaled: one-liners get compact blocks, substantive functions get full treatment.

More valuable than the volume: the comments consistently record **why**, not what. Warnings are attached at the point of danger ("this is a security boundary, not style"; "do not wrap this in a try/catch that falls back to `{}`"; "re-read from the map on every iteration, it is mutated below"). Removed code leaves a tombstone comment explaining the removal and how to recover it. This is what a maintainer actually needs, and it is rare.

The caveat from 12.10 stands: some of it has drifted from the code.

### 13.7 Frozen DTO contracts, explicitly labeled

Status strings, the `[PENDING]` resubmit-history format, the `getRequestDetail` null-return contract, and the legacy `getApprovers_` 6-field shape are all explicitly identified as frozen, with the reason stated. This is why a full database normalization did not cascade into the UI. Marking a contract as frozen *in the code* is a lightweight discipline that clearly paid off here.

### 13.8 Thoughtful UX under real constraints

The loading overlay mounts to `document.body` so it survives the router swapping `#app`. Search re-renders only the list region so focus is never dropped mid-keystroke. Stat cards double as filters. `replaceState` over `pushState` with app-provided Back buttons is a deliberate choice, not an accident. Icons are inline SVG with zero network requests, which matters inside a sandboxed iframe. Emails carry both a plain-text and a branded HTML body with a status-colored accent band, and the CTA stays one color because the band already carries the signal.

Accessibility work has been done rather than deferred: keyboard activation for clickable rows, `:focus-visible` styles, label/id association, contrast-corrected tokens, and independently scrolling tables so a wide table never forces the page sideways on a phone.

### 13.9 Operational honesty

`registerTrigger()` throwing with an explanation, `_testConfig` shouting when the domain gate is off, the runbook enumerating what is implemented but untested, and the deliberate decision to leave `include()` callable with a written rationale (breaking scriptlet resolution would mean no page renders at all, too much blast radius for a low-severity finding with no local test available) all reflect a willingness to write down the uncomfortable parts. The go-live runbook is explicitly designed to be executable without an AI assistant present.

---

## 14. Quick-reference summary for the DCS reviewer

| Dimension | This system |
|---|---|
| Platform | Google Apps Script V8, container-bound to a Sheet |
| Persistence | Google Sheets, 8 tabs, no transactions, no indexes |
| State model | Event-sourced append-only log + denormalized read-cache |
| Data access | Single accessor seam (`Accessors.js`); feature code never touches raw tabs |
| API style | 16 named RPC functions over `google.script.run`; no REST, no route table |
| Identity | `Session.getActiveUser()` only; never a client-supplied email |
| AuthZ model | 4 predicates (owner, current approver, chain approver, admin), duplicated at handler + primitive layers |
| Attack surface control | Trailing-underscore hiding (109/148) + `isOwnerContext_()` for the residue |
| Concurrency | Global `LockService` script lock, compare-and-set inside the lock |
| Workflow | Sequential, up to 3 approvers, skip-blank routing, return/resubmit cycles, terminal decline |
| Notifications | 15 dual-format email events + 2 daily sweeps with opposite idempotency models |
| Documents | Google Docs template → token replace → PDF → Drive archive → log row |
| Files | Private in Drive, never link-shared, served only through an identity-gated function |
| Frontend | Hand-rolled SPA, hash router, one global state object, `innerHTML` string rendering |
| Config | Script Property → source literal → named throw |
| Tests | None |
| Known live defect | None outstanding. The `isAdmin_` DTO key regression (12.1) is fixed |
| Deployment state | Pushed to `/dev`, **never executed**, not published to `/exec` (12.2) |
