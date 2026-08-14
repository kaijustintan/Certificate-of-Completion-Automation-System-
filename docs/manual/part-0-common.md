# Part 0: Common Reference

> **Read this first.** Everything true across every role lives here and **only** here. The
> per-audience Parts (1 = users, 2 = admin, 3 = developer) link back to these sections instead
> of repeating them. If a fact appears in two places and they disagree, **this file wins.**
>
> Legend: 🧑 end-user · 🛠 admin · 👨‍💻 developer · 🚩 = do not break this / hard-won lesson.

---

## §0.1: What the portal is

**Layman:** An employee needs a Certificate of Completion for a software purchase or licence.
They fill in a form, attach the supporting papers, and the request travels up a short chain of
named approvers. When the last one signs off, the system makes the certificate itself and emails
it to them. No printing, no chasing people by email, and a permanent record of who approved what.

**Technical:** A single-tenant internal approval portal, one Google Apps Script project serving
a custom single-page app over a Google Spreadsheet database, with Drive for file storage and
Gmail for notifications. It replaces a legacy Google AppSheet application
(`docs/APPSHEET-TO-PORTAL.md`).

It is **not** a general workflow engine. The domain is deliberately fixed: one request type, one
certificate type, one organization.

```
Requestor ──► files request + documents ──► Approver 1 ──► Approver 2 ──► Approver 3
                                                                              │
                          any approver may Approve · Decline · Return         ▼
                                                                     Fully Approved
                                                                              │
                                       certificate PDF generated ◄────────────┘
                                       archived to Drive, emailed to requestor
```

**Three roles**, and only two of them are roles in the code:

| Role | How it is determined |
|---|---|
| **Requestor** | The default. Anyone on an allowed domain who is not an approver. |
| **Approver** | Appears in at least one active `Group_Approvers` row. |
| **Admin** | ⚠️ **Not a role.** An additive `isAdmin` flag from the `Admins` sheet. An admin who is also an approver keeps `role: "approver"`. |

---

## §0.2: Architecture & data model

### The three layers

1. **Application layer (Apps Script):** a frontend of HTML partials (CSS + screens + client JS,
   assembled by `include()` at serve time) and a backend of `.js` files (`doGet`, business logic,
   database access), talking over `google.script.run`.
2. **Database layer (Google Sheets):** one spreadsheet, 10 tabs.
3. **File storage layer (Google Drive):** two folders, one for uploaded supporting documents,
   one for generated certificates.

### 🚩 The two runtime constraints that shape everything

**1. One global scope.** All `.js` and `.html` files share a single Apps Script runtime scope.
There are no imports or exports. A function defined in one file is callable from any other. This
is why the codebase uses filename prefixes and naming discipline instead of modules.

**2. Every top-level function is a public HTTP endpoint.** See §0.6. This is the single most
important thing to know about this codebase.

### Canonical sheet reference

*(Verified against `SHEET_NAMES` and the column-map constants in `backend/Constants.js`. This
table replaces the copies that used to live in four separate documents.)*

| Sheet | Constant | Cols | Holds | Notes |
|---|---|---|---|---|
| `Requests` | `CR` | 25 | One row per request | STATUS/STEP/RESUBMIT_COUNT are a **read-cache**, not truth |
| `Activity_Log` | `ACT` | 9 | Append-only action timeline | **The source of truth.** Never updated, never deleted |
| `Groups` | `GRP` | — | Approver-group registry | Surrogate `group_id` PK (`G001`) so a group can be renamed safely |
| `Group_Approvers` | `GAP` | — | The approver chains | Composite key (group_id, sequence); `ACTIVE` soft-disables a slot |
| `Request_Attachments` | `RA` | 8 | Uploaded supporting documents | Includes the resubmit cycle each file belongs to |
| `Request_Flags` | `FLG` | 9 | Per-item "fix this" marks raised on a return | **Self-healing tab** |
| `Admins` | `ADM` | — | Admin allowlist | Managed by hand; there is deliberately no UI |
| `Admins_Log` | `ADL` | 6 | Append-only audit of admin actions | **Self-healing tab** |
| `COC_PDFs` | `COCPDF` | — | One row per generated certificate | Supports re-issuance |
| `Locations` | `LOC` | 2 | The Location dropdown options | **Self-healing tab**; the sheet *is* the editor |

> 🚩 **Three tabs create themselves.** `Request_Flags`, `Admins_Log` and `Locations` are created
> on demand: the first two on first write, `Locations` on first *read* (because nothing in the
> code ever writes it, so there is no write to hang the creation on). Creating them by hand is
> optional. The other seven must exist before the portal will work.

