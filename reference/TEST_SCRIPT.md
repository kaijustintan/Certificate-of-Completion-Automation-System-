# Consolidated Test Pass — everything untested as of 2026-08-13

**Why this file exists.** Five layers of change are stacked and **none has ever executed**:

| Layer | What |
|---|---|
| `b8869de` | Script Properties config resolver, domain allowlist, expiry-sweep performance |
| `bf20b31` | Callable-surface security sweep (118 → 31 functions, ~90 renames) |
| `06de263` | `isAdmin` regression fix, mandatory decline reasons, upload magic-byte validation, group-lookup cache, **certificate rebuilt in code** |
| timeline commit | Cross-cycle approval timeline, domain allowlist tightened |
| final audit batch | **Return flags + editable resubmit** (new `Request_Flags` sheet), dead-code removal (callable surface 31 → **27**), submit/resubmit locks, formula-injection rejection, admin input caps, isAdmin/attachments memos, TextFinder row lookup, empty states, table consolidation |

`GO_LIVE_RUNBOOK.md` lists the older items 1-35 in the order they were *written*, not the order to *run* them. This file is the execution order for a single sitting. **Phase 8 (new, below) covers the final audit batch.**

**Time:** about 2 hours. **Account:** your `@dlsu.edu.ph` account only. You will act as requestor AND approver, which is supported (there is no requestor-≠-approver guard, and `EMAIL_DEV_TAG` exists specifically for this).

> ⚠️ **A personal gmail account will NOT work anymore.** `ORG.ALLOWED_DOMAINS` is now `["megaworldcorp.com", "dlsu.edu.ph"]`. If you need a second tester, they must be on one of those domains, or add their domain to that array as an **uncommitted local edit** and remove it after.

---

## Phase 0 — Does it even load (5 min)

A script-load failure breaks everything, so this comes first and costs nothing.

1. **Refresh the Apps Script editor tab.** If you had it open during `clasp push`, it is showing stale code. Never Ctrl+S in a stale tab.
2. **Run `_testConfig`.** Expect a re-authorization prompt (the `documents` OAuth scope was dropped when the certificate was rewritten). Accept it. This is expected, not a fault.
3. Read the log. It must show:
   - `ARCHIVE_FOLDER_ID` and `ATTACHMENTS_FOLDER_ID` tagged `[fallback(Constants.js)]`
   - **No `TEMPLATE_DOC_ID` line at all** (it was removed with the Doc engine)
   - `EMAIL_DEV_TAG = true`
   - `ORG.ALLOWED_DOMAINS = ["megaworldcorp.com","dlsu.edu.ph"]` → `domain gate ACTIVE`
   - `⚠️ TEMPORARY DOMAIN EXCEPTION STILL ACTIVE: ["dlsu.edu.ph"]` with removal instructions
   - `fail-loud OK → Script property NO_SUCH_KEY_SMOKE_TEST is not set…`

> **If this throws instead of logging**, stop. Something fails at file-load time and nothing else is testable. The likely suspects are `Constants.js` (loads first) or a syntax issue the parser accepted but Apps Script did not.

---

## Phase 1 — Sign in and access (5 min)

4. Open `/dev` and **hard-refresh: Ctrl+Shift+R**. A normal refresh serves cached HTML.
5. You sign in and reach a dashboard. *(Proves the domain gate admits `dlsu.edu.ph`.)*
6. **The Admin link appears in the sidebar.** *(This is the `isAdmin` regression fix. Requires your email in the `Admins` sheet with `ACTIVE=TRUE`.)*

> **If the Admin link is missing**, check the `Admins` sheet first. If your email is there and active, the DTO key fix did not take, and nothing in Phase 6 is testable.

---

## Phase 2 — Build the golden request (25 min)

**One request exercises almost everything.** Build it carefully; every later phase reads from it.

**Setup:** in Admin → View Groups, ensure a group has a chain of **exactly 1 approver: you**. Save it.

