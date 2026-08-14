# Consolidated Test Pass

**Last updated:** 2026-08-14 · **Phase 0 status: ✅ PASSED** (see below)

**Why this file exists.** Six layers of change are stacked and **none had ever executed** before this pass:

| Layer | What |
|---|---|
| `b8869de` | Script Properties config resolver, domain allowlist, expiry-sweep performance |
| `bf20b31` | Callable-surface security sweep (118 → 31 functions, ~90 renames) |
| `06de263` | `isAdmin` regression fix, mandatory decline reasons, upload magic-byte validation, group-lookup cache, **certificate rebuilt in code** |
| `6b0f9dc` + `c2361aa` | Cross-cycle approval timeline, domain allowlist tightened |
| `5a70bca` + `3605608` | **Return flags + editable resubmit** (new `Request_Flags` sheet), dead-code removal (callable surface 31 → **27**), submit/resubmit locks, formula-injection rejection, admin input caps, isAdmin/attachments memos, TextFinder row lookup, empty states, table consolidation |
| *pending commit — supervisor feedback batch (7 commits)* | **Locations sheet** (configurable dropdown, replaces the hardcoded 4), field help tooltips, consolidated resubmit page (edit form IS the page, prior docs shown inline with flag highlights), flag attribution ("Flagged by Approver N"), optional approve comment, compact single-entry history, cadenced approver reminders (7 days, then every 3), standardized back-links. Callable surface stays **27** — `getApproverGroups` was folded into the new `getNewRequestOptions` (same count, different name) |

`GO_LIVE_RUNBOOK.md` lists the older items in the order they were *written*, not the order to *run* them. This file is the execution order for a single sitting.

**Time:** about 2.5 hours for Phases 1-8 (the extra 30 min is the new Locations/hints/cadence/attribution checks folded into the existing phases). **Account:** your `@dlsu.edu.ph` account only. You act as requestor AND approver, which is supported (there is no requestor-≠-approver guard, and `EMAIL_DEV_TAG` exists specifically for this).

> ⚠️ **A personal gmail account will NOT work.** `ORG.ALLOWED_DOMAINS` is `["megaworldcorp.com", "dlsu.edu.ph"]`. A second tester must be on one of those domains, or add theirs as an **uncommitted local edit** and remove it after.

---

## 🚩 How to run this pass

**Do not look for crashes. Look for plausible wrong answers.**

Every defect that actually hurt a comparable system produced **no error message**: an escaper that escaped nothing, a tab that always read zero, corrections formally requested and never delivered, a test that printed "19 passed, 0 failed" against a broken database. Each returned something that looked correct.

So at every step, the question is not "did it error?" but **"is this answer actually right?"** The steps marked ⚠️ are the ones where a wrong answer looks most normal.

Expect breakage. Five unserved layers means something will fail; that is the point of running this, not a sign anything went wrong.

---

## Phase 0 — Does it even load ✅ PASSED 2026-08-14

*Kept for the record and for re-running after any future push.*

1. **Refresh the Apps Script editor tab.** If it was open during `clasp push` it shows stale code. Never Ctrl+S in a stale tab.
2. **Run `_testConfig`.** A re-authorization prompt is expected (the `documents` OAuth scope was dropped when the certificate was rewritten). Accept it.
3. The log must show:
   - `ARCHIVE_FOLDER_ID` and `ATTACHMENTS_FOLDER_ID` tagged `[fallback(Constants.js)]`
   - **No `TEMPLATE_DOC_ID` line at all** (removed with the Doc engine)
   - `EMAIL_DEV_TAG = true`
   - `ORG.ALLOWED_DOMAINS = ["megaworldcorp.com","dlsu.edu.ph"]` → `domain gate ACTIVE`
   - `⚠️ TEMPORARY DOMAIN EXCEPTION STILL ACTIVE: ["dlsu.edu.ph"]`
   - `fail-loud OK → Script property NO_SUCH_KEY_SMOKE_TEST is not set…`

**Result 2026-08-14:** all seven assertions passed. Script Properties are intentionally empty; the fallbacks in `Constants.js` are the correct dev state.