### The `Requests` row (`CR`)

| # | Column | # | Column |
|---|---|---|---|
| 1 | request_id | 14 | prism |
| 2 | control_number | 15 | purchase_order |
| **3** | **status** ← cache | 16 | ihelp_number |
| **4** | **current_step** ← cache | 17 | product_type |
| 5 | date_of_filing | 18 | product_name |
| 6 | project_title | 19 | type_of_purchase |
| 7 | requestor | 20 | type_of_license |
| 8 | requestor_designation | 21 | contract_start |
| **9** | **group** ← FK to `Groups` | 22 | contract_end |
| 10 | accountable_person | 23 | supplier_name |
| 11 | department | 24 | requestor_remark |
| 12 | location | **25** | **resubmit_count** ← cache |
| 13 | pc_name | | |

> 🚩 **Column 9 holds a `group_id` (`G001`), not a group name.** This is what lets an admin
> rename a group without breaking the routing of every in-flight request.

> 🚩 **Two number systems, and mixing them is the classic bug.**
> `sheet.getRange(row, CR.STATUS)` is **1-based** (Sheets API).
> `row[CR.STATUS - 1]` is **0-based** (array index). Never hardcode a column number.

### 🚩 The status cache and why it exists

`Requests.status`, `.current_step` and `.resubmit_count` are **denormalized copies**. The truth
is the `Activity_Log` timeline. They exist so a dashboard listing 200 requests does not have to
replay 200 timelines.

They are kept current **only** by `setRequestCache_()` in `Accessors.js`. Anything that changes
a request's state must go through it, or the list views and the detail views will disagree.

### 🚩 The Accessors seam

**All database reads and writes go through `backend/Accessors.js`.** Feature code never touches
`Activity_Log`, `Groups`, `Group_Approvers`, `Request_Flags` or `Locations` directly.

The seam exists because the database was normalized from a 35-column monolith into these ten
tabs *after* the frontend was built. `getApprovalView_()` reconstructs the old per-step,
history and N-of-M shapes from the timeline, so the **frontend data contract stayed frozen** and
the UI barely changed. That is why the migration was survivable.

### Memoization and its one rule

Six tables are cached per execution (`Groups`, `Group_Approvers`, `Activity_Log`, `Admins`,
`Request_Attachments`, `Request_Flags`, plus `Locations`). Apps Script discards globals between
executions, so a cache is one read per run with no staleness window across runs.

> 🚩 **Every memoized table has exactly one writer, and that writer must invalidate.**
> `appendAction_` is the sole writer of `Activity_Log` and calls `invalidateActivityCache_()`.
> If you add a second writer and forget the invalidation, reads *later in the same execution*
> silently miss the row you just wrote. That is not hypothetical: the notification emails fire
> immediately after an approval, in the same execution.
>
> `Requests` is deliberately **not** memoized: it is written on nearly every mutation.

---

## §0.3: The approval chain, returns, and flags

### The chain

```
Submitted ──► Approver 1 ──► Approver 2 ──► Approver 3 ──► Fully Approved
                 │               │               │
                 └── Decline (terminal) ─────────┘
                 └── Return to requestor ────────┘
```

**🚩 Hard-capped at three approvers.** The `Group_Approvers` schema can store N rows, but the
routing engine only handles three: `getApprovers_()` reads sequences 1–3, `approve_()` branches
steps 1–3, and `isChainApprover_()` checks slots 1–3.

> ⛔ **A hand-added `sequence = 4` row locks that request out permanently.** It resolves in
> `getCurrentApprover_()` but fails `isChainApprover_()`, so nobody can action it and it never
> appears in anyone's pending list. The Admin console enforces the 1–3 cap; only direct
> spreadsheet editing can create this state. Lifting the cap is a real change to those three
> functions plus the certificate's signatory layout.

**Blank slots are skipped.** A group with only Approver 1 configured goes straight from
`Pending Approver 1` to `Fully Approved`. So **`step` is not a reliable "N of M" counter.**
For progress, compute N from the approved actions in the current cycle and M from the count of
configured slots.

### Return: a full restart, not a resume 🚩

A **Return** from any approver bounces to the **requestor**. On resubmit, the request goes back
to **Approver 1** and the whole chain runs again. Nothing resumes mid-chain.

- **Return ≠ Decline.** Return is a fixable loop. Decline is terminal; the requestor must file a
  new request.
- **Nothing is erased.** Each resubmission is a new **cycle**. Every previous cycle's approvals,
  comments and flags stay in `Activity_Log` and `Request_Flags` permanently, tagged with their
  cycle number.

### Flags: per-item "fix this" marks

