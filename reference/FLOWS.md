# E-Certificate Portal — Function & File Flows (Onboarding Reference)

**Layman first:** each section traces ONE real operation across every file it touches — frontend → server → Sheet → email — with exact `file:line → function`. The **Google Sheet is the official record (our "ledger")**; everything else reads from or reacts to it. Read one flow top-to-bottom and you can follow the same code path in the editor.

**Lanes:** 🖥 Frontend (browser) · ⚙️ Server (Apps Script `.js`) · 📊 Sheet (the database) · ✉️ Email
**Markers:** `→` calls next · `⤷` uses helper · **🔒** identity/permission guard · **★ SHEET** = the official state change (source of truth)

> **One convention (true for every 🖥→⚙️ hop):** the browser never calls the server directly. It goes through `JavaScript.html:106 → callServer(fnName, ...args)`, which wraps Google's `google.script.run` in a Promise. Assume it sits on every frontend→server arrow below; it's omitted to cut noise.

> Line numbers reflect the current code (post-documentation pass). If you edit a file and they drift, re-grep `^function` — the function *names* are stable.

---

## Flow 1 — Opening the portal → landing on your home screen

**Layman first:** you open the URL; the server hands over the page shell, the app asks "who am I?", and routes you to your correct dashboard. No data changes — this is pure routing.

### Step 1 — Server serves the shell (Server)
**File:** `WebApp.js:115 → doGet(e)`
**Layman:** Google calls this when anyone opens the web-app URL. It reads any deep-link params (`?page=&id=`) and bakes them into the page before sending it.
```
doGet(e) → reads e.parameter.page/id → template.initialPage/initialId → Index.html
```

### Step 2 — Page announces the deep-link target (Frontend)
**File:** `Index.html:76` (scriptlet)
**Layman:** The server-rendered HTML drops the target into a global the router can read.
```
window.__INITIAL_ROUTE = { page: "<?= initialPage ?>", id: "<?= initialId ?>" }
```

### Step 3 — Bootstrap figures out who you are (Frontend → Server)
**File:** `JavaScript.html:609 → bootstrap()`
**Layman:** Runs once on load. Shows a login splash, then asks the server for your identity + role.
```
bootstrap() → navigateTo('login')  →  callServer('getCurrentUser')
```
**File:** `WebApp.js:278 → getCurrentUser()` ⤷ `WebApp.js:166 → detectRole(email)`
**Layman:** Reads your email from the Google session (never trusted from the browser), then checks `Group_Approvers` — if your email is an active approver in any group, you're an `approver`; else `requestor`.

### Step 4 — Route to your home (Frontend)
**File:** `JavaScript.html:522 → refreshNavbar()` then `JavaScript.html:430 → navigateTo('home')`
**Layman:** Fills the sidebar, then `'home'` resolves by role to either dashboard. Deep-link (from an email) wins over a saved hash, which wins over plain home.
```
navigateTo('home') → role === 'approver' ? renderApproverDashboardPage : renderDashboardPage
```

**One-line flow summary**
```
WebApp.doGet  →  Index.__INITIAL_ROUTE
  → JavaScript.bootstrap
      ├─ callServer('getCurrentUser')  →  WebApp.getCurrentUser ⤷ detectRole   (who am I?)
      ├─ JavaScript.refreshNavbar                                              (fill sidebar)
      └─ JavaScript.navigateTo('home')  →  Dashboard / ApproverDashboard
```

---

## Flow 2 — Submitting a new request (no attachments)

**Layman first:** you fill the form and hit submit; the form is validated, a new row is written to the Sheet as `Pending Approver 1`, and Approver 1 gets an email with a portal link. The Sheet write is the official record.

### Step 1 — Submit the form (Frontend)
**File:** `NewRequest.html:238 → onNewRequestSubmit(e)` ⤷ `NewRequest.html:292 → validateNewRequest(form)`
**Layman:** Checks all 15 required fields + "contract end ≥ start". If OK, shows the loading overlay and hands the data to the server.
```
onNewRequestSubmit → validateNewRequest → showLoading('Submitting…') → callServer('submitNewRequest', data)
```

### Step 2 — Server writes the request (Server → Sheet)
**File:** `WebApp.js:625 → submitNewRequest(formData)`
**Layman:** The brain of submission. Generates IDs, decides the starting status, writes the row, and (if no attachments are pending) emails Approver 1.