> ⚠️ **Known trap, hit once and fixed.** `.clasp.json` has `"rootDir": "."` and `scriptExtensions: [".js"]`, so **clasp pushes every `.js` in the repo**, including Node tooling. `tools/callable-surface.js` uses `require()`, which does not exist in Apps Script, so it threw at load time and took the **whole project down** before any code ran. Fixed by `.claspignore`. If Phase 0 ever throws again, check the Apps Script file list for a stray `tools/*.gs` first.

> **If this throws instead of logging**, stop. Nothing else is testable. Suspects: a stray pushed file (above), `Constants.js` (loads first), or a syntax issue the parser accepted but Apps Script did not.

---

## Before Phase 1 — redeploy

`clasp push` only updates `/dev`. Email deep-links use `ScriptApp.getService().getUrl()`, which returns the **published** `/exec` URL. Testing before republishing means chasing ghosts.

**Deploy → Manage deployments → edit the existing deployment → New version → Deploy.**

> ⚠️ **Never create a *new* deployment.** That mints a new URL and silently orphans every link in every email already sent. One deployment per app, always "New version."

---

## Phase 1 — Sign in and access (5 min)

4. Open `/dev` and **hard-refresh: Ctrl+Shift+R**. A normal refresh serves cached HTML.
5. You sign in and reach a dashboard. *(Proves the domain gate admits `dlsu.edu.ph`.)*
6. **The Admin link appears in the sidebar.** *(This is the `isAdmin` regression fix. Requires your email in the `Admins` sheet with `ACTIVE=TRUE`.)*
6b. **Back-links.** Every detail/form page (New Request, request detail, review detail) shows a top-left "← Back to …" line above the title, not a button in the header. Click it from a normal request → lands on your dashboard.

> **If the Admin link is missing**, check the `Admins` sheet first. If your email is there and active, the DTO key fix did not take, and nothing in Phase 6 is testable.

---

## Phase 2 — Build the golden request (25 min)

**One request exercises almost everything.** Build it carefully; every later phase reads from it.

**Setup:** in Admin → View Groups, ensure a group has a chain of **exactly 1 approver: you**. Save it.

6c. **Locations sheet.** Open the spreadsheet — a `Locations` tab must exist (self-healed on the first New Request render this session) with headers `name | active` and 4 seeded rows (`AGT - Pending`, `GCP - Pending`, `EGP - Pending`, `TWS - Pending`). Add a 5th row, e.g. `MKT - Pending`, `active=TRUE`. Reopen New Request → the new option appears in the Location dropdown, still followed by `Other`. Set one existing row's `active` to `FALSE`, reopen the form → that option is gone from the dropdown (but any request already using it is untouched — the string is stored on the row, not a reference).
6d. **Field hints.** On the New Request form, every labeled field shows a small "?" next to its label. Hover one (e.g. PC name) → a tooltip explains what to enter. Tab to a hint with the keyboard and confirm it also shows on focus (not just hover).

7. **New Request.** Fill the form. At the file picker:
   - a. Try attaching a `.txt` or `.zip` → **skipped with a red toast.** *(Client-side extension check.)*
   - b. **Rename a `.txt` file to `PO.pdf` and attach it.** The picker accepts it. Submit → **rejected server-side: "PO.pdf does not appear to be a valid PDF file."** ⚠️ **This is the real upload control.** If (a) passes but (b) does not, the validation is worthless.
   - c. Attach a genuine PDF and a genuine `.png`, give each a description, submit → succeeds.
8. **Check your inbox.** An approval-request email arrives with a `[FOR APPROVER]` prefix, a **Purpose** line in the info block, and the compact one-line Request History (`Submitted by you · date` — no "Original submission" header yet, see 18).
9. **Open the request as approver** (My Approvals) → **Return** it.
   - Empty reason → Confirm button stays **disabled**.
   - Type 9 characters → still disabled, counter reads `9 / 20 characters minimum`.
   - Type a real 20+ character reason → enables. Confirm.
   *(This is the mandatory-reason fix.)*
10. **As requestor**, open the request. The amber returned-for-revision banner shows your reason. Resubmit, attaching **one new PDF**.
11. **Return it again** with a different 20+ char reason.
12. **Resubmit again** with another new PDF.
13. **Approve it.** Clicking "Approve" opens an **approve panel** (not an immediate confirm dialog) with the final-signatory note and an OPTIONAL comment textarea. Leave it blank and click "Confirm approve" → the request becomes Fully Approved. *(Comment is optional — confirm must never be disabled.)*