When an approver returns a request they may optionally flag **specific fields or specific
documents**, each with its own comment, on top of the required overall reason.

- The flaggable set is `FLAGGABLE_FIELDS` in `Constants.js` (17 fields). The frontend receives it
  as a data field and never hardcodes a copy.
- ⚠️ **`group` is deliberately not flaggable or editable.** The approver group is recorded on
  every action row, so allowing a mid-history group change would make the audit log contradict
  itself. A wrong group means decline and refile.
- On resubmit, the requestor edits **every** field through a full prefilled form, and open flags
  are stamped resolved.

**Where flags are shown, and why it is split:**

| Flags | Where |
|---|---|
| **Open** (just returned) | "What needs fixing" card at the top of the request page, plus amber highlights on the affected fields and documents |
| **Resolved** (history) | Inside **Request History**: the return that raised them carries a "View details" button opening a dialog |

> The resolved-flag card used to sit pinned at the top of the page. It was moved into the history
> because it restated what the history already recorded.

### The request history

Every workflow action, across every cycle, in one chronological list: submitted, each approval
(with any comment), each return (with its reason), each resubmit (with what changed). The
requestor, the approvers and the notification emails all render **the same list**, so three
people looking at one request see one story.

**Compaction rule 🚩** — a brand-new request whose only entry is the submission renders as one
plain line, not a cycle-headed timeline. Cycle headers ("Original submission", "Resubmit #1")
appear only once there is more than one cycle. This rule is implemented in **three** places, the
portal and both email formats, and they must stay in step.

> 🚩 **The three `EXPIRY_*` system actions are excluded from the history by an explicit
> allowlist.** They share the `Activity_Log` table but are reminder-sent flags, not approval
> events. Every other view filters them only by accident, because each branches on a workflow
> action by name; the history is the one generic walk, so without the allowlist a requestor would
> see "expiry_warning · system" in their approval history. **Never remove that filter.**

---

## §0.4: Operations, deployment & configuration 🚩

### The config resolver

Environment-specific values resolve in this order:

```
Script Property  →  the literal in Constants.js  →  a named error
```

**Preferred: set a Script Property** (Project Settings → Script Properties). It beats the source
literal, needs no code change and no redeploy, and deleting the property is a complete rollback.

| Property | Holds |
|---|---|
| `SPREADSHEET_ID` | The database spreadsheet. **Only needed for a standalone project** (see below) |
| `ARCHIVE_FOLDER_ID` | Drive folder for generated certificate PDFs |
| `ATTACHMENTS_FOLDER_ID` | Drive folder for uploaded supporting documents |
| `EMAIL_DEV_TAG` | `false` in production. Adds `[FOR APPROVER]`/`[FOR REQUESTOR]` subject prefixes when true |

> ⚠️ **A property overrides the literal silently.** Editing `Emails.js` to turn off the dev tag
> does nothing if a stale `EMAIL_DEV_TAG` property still exists. Check the property first.

`_testConfig()` prints every resolved value and its source. Run it after any config change: the
folder lines should read `[PROPERTY]`, not `[fallback(Constants.js)]`.

> 🚩 **The domain allowlist is deliberately NOT a Script Property.** `ORG.ALLOWED_DOMAINS` lives
> in `Constants.js` because it is a security control, and a security control should be
> version-controlled, diffable and code-reviewed rather than silently editable with no audit
> trail.

### Container-bound vs standalone

`getSpreadsheet_()` resolves the database as:

```javascript
SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(config_("SPREADSHEET_ID"))
```

- **Container-bound** (script created from the spreadsheet via Extensions → Apps Script):
  the first call wins, the fallback is never reached, and no property is needed.
- **Standalone** (script created on its own): the first call returns `null` and the
  `SPREADSHEET_ID` property is required. Missing it throws a **named** error, not a null
  reference.

Both are supported. Standalone has a real advantage worth knowing: a bound script can be edited
by anyone with edit access to the spreadsheet, so standalone keeps **data access and code access
as separate permissions**.

### Deploying 🚩

```
Deploy → Manage deployments → ✏️ edit the EXISTING deployment → New version → Deploy
```

| Setting | Value | Why |
|---|---|---|
| Execute as | **Me** (the owner account) | The backend reads the spreadsheet and Drive as the deploying user. Anyone else lacks access and every call fails. |
| Who has access | **Anyone within Megaworld** | ⛔ **Never "Anyone."** |

> ⛔ **Never click "New deployment" on a live app.** It mints a brand-new URL. Every deep-link in
> every email already sent points at the old one. One deployment per app, forever; only ever
> "New version". *(A brand-new project is the one exception, since there is nothing to break.)*