| Sub-step | Lines | Layman |
|---|---|---|
| Generate IDs + status | 627–631 | `generateRequestId` + `generateControlNumber`; identity from `Session`; `expected=0` → status `Pending Approver 1` |
| Build the 33-col row | 633–659 | Fill each cell by `CR.*` index; `Step=1`, `Date of Filing=now`, `Resubmit_Count=0` |
| **★ Write to the Sheet** | 661 | `sheet.appendRow(newRow)` — the official record is created here |
| Fire first email | 664–666 | if `Pending Approver 1` → `sendApprovalRequest(requestId)` |

**File (IDs):** `Utils.js:321 → generateRequestId()` · `Utils.js:353 → generateControlNumber()`

### Step 3 — Notify Approver 1 (Email)
**File:** `Emails.js:234 → sendApprovalRequest(requestId)`
**Layman:** Looks up *who* the current approver is, builds the email (request info + attachments list + a portal deep-link), and sends it.
```
sendApprovalRequest ⤷ getCurrentApprover + buildInfoBlock + buildAttachmentList + getPortalUrl + emailLayout (HTML twin) → sendBrandedEmail (text fallback + htmlBody)
```

### Step 4 — Land on the new request (Frontend)
**File:** `NewRequest.html:238` (resumes) → `JavaScript.html:430 → navigateTo('request', {id})`
**Layman:** Spinner off, success toast, redirect to the new request's detail page.

**One-line flow summary**
```
NewRequest.onNewRequestSubmit ⤷ validateNewRequest      (validate + spinner)
  → WebApp.submitNewRequest
      ├─ Utils.generateRequestId / generateControlNumber
      ├─ ✎ sheet.appendRow                              ★ SHEET — new row as "Pending Approver 1"
      └─ Emails.sendApprovalRequest                     (→ Approver 1, with portal link)
  ⟲ navigateTo('request', {id})
```

---

## Flow 3 — Approver approves (single approver → Fully Approved; or chain continues)

**Layman first:** an approver clicks Approve. The server checks they're really the current approver, advances the request, and — depending on whether more approvers remain — either finishes it or passes it down the line. The Sheet write is the official state change.

### Step 1 — Click Approve (Frontend)
**File:** `ReviewDetail.html:329 → onApproveClick()` → `ReviewDetail.html:380 → runReviewAction(...)`
**Layman:** Confirm modal, then the shared action runner locks the buttons, shows a spinner, and calls the server.
```
onApproveClick → showConfirm → runReviewAction('handleApprove', [id], 'Request approved.', 'Approving…')
```

### Step 2 — Server orchestrates (Server)
**File:** `WebApp.js:711 → handleApprove(requestId)`
**Layman:** Guard → do the approval → send the right emails based on what happened.

| Sub-step | Lines | Layman |
|---|---|---|
| **🔒 Authorize** | 712–715 | Load the row; if you're not the current approver → `Unauthorized` (server-enforced, not just UI) |
| Perform the approval | 717 | `approve(requestId)` — the actual state change |
| Branch the emails | 718–727 | **Final** (`Fully Approved`) → 2 emails (719–721) · **More remain** → 3 emails: next approver + your receipt + requestor progress (722–726) |