You now have a request with **3 cycles**: submitted → returned → resubmitted → returned → resubmitted → approved.

---

## Phase 3 — The timeline (10 min)

14. **Requestor view.** Open the request. The **Request History** card lists **every** action in order, grouped `Original submission` / `Resubmit #1` / `Resubmit #2`, each with actor, timestamp, and both return reasons. ⚠️ **The approval must be visible** — a requestor could never see approvals before this change.
15. **Approver view.** Open the same request from My Approvals (or the review deep-link). The Request History card is **identical**. This symmetry is the entire point of the feature.
16. **Attachment grouping.** The attachments card splits into **Current submission** vs **Previous versions**, sub-labelled Original / Resubmit #1 / Resubmit #2.

16b. ### ⚠️ File display — genuinely unverified, and a wrong result looks normal

COC never sends a Drive link. `downloadAttachment` returns bytes, the browser builds a Blob, and PDFs/images are shown by navigating a **new tab** to a blob URL. The parallel DCS system found that Apps Script's sandbox **refuses to render blob URLs**, though they were embedding in an `<iframe>` inside the page, which is a different context from a top-level tab. Ours may work where theirs did not. Untested either way.

Press **View** on each type and check:

| File | Expected |
|---|---|
| PDF | new tab opens and **the document is actually visible** |
| PNG / JPG | same |
| DOCX / XLSX | tab closes, file **downloads** |
| Same PDF a second time | instant, no loading screen (blob cache hit) |
| With pop-ups blocked | toast "Allow pop-ups to preview inline; downloading instead", then downloads |

⚠️ **The failure mode is a blank or error tab, with no toast and no download.** The code has already taken its success branch by then, so nothing reports the problem. A blank tab here is a real failure, not a slow load.

**If PDFs render blank:** DCS's finding applies to us too. The options are (a) download everything instead of previewing, or (b) elevate that one file to domain-visible at view time and open it in the Drive viewer. Option (b) weakens the private-by-default design, so (a) is the safer default. Do not redesign before confirming the failure.
17. **Resubmit banner.** The amber banner shows ONLY the current pending return. ⚠️ **The old collapsible "Previous return history" block below it is gone** — every past return, its reason, and its resubmit already appear in the Request History timeline above, so there should be no second partial rendering of the same events. *(Its `[PENDING]` parser was deliberately left untouched — only the collapsible Block B was removed.)*
18. **A clean request.** Submit a brand-new request and immediately open its detail page. ⚠️ **Compaction rule:** with only the SUBMITTED action recorded, the Request History card renders compactly — "Submitted by you" on one line, the **timestamp on its own line below it** (muted) — with NO "Original submission" header and no timeline dot/card chrome. Check the same request's approval-request email (both plain-text and HTML): same two-line rendering, no section header. This must hold in all three renderers (portal, plain-text email, HTML email) — check at least two.
18b. **Cycle headers reappear correctly.** Return to your golden 3-cycle request from Phase 2 (or any multi-cycle request) → the timeline groups under `Original submission` / `Resubmit #1` / `Resubmit #2` headers as before. Headers only disappear on the single-entry case above.
19. **Cache invalidation.** Approve any other pending request and **immediately** open its detail page. The new approval appears. *(Proves `appendAction_` invalidates the `Activity_Log` memo inside the same execution. A missing entry here means the invalidation was dropped.)*
20. **Mobile.** Narrow the browser to phone width. The timeline wraps; the page does **not** scroll sideways. The field-help tooltip bubble (6d) also stays on-screen at this width — it should anchor left of the "?" icon, not spill off the right edge.

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
31b. **Admin back-nav.** From View Records, click any request row → opens the read-only detail page with a **"← Back to Admin records"** link top-left (not "← Back to dashboard"). Click it → returns to Admin **records**, not the two-tile landing.

---

## Phase 7 — Scheduled jobs (10 min)