7. **New Request.** Fill the form. At the file picker:
   - a. Try attaching a `.txt` or `.zip` → **skipped with a red toast.** *(Client-side extension check.)*
   - b. **Rename a `.txt` file to `PO.pdf` and attach it.** The picker accepts it. Submit → **rejected server-side: "PO.pdf does not appear to be a valid PDF file."** ⚠️ **This is the real upload control.** If (a) passes but (b) does not, the validation is worthless.
   - c. Attach a genuine PDF and a genuine `.png`, give each a description, submit → succeeds.
8. **Check your inbox.** An approval-request email arrives with a `[FOR APPROVER]` prefix and a **Request History** section showing `Original submission → Submitted`.
9. **Open the request as approver** (My Approvals) → **Return** it.
   - Empty reason → Confirm button stays **disabled**.
   - Type 9 characters → still disabled, counter reads `9 / 20 characters minimum`.
   - Type a real 20+ character reason → enables. Confirm.
   *(This is the mandatory-reason fix.)*
10. **As requestor**, open the request. The amber returned-for-revision banner shows your reason. Resubmit, attaching **one new PDF**.
11. **Return it again** with a different 20+ char reason.
12. **Resubmit again** with another new PDF.
13. **Approve it.** It becomes Fully Approved.

You now have a request with **3 cycles**: submitted → returned → resubmitted → returned → resubmitted → approved.

---

## Phase 3 — The timeline (10 min)

14. **Requestor view.** Open the request. The **Request History** card lists **every** action in order, grouped `Original submission` / `Resubmit #1` / `Resubmit #2`, each with actor, timestamp, and both return reasons. ⚠️ **The approval must be visible** — a requestor could never see approvals before this change.
15. **Approver view.** Open the same request from My Approvals (or the review deep-link). The Request History card is **identical**. This symmetry is the entire point of the feature.
16. **Attachment grouping.** The attachments card splits into **Current submission** vs **Previous versions**, sub-labelled Original / Resubmit #1 / Resubmit #2.
17. **Resubmit banner still works.** The amber banner and its collapsible previous-return history render as before. *(Its `[PENDING]` parser was deliberately left untouched.)*
18. **A clean request.** Open any older request that was never returned → timeline shows `Submitted` plus approvals under one `Original submission` heading, no `Resubmit` groups.
19. **Cache invalidation.** Approve any other pending request and **immediately** open its detail page. The new approval appears. *(Proves `appendAction_` invalidates the `Activity_Log` memo inside the same execution. A missing entry here means the invalidation was dropped.)*
20. **Mobile.** Narrow the browser to phone width. The timeline wraps; the page does **not** scroll sideways.

---

## Phase 4 — The certificate (10 min) ⚠️ biggest unknown

The engine was rewritten from a Google Doc template to code. Google's HTML-to-PDF converter is more primitive than a browser, so fidelity is genuinely unverified.

21. **Editor: `_testGenerateCOC`.** Set `TEST_REQUEST_ID` to your golden request's ID, Run, open the logged PDF URL.
    - Header, title, meta strip (group / control no / date of filing)
    - All 7 request fields, then the item specification block
    - Remarks
    - **Exactly ONE signatory block pair** (Prepared By + your single approver). ⚠️ **No empty signature boxes** — that was the point of dropping the positional table logic.
    - Footer with control number
22. **Check the requestor email from step 13.** The COC PDF is **attached**, and there is exactly **one** new row in the `COC_PDFs` sheet.
23. **Multi-approver signatory layout** *(optional, needs a 2nd allowed-domain account)*: set a 2-3 approver chain, run a request through, confirm the signatory row splits evenly with no dead gap.

> **If the layout is wrong**, iterate on `buildCertificateHtml_()` in `Certificate.js`. There is no template file to touch anymore.

---

## Phase 5 — Security (10 min)

