# 04 · Workflows & Flows

> Each flow traces ONE operation across frontend → server → Sheet → email. The Google Sheet is the official record (★ = the official state change). Function **names are stable**; line numbers drift.

## 1. The request lifecycle (state machine)

```
REQUESTOR fills form + uploads ≥1 file → Submit
   → Status "Pending Approver 1", Step 1, Activity_Log: submitted
   → email Approver 1 (notification + portal deep-link)

APPROVER N opens portal → Approve / Decline / Return:
  APPROVE  → append `approved`; next status = next pending OR "Fully Approved" (skips blank slots)
           → emails: if final → final-confirm + requestor success (COC PDF attached)
                     else      → next approver + acting-approver receipt + requestor progress
  DECLINE  → append `declined`, Status "Declined" (terminal); emails: approver receipt + requestor notice
           → (stamps NO date — see N-of-M note)
  RETURN   → capture-before-clear, then Status "Returned to Requestor", Step 0
           → emails: requestor return notice + approver receipt + prior-approvers chain alert

REQUESTOR resubmits (only if Returned) → Step 1, "Pending Approver 1", chain restarts from Approver 1
           → emails: requestor resubmit confirm + Approver 1 (carries the prior return reason)

FULLY APPROVED → COC PDF generated, archived to Drive, logged to COC_PDFs, emailed to requestor
```

State transitions (`Status` set by / triggers):

| Status | Set by | Fires |
|---|---|---|
| `Pending Approver 1` | New submit / resubmit | Approver 1 notification |
| `Pending Approver 2/3` | Approve at prior step | Next approver + intermediate emails |
| `Fully Approved` | Approve at final step | Final-approver + requestor success (COC attached) |
| `Declined` | Decline (any step) | Decline receipt + requestor notice |
| `Returned to Requestor` | Return (any step) | Return notice + receipt + chain alert |

## 2. The operation flows (condensed)

**Flow 1 — Open portal → home.** `doGet(e)` serves the shell (bakes in any `?page=&id=`) → `Index.html` emits `__INITIAL_ROUTE` → `bootstrap()` → `callServer('getCurrentUser')` → `detectRole` decides approver/requestor → `navigateTo('home')` resolves by role to Dashboard or ApproverDashboard. No data change.

**Flow 2 — Submit a request.** `NewRequest.onNewRequestSubmit` → `validateNewRequest` (15 required fields + contract-end ≥ start) → `showLoading` → `callServer('submitNewRequest', data)`. Server: generate IDs, **upload all files to Drive first (atomic, rollback on failure)**, write the request row + `Request_Attachments` rows in batched `setValues`, append `submitted` to `Activity_Log`, then `sendApprovalRequest` to Approver 1. ★ the row write is the official record.

**Flow 3 — Approve.** `ReviewDetail.onApproveClick` → `showConfirm` → `runReviewAction('handleApprove', [id], …)`. Server `handleApprove`: **🔒 `isCurrentApprover` guard before any write** → `approve(requestId)` (appends `approved`, computes next status **skipping blank approver slots**, updates cache) → branch emails: final → 2 emails (COC generated + attached here); else → 3 emails (next approver + acting-approver receipt + requestor progress "cleared N of M").

**Flow 4 — Decline.** `handleDecline` → 🔒 guard → `decline()` appends `declined`, Status `Declined`. **No date stamped** (intentional). Emails: receipt + requestor notice (with reason + "Approver N (email)" label).

**Flow 5 — Return** ⭐ *the heavy one — "capture before clear".* `handleReturn`: read pre-mutation state (step, group, approvers, returner email) **while Step still points at the returner** → 🔒 guard **before any write** → `returnRequest()` flips Step→0, Status `Returned to Requestor`, appends `returned` → 3 emails (requestor return notice, approver receipt, **`sendReturnedChainNotification`** alerting the approvers who had already signed — they were captured *before* the reset). Post-normalization, the "who had already approved" snapshot is derived from `getApprovalView().previousApprovals`, not a stored column.

**Flow 6 — Resubmit.** `handleResubmit`: 🔒 must be the **owner** AND status `Returned to Requestor` → capture the old return reason + count **before** clearing → optional re-upload of corrected files (appends, keeps old, tagged next cycle) → `resubmit()` bumps count, promotes the `[PENDING]` history line to `Resubmit #N`, sets Step 1 / Status `Pending Approver 1`, appends `resubmitted` → emails: requestor resubmit confirm + Approver 1 (carries the prior return reason so they know it's a resubmission).

**Flow 7 — Open from email link.** Email body's `getPortalUrl(requestId, page)` → `…/exec?page=review&id=REQ-…` → `doGet` reads params → `bootstrap()` honors the deep-link (wins over hash/home). `page='review'` for approvers, `'request'` for requestors. **Query params, not `#hash`** (the iframe can't read the outer hash).