### Step 3 — The official state change (Server → Sheet)  ★
**File:** `Approvals.js → approve(requestId)`
**Layman:** Reads the step/group/approvers, records the approval as a new row in the timeline, and figures out the next status (skipping blank approver slots — that's why a single-approver group jumps straight to `Fully Approved`), then updates the request's status/step cache.

> ⚠️ **Post-normalization mechanism (the line numbers below have drifted; the steps are conceptual).** Approvals are no longer stamped into `App1/2/3_Date` / `Last_Action_By` columns — those columns are gone. Each action is **appended to `Activity_Log`** via `appendAction()`, and the `Requests` status/step cache is updated via `setRequestCache()`. History/who-acted is derived from the timeline by `getApprovalView()`.

| Sub-step | Layman |
|---|---|
| Load row | locate by Request ID (`getRange(rowNum,1,1,CR.RESUBMIT_COUNT)`); bail if missing |
| Read step/group/approvers | `getApprovers(groupId)`; bail if group unconfigured |
| Decide next status | step 1/2/3 → next pending; skips empty slots → may go straight to `Fully Approved` |
| **★ Record the action** | `appendAction(...ACTION.APPROVED...)` to `Activity_Log` |
| **★ Update the cache** | `setRequestCache(requestId, { status, step })` on `Requests` |

### Step 4 — Emails (Email)
- **Final:** `Emails.js → sendFullyApprovedToApprover` + `Emails.js → sendFullyApprovedToRequestor`  *(COC PDF is generated by `generateCOC()` and attached here — Phase 9, done — and logged to `COC_PDFs`)*
- **Intermediate:** `Emails.js:234 → sendApprovalRequest` (next) + `Emails.js:535 → sendApproveConfirmToApprover` (receipt) + `Emails.js:577 → sendProgressUpdateToRequestor` ("cleared N of M")

### Step 5 — Back to dashboard (Frontend)
**File:** `ReviewDetail.html:380` (resumes) → `hideLoading` + toast + `navigateTo('approverDashboard')`

**One-line flow summary**
```
ReviewDetail.onApproveClick → showConfirm → runReviewAction
  → WebApp.handleApprove
      ├─ isCurrentApprover                              🔒 guard
      ├─ Approvals.approve                              ★ SHEET — Step / Status / AppN_Date / Last_Action_By
      └─ branch on newStatus:
           "Fully Approved" → sendFullyApprovedToApprover + sendFullyApprovedToRequestor
           else             → sendApprovalRequest + sendApproveConfirmToApprover + sendProgressUpdateToRequestor
  ⟲ navigateTo('approverDashboard')
```

---

## Flow 4 — Approver declines

**Layman first:** approver rejects it with a mandatory reason; the request is closed for good (no resubmit). Note: decline stamps **no date** — `Last_Action_By` is the *only* reason it later shows under "Actioned by you".

### Step 1 — Confirm + call (Frontend)
**File:** `ReviewDetail.html:342 → onDeclineSubmit()` → `runReviewAction(...)`
```
onDeclineSubmit → showConfirm({danger:true}) → runReviewAction('handleDecline', [id, remark], …, 'Declining…')
```

### Step 2 — Guard + decline (Server)
**File:** `WebApp.js:755 → handleDecline(requestId, remark)` — 🔒 `isCurrentApprover` (756–759) → `Approvals.js:161 → decline()` (761)

### Step 3 — The official state change (Server → Sheet)  ★
**File:** `Approvals.js:161 → decline(requestId, approverRemark)`
**Layman:** writes the remark to the current step's column, sets `Status = Declined`, stamps `Last_Action_By`. **No `AppN_Date`** (intentional).

### Step 4 — Emails (Email)
**File:** `Emails.js:279 → sendDeclineToApprover` (receipt) + `Emails.js:317 → sendDeclineToRequestor` (with reason)

**One-line flow summary**
```
ReviewDetail.onDeclineSubmit → runReviewAction
  → WebApp.handleDecline
      ├─ isCurrentApprover                              🔒 guard
      ├─ Approvals.decline                              ★ SHEET — Status=Declined, remark, Last_Action_By (no date)
      └─ sendDeclineToApprover + sendDeclineToRequestor
```

---

## Flow 5 — Approver returns it for fixes  ⭐ the heavy one

**Layman first:** the approver bounces the request back to the requestor. Before *anything* is changed, the server records **who returned it, when, why, and which approvers had already signed** — because the upcoming reset will wipe that. This "capture-before-clear" is the trickiest pattern in the codebase. The bookkeeping lives in `handleReturn`, *around* the low-level `returnRequest`.

### Step 1 — Confirm + call (Frontend)
**File:** `ReviewDetail.html:357 → onReturnSubmit()` → `runReviewAction('handleReturn', [id, remark], …, 'Returning…')`

### Step 2 — Server orchestrates the bookkeeping (Server)
**File:** `WebApp.js:817 → handleReturn(requestId, remark)`

| Sub-step | Lines | Layman |
|---|---|---|
| Read pre-mutation state | 818–830 | grab `step`, `group`, `approvers`, and the returner's email **first**, while `Step` still points at the returner |
| **🔒 Authorize (before any write)** | 834–836 | not the current approver → `Unauthorized`. Placed before any `setValue` so an outsider can't mutate history |
| Build the `[PENDING]` entry | 838–843 | a history line: who, when, why |
| **✎ Snapshot prior approvals → AH** | 848–858 | for each filled `AppN_Date`, push `{step,email,date}`; write JSON to `Previous_Approvals` (col 34). This is *why* the chain can notify them later |
| **✎ Write history (one `[PENDING]`)** | 860–879 | append to `Resubmit_History` (col 33); if a `[PENDING]` already exists, **replace** it — never stack two |
| **★ Return + notify** | 881–887 | `returnRequest()` flips the state; then 3 emails |

### Step 3 — The official state change (Server → Sheet)  ★
**File:** `Approvals.js:227 → returnRequest(requestId, approverRemark)`
**Layman:** writes the remark, sets `Step = 0` and `Status = Returned to Requestor`, stamps `Last_Action_By`.

### Step 4 — Emails (Email)
**File:** `Emails.js:447 → sendReturnToRequestor` (with reason + which approver) · `Emails.js:490 → sendReturnConfirmToApprover` (receipt) · `Emails.js:632 → sendReturnedChainNotification` (alerts the prior approvers captured in Step 2)

**One-line flow summary**
```
ReviewDetail.onReturnSubmit → runReviewAction
  → WebApp.handleReturn
      ├─ read row + returner identity                  (BEFORE any write)
      ├─ isCurrentApprover                             🔒 guard (before write)
      ├─ ✎ Previous_Approvals (AH)                     snapshot of who'd already approved
      ├─ ✎ Resubmit_History (AG)                       single [PENDING] entry
      ├─ Approvals.returnRequest                       ★ SHEET — Step=0, Status=Returned, Last_Action_By
      └─ sendReturnToRequestor + sendReturnConfirmToApprover + sendReturnedChainNotification
```

---

## Flow 6 — Requestor resubmits

**Layman first:** the requestor fixes a returned request and resends; the chain restarts from Approver 1. Same "capture-before-clear" idea: grab the old return reason + count *before* `resubmit()` wipes the columns.

### Step 1 — Confirm + call (Frontend)
**File:** `RequestDetail.html:493 → onResubmitClick(requestId)`
```
onResubmitClick → showConfirm → showLoading('Resubmitting…') → callServer('handleResubmit', id)
```

### Step 2 — Server orchestrates (Server)
**File:** `WebApp.js:925 → handleResubmit(requestId)`

| Sub-step | Lines | Layman |
|---|---|---|
| **🔒 Authorize** | 926–932 | must be the **owner** AND status must be `Returned to Requestor` |
| Capture reason + count | 935–936 | read old return reason (remark cols) + `count+1` **before** clearing |
| **★ Resubmit + notify** | 938–946 | `resubmit()` resets state; confirm email; if it lands on Approver 1, a dedicated resubmit email |

### Step 3 — The official state change (Server → Sheet)  ★
**File:** `Approvals.js:299 → resubmit(requestId)`
**Layman:** bumps `Resubmit_Count`, promotes the `[PENDING]` history line to `Resubmit #N`, **clears** `AppN_Date` + `AppN_Remark` + `Previous_Approvals`, sets `Step = 1`, `Status = Pending Approver 1`.

### Step 4 — Emails (Email)
**File:** `Emails.js:681 → sendResubmitConfirmToRequestor` + `Emails.js:730 → sendResubmitApprovalRequest` (Approver 1, with the old reason)

**One-line flow summary**
```
RequestDetail.onResubmitClick → showConfirm
  → WebApp.handleResubmit
      ├─ owner? + Returned?                            🔒 guard
      ├─ capture old reason + count                    (BEFORE clearing)
      ├─ Approvals.resubmit                            ★ SHEET — Step=1, Status=Pending Approver 1, history promoted, dates cleared
      └─ sendResubmitConfirmToRequestor + sendResubmitApprovalRequest
  ⟲ navigateTo('request', {id})  (refresh)
```

---

## Flow 7 — Opening a request straight from an email link

**Layman first:** clicking the link in a notification email lands you on that exact request. No data changes.

### Step 1 — The link (Email)
**File:** `Emails.js:121 → getPortalUrl(requestId, page)` — built into every email body
```
…/exec?page=review&id=REQ-9b1     (page = 'review' for approvers, 'request' for requestors)
```

### Step 2 — Server reads the params (Server)
**File:** `WebApp.js:115 → doGet(e)` → injects `initialPage`/`initialId` → `Index.html:76` emits `__INITIAL_ROUTE`

### Step 3 — Router honors the deep-link (Frontend)
**File:** `JavaScript.html:609 → bootstrap()`
**Layman:** after identity resolves, the deep-link **wins** over hash/home → opens the exact request.
```
bootstrap → if (__INITIAL_ROUTE.page && .id) → navigateTo(page, {id})
```

> **Why query params, not `#hash`:** the app runs in a sandboxed iframe that **can't read the outer URL's hash** — but `?query` params reach `doGet` server-side. That's the whole reason deep-links use `?page=&id=`.

**One-line flow summary**
```
Emails.getPortalUrl (in email)  →  WebApp.doGet  →  Index.__INITIAL_ROUTE
  → JavaScript.bootstrap → navigateTo(page, {id})   (deep-link wins over hash/home)
```

---

## Flow 8 — Requestor views their own request (read + permission)

**Layman first:** clicking a row shows full details — but the server checks you're allowed *before* returning anything.

### Step 1 — Open the detail page (Frontend)
**File:** row `onclick` → `JavaScript.html:430 → navigateTo('request', {id})` → `RequestDetail.html:424 → renderRequestDetailPage(params)` → `callServer('getRequestDetail', id)`

### Step 2 — Server authorizes + builds the DTO (Server)  🔒
**File:** `WebApp.js:497 → getRequestDetail(requestId)`
**Layman:** if you're **neither** the requestor **nor** a chain approver → returns **`null`**. Otherwise builds the full detail object (dates formatted, `Previous_Approvals` parsed, attachments joined).
```
getRequestDetail → (requestor OR isChainApprover) ? rich DTO : null
```

### Step 3 — Render (Frontend)
**Layman:** the renderer treats `null` as "not found / no access" → empty state.

> **Contract:** `null` means BOTH "not found" AND "unauthorized" — same blank state, on purpose. Don't change it to an error object; the renderer relies on it.

**One-line flow summary**
```
row click → navigateTo('request', {id}) → RequestDetail.renderRequestDetailPage
  → WebApp.getRequestDetail        🔒 requestor OR chain approver, else → null
  ⟲ render detail  (null → "no access" empty state)
```

---

## Flow 9 — ⛔ DELETED: the `onSheetChange` background trigger

> ⛔ **This flow no longer exists.** The entire `onSheetChange` trigger family
> (`handleCertificateRequestChange`, `handleAttachmentChange`, and the `registerTrigger()`
> registrar) was **deleted from the codebase**. Nothing here describes running code.
>
> The section is kept as a tombstone because the deletion is worth understanding, and because a
> stale trigger registration may still exist on an old Google account.

**What it was.** An installable trigger that fired on any spreadsheet edit and, watching the
`Status` column, sent workflow emails: a direct port of AppSheet's old "bots". It ran *in
parallel* to the `handle*` web-app functions, which already send those same emails.

**Why it was deleted.** Three reasons, in order of severity:

1. **It held a complete second implementation of the notification system.** It was one trigger
   registration away from double-sending every workflow email.
2. **Identity was wrong by construction.** Inside an installable trigger,
   `Session.getActiveUser()` resolves to the *trigger owner*, not the person who acted. Every
   receipt it sent would have named the wrong actor.
3. **It was dormant anyway.** Its registrar was disabled, so it was dead weight carrying live
   risk.

**What replaced it.** Nothing, deliberately. The `handle*` functions run in the web-app session,
so they know who acted; that has always been the authoritative path. Raw manual sheet edits no
longer send email at all, which is correct: a hand-edited cell is not a workflow action and
should not notify anyone.

> 🛠 **If you find an `onSheetChange` trigger on any account, delete it.** It points at a function
> that no longer exists, so it fails on every spreadsheet edit and generates failure emails.
> Recover the original code from git history (commit `06de263` and earlier) if it is ever needed.

---

## 3 patterns that repeat everywhere
Once you see these, every flow reads the same way:

1. **Guard before write.** Every sensitive server action checks identity (`Session` + `WebApp.js:213 sameEmail`) *before* touching the Sheet. The frontend only hides buttons; the **server** is what enforces it. (Flows 3–6, 8.)
2. **Capture before clear.** Return (5) and resubmit (6) record history/snapshots *before* the low-level action wipes the old state. Order is load-bearing.
3. **`Activity_Log` is the source of truth (★).** Every official change is an `appendAction_` to the append-only timeline, followed by `setRequestCache_` to update the denormalized status/step on the request row. The `Requests` columns are a read-cache for fast list views, not the record. Emails and dashboards derive from the timeline via `getApprovalView_`. There is now exactly **one** path that reacts to a state change: the `handle*` functions in the web-app session (see the Flow 9 tombstone above).

---

*Living doc — add a flow here whenever a new operation ships. See `docs/manual/` for the full manual, `reference/ROADMAP.md` for build status, and `backend/Constants.js` for the authoritative column maps.*

> ⚠️ **Accuracy note (14 Aug 2026).** This document predates the database normalization and the
> August feature batch. Flow 9 is a tombstone; the remaining flows are structurally correct but
> may cite stale line numbers, and they do not cover return flags, editable resubmit, the Admin
> console, or the `Locations` sheet. **`docs/manual/part-0-common.md` wins** wherever this file
> disagrees with it.