24. **Browser console on `/dev`, signed in.** Each must fail with **"is not a function"**:
```
google.script.run.setRequestCache("REQ-anything", {status:"Fully Approved"})
google.script.run.getAllData("Admins")
google.script.run.sendBrandedEmail("you@example.com","x","y","z")
google.script.run.appendAction("REQ-x","G001",0,1,"boss@corp.com","approved","")
google.script.run.uploadAttachmentFile({base64:"",filename:"x",mimeType:"text/plain"},"x")
```
25. **`isOwnerContext_` works both ways.** In the console, `google.script.run.checkPendingApprovals()` does nothing (logs "refused"). The **same function from the editor** runs normally.
26. **Field validation.** Submit with a >200-char project title → rejected. Submit with contract end **before** contract start → rejected.

---

## Phase 6 — Admin console (10 min)

27. **View Records** loads all requests; search, status filter, and sort work.
28. **Create** a group, **rename** it, **deactivate** and reactivate it.
29. **Chain edit.** Open a group with 2+ approvers, **reorder** it, Save. ⚠️ **The editor must redraw showing the NEW order immediately.** A stale order means an `invalidateGroupCaches_()` call was missed.
30. **`Admins_Log`** has a row for every action above, with a before→after diff on the chain change.
31. **Shrink guard.** With a request pending at step 2, try to save a 1-approver chain → **rejected**, and the error names the blocking control number.

---

## Phase 7 — Scheduled jobs (10 min)

32. **`checkPendingApprovals()` from the editor.** ⚠️ **Digest emails must NOT contain a full timeline.** Each request keeps a compact "Approval Progress" block. A timeline per request is the regression to watch for.
33. **⚠️ HIGHEST-VALUE TEST — expiry actions must not leak.** On your golden (now Fully Approved) request, set `CONTRACT_END` in the sheet to **today + 2**, then run `checkContractExpiries()` from the editor. Exactly **1** email sends and one `expiry_warning` row appears in `Activity_Log`.
    **Now open that request's detail page.** ⚠️ **No `expiry_warning` entry and no `system` actor may appear anywhere in the timeline.** Check the emails too.
    *(If one appears, the explicit allowlist in `getApprovalView_` was broken. This is the single most important assertion in this pass.)*
34. **Idempotency.** Run `checkContractExpiries()` again → **0 emails**, no new row.
35. **Expiry email has no history section** (deliberately excluded, it is a renewal nudge not an approval-state email).
36. **Duplicate-ID test.** Duplicate a `Requests` row so two rows share one `request_id`, both with `CONTRACT_END` = today+2, delete their `expiry_warning` rows, run once → **1 email, not 2** (log reads `1 warning(s)`). **Delete the duplicate row and restore the dates afterwards.**

---

## Phase 8 — Return flags + editable resubmit + audit fixes (25 min) — NEW