> 🚩 **"Who has access: Anyone" is not merely permissive, it breaks identity.** With a public
> deployment `Session.getActiveUser().getEmail()` returns an **empty string**, and a blank caller
> must never be able to write rows. The domain allowlist in code is the backstop for exactly this
> misconfiguration, not a replacement for the setting.

> ⚠️ **`clasp push` updates `/dev` only.** Email deep-links use `ScriptApp.getService().getUrl()`,
> which returns the last **published** `/exec` URL. Push without republishing and you will be
> debugging code that is not running.

### Scheduled jobs

Two daily time-based triggers, both around 8am Manila. **Both must be registered once per Google
account** by running them from the editor. They are **not** created by a code push.

| Function | Registrar | Does |
|---|---|---|
| `checkContractExpiries` | `registerExpiryTrigger` | Emails requestors about lapsing contracts (T-3, day-of, post-expiry) |
| `checkPendingApprovals` | `registerApproverReminderTrigger` | Nudges approvers sitting on pending requests |

> 🚩 **The two jobs use opposite idempotency models, on purpose.** The expiry sweep writes a
> per-stage flag to `Activity_Log`, because sending the same "expiring soon" notice twice is a
> defect. The approver nudge writes **nothing**: repeating is the whole point, so the schedule
> plus date arithmetic is the only guard. Logging one row per pending request per reminder day
> would bloat the append-only timeline for no benefit.

> ⚠️ **Timezone matters.** The reminder cadence is date arithmetic against the project timezone.
> Confirm `"timeZone": "Asia/Manila"` in `appsscript.json` or reminders fire on the wrong days.

---

## §0.5: Known gotchas & debugging 🚩

| Gotcha | What happens / what to do |
|---|---|
| **A non-JS file pushed as `.gs`** | Apps Script evaluates every `.gs` at load, so a Node script using `require()` throws **before any code runs** and takes the whole project down. This happened twice: once with `tools/callable-surface.js` (fixed by `.claspignore`), once with `appsscript.json` pasted as a script file during migration. The manifest is enabled via Project Settings, never created as a file. |
| **`afterRender_<page>` casing** | The hook name must match the lowercase route key exactly. `afterRender_approverDashboard` fires; `afterRender_ApproverDashboard` **silently never does**. Check the switch in `JavaScript.html`. |
| **HTML file names are load-bearing** | `include('frontend/pages/Login')` needs a file named exactly that, slashes included. Apps Script's file list is flat; the slash is part of the name. A mismatch renders a **blank page with no error**. |
| **Screens are rendered by JS** | Page `<div>`s are empty in the HTML and filled by `render*()` at runtime. Ctrl+F for on-screen text will miss it; search the render function. |
| **Grid/flex children need `min-width: 0`** | Without it, a long email address or project title overflows its track and produces a horizontal scrollbar. Applies to `.detail-main`, `.detail-rail` and any new flex/grid child holding text. |
| **Search input loses focus mid-type** | The search handler must re-render **only** the list region, never the controls region containing the `<input>`. |
| **Trailing-underscore functions are hidden from the Run menu** | They are callable server-side and from other files, but do not appear in the editor's function dropdown. To run one manually, temporarily drop the underscore. |
| **"Returned" ≠ "Declined"** | Returned is a fixable loop; declined is terminal. |

**General debugging:** frontend → browser DevTools console, watching `google.script.run` calls.
Backend → Apps Script editor **Executions** plus `Logger.log`. Workflow questions → read
`Activity_Log` directly; it is the truth and it is append-only.

---

## §0.6: Security model

### 🚩 The callable surface: the control that is easiest to get wrong

In Apps Script, **every top-level function in the project is an HTTP endpoint.** Any signed-in
user can open a browser console on any page and call `google.script.run.anyFunctionName(...)`.
Hiding a button, gating a page, or simply never calling a function from the UI provides **zero**
protection.

The only thing that removes a function from that surface is a **trailing underscore**
(`fnName_`). A **leading** underscore does nothing: `_testConfig` is fully reachable.

Every backend function must pick exactly one of these:

| Situation | What to do |
|---|---|
| Internal helper (the default) | Name it `fnName_` |
| Genuinely called by the frontend | Keep the bare name **and** guard the body |
| Trigger handler / editor-run helper | Keep the bare name and guard with `isOwnerContext_()` |

The third case exists because a time-based trigger binds its handler by **name string**, so a
trailing underscore would orphan the installed trigger. `isOwnerContext_()` compares
`getEffectiveUser()` with `getActiveUser()`; they match only for the owner or a trigger run.