**Flow 8 — View a request (read + permission).** `getRequestDetail(requestId)`: 🔒 if caller is **neither** the requestor **nor** a chain approver **nor** an admin → returns **`null`** → renderer shows empty state. `null` = both "not found" and "no access", on purpose.

**Flow 9 — Background trigger.** `onSheetChange(e)` (installable, registered once via `registerTrigger()`) routes by changed tab → `handleCertificateRequestChange` watches the Status column and fires the matching email pair (the ported AppSheet bots). Runs **in parallel** to the `handle*` paths — see the double-send caveat below. Currently dormant/unregistered.

## 3. Three patterns that repeat everywhere

1. **Guard before write.** Every sensitive server action checks identity (`Session` + `sameEmail`) *before* touching the Sheet. The frontend only hides buttons; the **server** enforces. (Flows 3–6, 8.)
2. **Capture before clear.** Return (5) and resubmit (6) record history/snapshots *before* the low-level action wipes old state. **Order is load-bearing** — read the returner/prior-approvals/reason while the state is still live.
3. **The Sheet is the source of truth (★).** Every official change is an `appendAction`/`setRequestCache`/`appendRow`/`setValues`. Emails and dashboards just react. Two things can react to a Status change (the `handle*` path and `onSheetChange`) — know which is authoritative.

## 4. N-of-M progress — use ACTIONS, not Step

`approve()` **skips blank approver slots** (a group with only slot 1 configured goes PENDING_1 → Fully Approved, skipping 2 & 3). So **`Step` is NOT a reliable "N of M" count.** Always compute:
- **N** = `getApprovalView(requestId).approvedCount` — count of `approved` actions in the current cycle.
- **M** = count of non-null `approver1/2/3` slots from `getApprovers(groupId)`.

The frontend "final approver?" check mirrors this: `isFinalApprover = !slots.some(s => s.n > step)` using `getConfiguredApproverSlots()`.

## 5. The approvers-chain visual (5 states)

`renderApproversChain(detail, blurFutureEmails)` (shared, lives in `RequestDetail.html`; `ReviewDetail.html` interpolates it) shows every approver with one of **5 states** — needed because Decline/Return don't stamp a date and aren't "Pending":

| Icon | State | When |
|---|---|---|
| ✓ navy | Acted/Approved | has an `approved` action |
| ✕ red | Declined | declined this request |
| ↩ amber | Returned | returned this request |
| ⏳ amber | Current | the current pending approver |
| ○ gray | Awaiting | not yet reached |
| — | Not reached | downstream slot on a terminal (Declined/Returned) request |

**Email privacy:** `blurFutureEmails=true` on the **requestor** view hides future approvers' emails (→ `—`) until they're Current or have Acted; `false` on the **approver** view shows the full chain. (Inspired by DLSU's internship-form pattern — future signatories shown with reduced detail until their turn.)

## 6. The `[PENDING]` resubmit-history contract (frozen format)

The resubmit-history string is reconstructed on read by `getApprovalView()` from the `returned`/`resubmitted` timeline rows. **Format is frozen** (the frontend banner parser depends on it):
- Entries separated by **`\n\n---\n\n`**.
- A `returned` action with no later matching `resubmitted` (cycle+1) → prefixed **`[PENDING]`** (the current, unconfirmed return).
- A `returned` that *was* followed by a resubmit → labeled **`Resubmit #N —`**.
- **Only the latest return is `[PENDING]`** (a resubmit always follows older returns).
- `[PENDING]` is an **internal marker — never shown to users**; the banner relabels it "Returned by:".

The resubmit banner splits into **Block A** (active return reason, always expanded) + **Block B** (previous cycles, collapsible).

## 7. Scheduled jobs (Google cloud, laptop-independent)

Two daily ~8am (Asia/Manila) time-based triggers. Each must be registered **once per Google account** (NOT created by `clasp push`):

| Job | Function | Registers via | Idempotency |
|---|---|---|---|
| Contract-expiry sweep (#10) | `checkContractExpiries()` | `registerExpiryTrigger()` | **`Activity_Log` system flags** (`expiry_warning/notice/overdue`) — once-each per stage |
| Pending-approval nudge | `checkPendingApprovals()` | `registerApproverReminderTrigger()` | **the daily schedule itself** — writes NOTHING to `Activity_Log` (a nudge is *meant* to repeat) |

> `.atHour(8)` = *sometime in the 8–9am window*, not 8:00:00. The expiry warning + overdue stages use self-healing ranges (a skipped run catches up); the day-of stage is exact (a missed day-of is caught next day by "Has Expired"). The third per-account registration is `registerTrigger()` (the dormant `onSheetChange`).