32. **`checkPendingApprovals()` from the editor.** ⚠️ **Digest emails must NOT contain a full timeline.** Each request keeps a compact "Approval Progress" block. A timeline per request is the regression to watch for.
32b. **⚠️ Reminder cadence (7 days, then every 3) — the reminder is no longer daily.** Uses a pending request (any of your golden request's earlier cycles still pending works, or make a fresh one). In `Activity_Log`, find that request's most recent WORKFLOW row (submitted/approved/returned/resubmitted — not an `expiry_*` row) and edit its `TIMESTAMP` cell directly in the sheet:
    - Set it to **6 days ago** → run `checkPendingApprovals()` → the request must **NOT** appear in any digest (0 emails for it).
    - Set it to **7 days ago** → run again → **now due**, one digest email sends listing it.
    - Set it to **8 days ago** → run again → **NOT due** (7 then 10, not every day).
    - Set it to **10 days ago** → run again → **due** again.
    - Restore the original timestamp afterward.
    *(Math: due when `age >= 7` AND `(age - 7) % 3 === 0` — days 7, 10, 13, … `getLastWorkflowActionDateMap_` in `Accessors.js` computes age from the latest workflow action only; `expiry_*` rows must never reset it.)*
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
    - Check the return email (both formats): "Reason for Return" is a row alongside "Returned by" / "Return Date" (same caliber, not a standalone callout box) but **amber-tinted**, with the label in amber bold; the flagged-items list keeps its own full amber section below. The decline email's "Reason for Decline" gets the identical treatment in red.
38. **`Request_Flags` tab auto-created** with headers `flag_id | request_id | cycle | target_type | target_key | comment | flagged_by | flagged_at | resolved_cycle` and one row per flag. *(Self-healing — you never created this tab.)*
39. **Requestor view.** Open the returned request:
    - A **"What needs fixing"** card lists both flags with comments. ⚠️ **Each flag's meta line reads "Flagged by Approver N (email)"**, not just the bare email — N is the flagging approver's position at the time of the return.
    - The flagged field row in the summary cards is amber-highlighted with the comment pinned under it.
    - The flagged **attachment** row in the Attachments card is ALSO amber-highlighted with the comment pinned under the filename (this is new — it was previously invisible per-row).
    - The **return email** has a "Flagged items to fix" section (text + HTML).
40. **Full edit form.** ⚠️ **The resubmit page is now consolidated** — the read-only summary cards (Request information / Product / Contract / Purpose) are **NOT shown** while a resubmit is pending; the edit form IS the page:
    - Every field editable EXCEPT **Approver group** (read-only with a note).
    - Dates prefilled correctly; flagged fields amber-marked in the form.
    - A free-text location (not one of the sheet's options) prefills via **Other** — it must NOT be blanked.
    - The **Documents** section inside the form shows the request's EXISTING files first (the flagged attachment amber-highlighted with its comment), followed by an "Add corrected or missing documents" sub-heading and the file picker — not a separate empty picker with no context.
    - Change the flagged date + one unflagged field, add a file, resubmit.
41. **After resubmit:**
    - Sheet: the `Requests` row shows the new values; `Request_Flags` rows have `resolved_cycle` stamped.
    - Timeline (both views): the Resubmitted entry carries **"Changed: Contract end date, …"**.
    - Approver 1's resubmission email has a **"What changed"** line.
    - ⚠️ **No resolved-flags card at the top of the page.** Once every flag is resolved, that card is gone entirely. Instead, in **Request History**, the `Returned by Approver 1` entry carries a **"View details (N)"** button → clicking it blurs the page and opens a dialog listing that round's flagged items with their comments, each with a green check. Escape, the backdrop, and Close all dismiss it.
    - ⚠️ **The amber resubmit banner shows only the (now resolved) current state — no collapsible "Previous return history" block below it.** That history lives in the Request History timeline above.
42. **Adversarial console** (each must be REJECTED with a clear error, no state change):
```
google.script.run.withSuccessHandler(console.log).handleReturn("REQ-x","A perfectly valid reason here",[{targetType:'field',targetKey:'group',comment:'x'}])
google.script.run.withSuccessHandler(console.log).handleResubmit("REQ-x",[],{group:"G002"})
google.script.run.withSuccessHandler(console.log).handleApprove("REQ-x","=IMPORTRANGE(\"x\",\"A1\")")
google.script.run.withSuccessHandler(console.log).handleResubmit("REQ-x",[],{projectTitle:"=IMPORTRANGE(\"x\",\"A1\")"})
```
43. **Formula rejection everywhere:** submit a new request with project title `=1+1` → rejected naming the field. Same for a file description, a decline reason, an admin group name, a chain designation, and an approve comment (item 42's third console call).
44. **Admin caps:** an 81-char group name and a 201-char designation are rejected server-side (bypass the UI maxlength via console if needed).
45. **Locks:** double-click Resubmit rapidly → exactly ONE cycle bump. Two overlapping submits (two tabs) → attachment rows do not interleave/overwrite (check `Request_Attachments` row integrity).
46. **Empty states:** deactivate every group → New Request shows "No approver groups available" instead of a dead form (reactivate after). A chain-less group's detail page shows the "No approver chain is configured" card in the rail, not a blank space.
47. **Consolidated tables:** My Approvals and Admin records tables render identically (they now share one renderer); row clicks go to review vs read-only detail respectively.
48. **Plain return/resubmit regression:** one return with NO flags + resubmit with NO field edits and NO files → behaves exactly as before (no flags card, RESUBMITTED remark blank, email unchanged).
49. **Callable surface:** `node tools/callable-surface.js` prints exactly **27**. In the console, `google.script.run.onSheetChange` and `google.script.run.checkAttachmentSync_` are both **undefined** (deleted). ⚠️ **`google.script.run.getApproverGroups` is now ALSO undefined** — it was folded into `getNewRequestOptions()` (still 27 total; a rename, not an addition). Confirm `google.script.run.withSuccessHandler(console.log).getNewRequestOptions()` returns `{groups:[...], locations:[...]}`.

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
| Blank tab when viewing a PDF | Blob navigation blocked by the sandbox. See 16b — this is a design decision, not a bug fix. |
| Editor throws `require is not defined` | A Node file got pushed. Check `.claspignore` and delete any stray `tools/*.gs` in the Apps Script file list. |
| Reminder fires on the wrong day, or never | `getLastWorkflowActionDateMap_` (Accessors.js) — confirm it's reading `Activity_Log` timestamps as `Date` objects, and the cadence math (`REMINDER_FIRST_AFTER_DAYS` / `REMINDER_REPEAT_DAYS` in Triggers.js) against the sheet's actual timezone. |
| New location doesn't appear in the dropdown | `getLocations_()` memo (Accessors.js) — it's per-execution, so a stale value inside one Apps Script run means the sheet edit and the read happened in the same execution somehow; a normal page reload should always see it. Check `active` is not `FALSE`/blank-with-typo. |
| Flag attribution shows no "Approver N" | `returnStepByCycle` in `getRequestDetail` (WebApp.js) reads `step` off the cycle's RETURNED timeline row — confirm `appendAction_` was called with a non-null `step` on that return. |

## When the pass is done

1. Fix whatever it surfaced, re-running the affected phase after each fix.
2. Then go-live config (`GO_LIVE_RUNBOOK.md` Phase D): `EMAIL_DEV_TAG = false`, prod Drive folder IDs, remove `dlsu.edu.ph` from **both** `ORG.ALLOWED_DOMAINS` and `ORG.TRANSITIONAL_DOMAINS`, seed the sheets (including `Locations` if the production set of sites differs from the dev seed), and run the two trigger registrations **on the Megaworld account** (they are per-account and are not created by `clasp push`).

## Not covered here (deliberate)

- **Production config flips** belong to go-live, not this pass. See above.
- **Deferred backlog** (submission snapshot per round, error-envelope normalization, raising the remark floor from 20 to 30, deletable/replaceable attachments — deliberately kept append-only, see `FINAL_AUDIT_REPORT.md`) is in `FINAL_AUDIT_REPORT.md`. None of it blocks this pass, and none should be started until it is complete: adding unserved code to an unserved stack is what produced this backlog in the first place.
- **A 4th approver / lifting the 3-approver cap** was raised in supervisor feedback (DCS routes through 4) but is a real, unstarted change to `getApprovers_`, `approve_`, and `isChainApprover_` plus the certificate's signatory layout — explicitly out of scope for this batch.