> 🚩 **Guard the primitive, not the wrapper.** A guarded `handleApprove` means nothing if the
> `approve_` beneath it is also callable. This was a real gap: the mutators were guarded while
> `setRequestCache` and `appendAction` were not.

The surface went from **118 functions to exactly 27**, and that count is enforced by
`tools/callable-surface.js`. Run it before every push:

```bash
node tools/callable-surface.js
```

It exits non-zero on drift. When a callable is deliberately added or removed, update its
`EXPECTED` constant in the same commit.

### Authorization pattern

Every sensitive callable follows the same shape:

1. Resolve the caller from the server: `Session.getActiveUser().getEmail()`
2. Load the request row
3. **Guard before the first sheet write**

> 🚩 **Identity always comes from `Session`, never from a parameter.** The frontend never sends
> an email address for the server to trust.

> 🚩 **Never compare emails with `===`.** Use `sameEmail()`. Google accounts vary in casing
> across sessions, and `sameEmail` additionally rejects blank-vs-blank, so two empty cells are
> never treated as the same approver.

### Domain allowlist

`ORG.ALLOWED_DOMAINS` is a server-side backstop behind the deployment's access setting, enforced
at sign-in and at request creation.

> ⚠️ **An empty array allows every domain, including personal Gmail.** It fails *open*, and the
> failure is silent because everyone simply keeps working. It must name the real domains.
> `ORG.TRANSITIONAL_DOMAINS` records temporary maintainer-access domains, and `_testConfig`
> prints a loud warning for every one still live, so a forgotten exception surfaces at go-live
> instead of relying on memory.

### Input integrity

- **Formula injection is rejected.** A value beginning with `=` written to a cell becomes a live
  formula executing under the identity of whoever opens the spreadsheet. Every free-text write
  path rejects it: form fields, remarks, file descriptions, flag comments, admin group names and
  designations.
- **Uploads are validated by magic bytes**, not just extension, so a `.txt` renamed to `.pdf` is
  caught server-side.
- **`LockService` serializes** the four workflow mutators and the submit path. Each re-reads
  state inside the lock, making it a true compare-and-set, so a double-click cannot produce two
  certificates.

### Attachments are private

Uploaded documents are never exposed as Drive URLs. The UI fetches bytes through the
identity-gated `downloadAttachment()`, which re-checks that the caller is party to that request.
Both Drive folders must be set to **Restricted**.

**Attachments are append-only.** A "replacement" on resubmit is a new upload; both versions stay,
grouped by cycle. This is deliberate: if a flagged document could be deleted, the flag would
point at something nobody can see and the audit trail would lose what was objected to.

---

## §0.7: Glossary & status vocabulary

| Term | Meaning |
|---|---|
| **Request** | One Certificate of Completion application. Identified by `request_id`; shown to users as a **control number** (`EC-2026-00001-A6A`) |
| **Group** | A named approver chain (e.g. "ISM - InfoSec"). Stored as a `group_id` (`G001`) |
| **Step** | Which approver position is currently holding the request (1, 2 or 3; 0 = with the requestor) |
| **Cycle** | The resubmission round. 0 = original submission, 1 = after the first resubmit |
| **Flag** | A per-field or per-document "fix this" mark raised on a return, with its own comment |
| **Return** | Send back to the requestor for correction. Fixable; restarts the chain at Approver 1 |
| **Decline** | Terminal rejection. The requestor must file a new request |
| **Timeline / Request History** | The chronological list of every action, derived from `Activity_Log` |

### Stored status (`Requests.status`) 🚩

These exact strings are a **frozen contract**, compared in filters, email subjects and frontend
badges. A raw-string typo silently breaks routing. Always use the `STATUS.*` constants.

| Value | Meaning |
|---|---|
| `Pending Approver 1` | Awaiting the first approver |
| `Pending Approver 2` | Awaiting the second |
| `Pending Approver 3` | Awaiting the third |
| `Fully Approved` | All configured approvers signed off; certificate issued |
| `Declined` | Terminal rejection |
| `Returned to Requestor` | Sent back for correction |

> ℹ️ **There is no "Expired" status, deliberately.** Expiry is a **derived lens**, computed live
> from the contract end date, shown as a separate chip *next to* the status badge. Adding it to
> the enum would make a request stop being "Fully Approved", which it still is.

### Action values (`Activity_Log.action`)

**Workflow:** `submitted` · `approved` · `declined` · `returned` · `resubmitted`

**System (not approval events):** `expiry_warning` · `expiry_notice` · `expiry_overdue`

---

*Part 0 ends here. Continue to [Part 1: Using the portal](part-1-users.md),
[Part 2: Administration](part-2-admin.md), or [Part 3: Developer handover](part-3-developer.md).*