The final audit batch. Needs a request you can return (reuse a fresh one, or run this as part of Phase 2 on the golden request's second cycle).

37. **Flag picker.** As approver, open Return on a pending request. Under the reason textarea, expand **"Flag specific items (optional)"**:
    - Check `Contract end date` → a comment box appears; Confirm stays **disabled** until BOTH the 20-char reason AND the flag comment are filled.
    - Check one attachment too (grouped Current/Previous like the attachments card). Comment both, confirm.
38. **`Request_Flags` tab auto-created** with headers `flag_id | request_id | cycle | target_type | target_key | comment | flagged_by | flagged_at | resolved_cycle` and one row per flag. *(Self-healing — you never created this tab.)*
39. **Requestor view.** Open the returned request:
    - A **"What needs fixing"** card lists both flags with comments.
    - The flagged field row in the summary cards is amber-highlighted with the comment pinned under it.
    - The **return email** has a "Flagged items to fix" section (text + HTML).
40. **Full edit form.** The resubmit panel is now a complete prefilled form:
    - Every field editable EXCEPT **Approver group** (read-only with a note).
    - Dates prefilled correctly; flagged fields amber-marked in the form.
    - A free-text location (not one of the 4 options) prefills via **Other** — it must NOT be blanked.
    - Change the flagged date + one unflagged field, add a file, resubmit.
41. **After resubmit:**
    - Sheet: the `Requests` row shows the new values; `Request_Flags` rows have `resolved_cycle` stamped.
    - Timeline (both views): the Resubmitted entry carries **"Changed: Contract end date, …"**.
    - Approver 1's resubmission email has a **"What changed"** line.
    - Re-review page shows **"Flagged last cycle — marked as fixed"**.
42. **Adversarial console** (each must be REJECTED with a clear error, no state change):
```
google.script.run.withSuccessHandler(console.log).handleReturn("REQ-x","A perfectly valid reason here",[{targetType:'field',targetKey:'group',comment:'x'}])
google.script.run.withSuccessHandler(console.log).handleResubmit("REQ-x",[],{group:"G002"})
google.script.run.withSuccessHandler(console.log).handleResubmit("REQ-x",[],{projectTitle:"=IMPORTRANGE(\"x\",\"A1\")"})
```
43. **Formula rejection everywhere:** submit a new request with project title `=1+1` → rejected naming the field. Same for a file description, a decline reason, an admin group name, and a chain designation.
44. **Admin caps:** an 81-char group name and a 201-char designation are rejected server-side (bypass the UI maxlength via console if needed).
45. **Locks:** double-click Resubmit rapidly → exactly ONE cycle bump. Two overlapping submits (two tabs) → attachment rows do not interleave/overwrite (check `Request_Attachments` row integrity).
46. **Empty states:** deactivate every group → New Request shows "No approver groups available" instead of a dead form (reactivate after). A chain-less group's detail page shows the "No approver chain is configured" card in the rail, not a blank space.
47. **Consolidated tables:** My Approvals and Admin records tables render identically (they now share one renderer); row clicks go to review vs read-only detail respectively.
48. **Plain return/resubmit regression:** one return with NO flags + resubmit with NO field edits and NO files → behaves exactly as before (no flags card, RESUBMITTED remark blank, email unchanged).
49. **Callable surface:** `node tools/callable-surface.js` prints exactly **27**. In the console, `google.script.run.onSheetChange` and `google.script.run.checkAttachmentSync_` are both **undefined** (deleted).

## If something breaks

| Symptom | Look at |
|---|---|
| Nothing loads / editor throws on any Run | File-load failure, start with `Constants.js` |
| A legitimate call is rejected | `isOwnerContext_()`, not a missing function. Every name was confirmed to resolve. |
| Admin link missing | `Admins` sheet first, then the `isAdmin` DTO key |
| Stale group name, or a chain edit that does not show | A missed `invalidateGroupCaches_()` |
| A new action missing from a timeline | A missed `invalidateActivityCache_()` in `appendAction_` |
| `expiry_*` visible in a timeline | The workflow-action allowlist in `getApprovalView_` |
| Certificate looks wrong | `buildCertificateHtml_()`. Not data — log `html.length` or write the HTML to Drive to inspect. |
| Emails not arriving | Gmail quota. `sendBrandedEmail_` fails **soft**, so check Executions logs, not the UI. |
| Flags not showing / not resolving | `Request_Flags` tab + `flagRows_()`/`resolveOpenFlags_` (Accessors.js). Note the DTO self-heals: an old-cycle flag renders resolved even if the stamp was missed. |
| Edit form saves nothing | `validateResubmitPayload_` (WebApp.js) then the diff in `resubmit_` (Approvals.js) — log `changedLabels`. A value identical after trim/date-formatting is correctly a no-op. |
| "System is busy" on submit/resubmit | Lock contention (10s wait). Expected under real concurrency; retry. If persistent, something is holding the script lock — check Executions. |

## Not covered here (deliberate)

Production config flips (`EMAIL_DEV_TAG`, prod folder IDs, removing `dlsu.edu.ph`) belong to go-live, not this pass. See `GO_LIVE_RUNBOOK.md` Phase D.
