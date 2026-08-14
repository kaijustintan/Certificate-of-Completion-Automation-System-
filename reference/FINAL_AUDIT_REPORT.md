# Final Audit Report — Megaworld COC Portal

**Date:** 2026-08-13
**Scope:** full-repository audit (workflows, security, performance, scalability, UI/UX, code quality) plus the last requested feature: per-field/per-document flagging on return.
**Verification state:** every change passed static verification (`node --check` on all backend files, script-block parse of all frontend files, callable surface locked at exactly 27 via `tools/callable-surface.js`). ⚠️ **Nothing in this batch, or the four change layers under it, has ever executed against real Sheets/Drive/Gmail.** The consolidated execution order is `reference/TEST_SCRIPT.md` (Phase 8 covers this batch).

**LAYMAN (Tropang Ex):** Ito ang huling malaking pasada bago ang handover. Dalawang bagay ang ginawa: (1) yung pinaka-hinihinging feature na galing sa DCS, yung "markahan mo kung aling field o dokumento ang mali" pag nag-return ang approver, kasama na ang kakayahang i-EDIT ng requestor ang form pag nag-resubmit; at (2) inayos ang lahat ng nahanap ng audit: mga karerang pwedeng magsiraan ng data pag sabay-sabay ang gumagamit, isang klase ng injection attack sa Sheets, mga mabagal na pagbasa, patay na code na delikado pang maiwan, mga lumang komento na nagsisinungaling na, at mga kulang na empty state sa UI. Ang natitirang trabaho ay TESTING: wala pa sa mga ito ang tumakbo kahit isang beses.

---

## 1. Features Implemented

### 1.1 Per-field / per-document flagging on return (the requested feature)

**Layman:** Pag nag-return ang approver, pwede na niyang markahan ang mga SPECIFIC na field (hal. "Contract end date") o dokumento na may problema, may komento bawat isa. Makikita ng requestor ang mga marka: naka-highlight sa detail page, nakalista sa "What needs fixing" na card, at nasa email. Pag nag-resubmit, kumpleto nang edit form ang lalabas (lahat ng field pwedeng baguhin maliban sa approver group), at ang mga marka ay awtomatikong matatatakan ng "fixed". Makikita ng susunod na approver kung ANO mismo ang binago.

**Technical:**
- **Storage:** new 9th sheet `Request_Flags` (`FLG.*`, 9 cols), append-only except a single `resolved_cycle` stamp. Self-healing: `ensureRequestFlagsTab_()` creates it on the first flagged return; `flagRows_()` reads fail-soft to `[]`, so an un-migrated spreadsheet never breaks.
- **API:** zero new public callables. `handleReturn(requestId, remark, flags)` and `handleResubmit(requestId, newFiles, updatedFields)` gained optional 3rd args. `validateReturnFlags_` runs before any state change (invalid payload fails the whole action at zero cost); flags write after the return commits, fail-soft. `validateResubmitPayload_` reuses `validateRequestFields_` wholesale.
- **Single source of truth:** `FLAGGABLE_FIELDS` (`Constants.js`), 17 keys. `group` is in neither the flaggable nor the editable set: `Activity_Log` denormalizes `group_id` per action, so a mid-history group change would make the audit log contradict itself. Wrong group = decline and refile.
- **Resubmit edit:** field diff and batched write happen inside `resubmit_`'s existing script lock, before `appendAction_` (a write failure aborts cleanly; an Activity_Log row can never be un-written). Changed-field labels ride the RESUBMITTED action's remark ("Changed: Project title, ..."), so the portal timeline and both email logs show what was edited with no schema change.
- **Resolution self-heals:** the DTO computes `resolved` as `resolvedCycle set OR cycle < resubmitCount`, so a missed stamp degrades nothing visible.
- **Better than the DCS original in three ways:** flags survive as permanent history (nothing is deleted), attachment flags are validated to belong to the request (no cross-request reference), and labels are resolved server-side (a client can never spoof what was flagged).
- **Trade-off accepted:** the resubmit edit form duplicates the field markup of `NewRequest.html` rather than sharing a generator. A shared form builder would be a larger refactor with real regression risk on the most-used page in the system; deferred deliberately.

### 1.2 Audit-driven fixes (all implemented this batch)

| Area | What landed |
|---|---|
| Dead code | Deleted the dormant `onSheetChange` trigger family (including a complete parallel email sender that was a standing double-send hazard), `checkAttachmentSync_`, `deleteAttachment_`, `countAttachments_`, frontend `emotionFor`, and `backend/Code.js` (+ its `.clasp.json` entry). Callable surface: 31 → **27**. |
| Concurrency | Script lock on `submitNewRequest`'s sheet writes; `writeAttachmentRows_` moved inside `resubmit_`'s lock (closing the `getLastRow()+1` interleave race); lock on `updateGroupFields_`. |
| Performance | `isAdmin_` and `Request_Attachments` execution-memoized (with writer-side invalidation discipline documented); `getRowNumberByRequestId_` rewritten to `createTextFinder` (was a full-table scan called ~6x per approval). |
| Input hardening | Leading-`=` formula injection REJECTED at every free-text write path; server-side caps on admin group name (80), approver email (254), designation (200). |
| UX | Empty states for "no approver groups" (New Request) and "no approver chain" (detail rail); error toasts now surface both backend error shapes. |
| Code quality | The byte-identical Approver/Admin request tables and the triplicated sort/status/count builders consolidated into `UI.html`; the callable-surface checker is now committed at `tools/callable-surface.js`. |
| Copy bugs | Fixed user-facing text that leaked internal names from the old rename sweep ("resubmit_ your request", "(approve_, decline_, or return)") in three emails. |
| Docs-in-code | Every stale comment found by the sweep corrected (34/33-col claims, SYNCING/EXPECTED_ATTACHMENTS/Approver_Settings/PREVIOUS_APPROVALS mentions, "unlimited approvers", wrong sheet counts, the false "Activity_Log is not memoized" claim). |

---

## 2. Remaining Recommendations (assessed, deliberately NOT implemented)

Each of these was weighed and deferred with a reason, not forgotten.

1. **Emails.js sender consolidation** (15 near-identical send functions, ~30 near-duplicate body builds). Highest-churn refactor in the codebase for zero user-visible gain, on the subsystem that is hardest to test. Do it only after a full tested baseline exists.
2. **Error-shape normalization** (`{success:false, error}` vs `{success:false, message}`). The frontend now tolerates both at every toast site, which removes the user impact. Normalizing the backend shapes touches every callable's contract; do it in one dedicated pass, never piecemeal.
3. **Backend list-DTO projection consolidation** (4 copy-pasted projections). Touches three frozen dashboard DTOs at once; low payoff against regression risk before testing.
4. **Per-request lock granularity.** The single script lock serializes all mutations. At current volume (single organization, low tens of concurrent users) this is invisible; revisit only if lock-timeout errors actually appear in Executions logs.
5. **Approver chain beyond 3.** A real change to `getApprovers_`, `approve_`, and `isChainApprover_` plus the certificate signatory layout. Business has not asked for a 4th approver.
6. **Cache-drift reconciler** (`rebuildCacheFromTimeline()`): rebuild `Requests.status/step/resubmit_count` from `Activity_Log`. Worth building the first time a drift incident actually happens; the append-only log guarantees it is always possible.
7. **Automated test framework.** The pure helpers (validators, formatters, the timeline projection) are testable in Node with a small Apps Script mock layer, as `domaintest.js` proved. Highest-value candidate AFTER the manual pass establishes a baseline.
8. **Draft autosave, delegation/OOO, requestor cancel, Tier 3 admin (force-approve/reassign).** Product features, post-go-live by prior decision.
9. **Retiring `resubmitHistory`** in favour of the timeline. Requires rewriting the banner parser's frozen contract; the banner still serves the "action needed" role well.

---

## 3. Security Findings

**Layman:** Ang natitirang panganib ay hindi na mga butas sa code kundi mga configuration na kailangang i-flip sa go-live, at ang katotohanang hindi pa nate-test ang lahat.

**Fixed this batch:**
- **Formula injection (real, now closed).** `setValue`/`setValues` turn a leading `=` into a LIVE formula, so a request titled `=IMPORTRANGE(...)` could exfiltrate spreadsheet data to an attacker-controlled sheet the moment an admin opened the tab. Every free-text write path now rejects a leading `=` (lossless, unlike apostrophe-prefixing). `+`/`@` deliberately not blocked: they are typed-entry hazards only, and `+` legitimately starts phone numbers.
- **Unlocked write races** (submit, resubmit attachments, group rename) closed; see §4 of the profile addendum.
- **Admin input caps** closed the unbounded-cell writes reachable via console on `adminCreateGroup`/`adminRenameGroup`/`adminSaveChain`.
- **Parallel email sender deleted.** The dormant `handleCertificateRequestChange` was one accidental trigger registration away from double-sending every workflow email with wrong-identity receipts.
- **Flag payloads are fully server-validated:** allowlisted targets, per-request attachment ownership, comment caps, formula check, duplicate rejection, and server-resolved labels.

**Verified sound (no change needed):**
- XSS: every user-controlled value traced into an HTML sink goes through `escapeHtml`; the six JS-string-in-onclick sites interpolate only server-generated IDs. `renderEmptyState`'s raw-HTML `message` contract is documented and all callers comply.
- AuthZ: every mutator resolves identity from `Session`, guards before the first side effect, and the primitives re-guard inside their locks. `sameEmail_`'s non-blank rule holds everywhere.
- File handling: 3-layer upload gate (extension, MIME, magic bytes) with size floor/ceiling; private Drive files served only through identity-gated `downloadAttachment`.

**Open, by design or by go-live checklist:**
- `ORG.ALLOWED_DOMAINS` currently includes `dlsu.edu.ph` (the documented temporary exception) and **fails open when emptied**. Go-live: set to `["megaworldcorp.com"]` only.
- OAuth scopes are full `drive` + `mail.google.com`. Narrowing to `drive.file` is not practical with the current folder-based storage design; accepted and documented.
- No rate limiting exists on callables. Apps Script quotas are the de facto ceiling; the owner-context guards on the two sweeps close the one genuinely abusable path (mail-bombing). Acceptable for an internal, identity-gated tool.

---

## 4. Performance Findings

**Layman:** Ang database ay isang spreadsheet, kaya ang bawat "query" ay pagbasa ng buong tab. Ang laro ay bawasan kung ilang beses binabasa ang parehong tab sa iisang takbo. Malaki ang binawas ng batch na ito.

- **Fixed:** `isAdmin_` no longer re-reads the Admins tab on every guard (was up to 6 full reads per request); `Request_Attachments` no longer read twice per email and once per digest row; the row-number lookup is now a server-side `TextFinder` instead of shipping the whole Requests tab to the script (~6x per approval).
- **The memo family is now the pattern:** Groups, Group_Approvers, Activity_Log, Admins, Request_Attachments, Request_Flags, each execution-scoped with a documented sole-writer invalidation point. `Requests` stays deliberately un-memoized (genuine read-after-write patterns).
- **Remaining known cost, accepted:** `handleApprove` still performs several full `Requests` reads across its email functions (each `getRequestData_` call re-reads the row). Bounded, linear, and invisible at current volume; a `Requests` memo would be a correctness hazard for the reasons above.

---

## 5. Scalability Findings

**Layman:** Aabot ito nang maayos sa libu-libong request. Ang totoong hangganan ay ang Apps Script platform, hindi ang code: 6 minuto max kada takbo, ~30 segundong lock wait, at Gmail send quota.

- The former quadratic sweep (`checkContractExpiries`) and the former linear row lookup are gone; every remaining hot path is one full-table pass or better per execution.
- Growth risks in order of arrival: (1) **Gmail quota** on a mass-return/mass-reminder day, mitigated by digest-per-approver design but `sendBrandedEmail_` fails SOFT, so quota exhaustion silently drops mail: check Executions logs weekly; (2) **Activity_Log size**: it is read whole once per execution; at ~10 actions per request it stays comfortable into tens of thousands of requests; (3) **the 16MB-ish practical spreadsheet ceiling**, years away at expected volume. Archival (moving terminal requests to an archive spreadsheet) is the eventual answer; not needed now.
- The script-wide lock is the real concurrency ceiling (~1 mutation at a time, 10s wait). Fine for one organization; revisit if "System is busy" toasts become common.

---

## 6. Workflow Improvements

- **The return-fix-resubmit loop is now closed with structure.** Before: one prose reason, requestor guesses, files-only resubmit. After: itemized flags with comments, an edit form, automatic resolution, and a "What changed" disclosure to the next approver. This was the single biggest workflow gap vs DCS.
- **Dead ends removed:** filing against an empty group registry now explains itself instead of a dead dropdown; a chain-less group's request page names the problem instead of rendering a blank rail.
- **State machine verified clean:** every transition goes through the four locked mutators; resubmit always restarts at step 1 (which is what makes all-fields editing safe); the shrink guard still protects in-flight requests from chain edits; expiry stays a derived lens, never a status.
- **Known rough edge, accepted:** Declined is fully terminal (no appeal path) and requestors cannot cancel their own pending request. Both are product decisions for post-go-live.

---

## 7. UI/UX Improvements

- Flag picker integrated into the existing return panel (progressive disclosure: collapsed by default, remark stays the required control; confirm gates on both the 20-char reason and per-flag comments).
- Requestor sees open flags three ways (highlight on the field, consolidated card, email) so the fix instruction cannot be missed. Resolved-flag history is reached from the Request History timeline: the return that raised them carries a "View details" button opening a dialog with that round's items. *(Superseded 2026-08-14: this originally rendered as a "Flagged last cycle, marked as fixed" card pinned above the page; it was moved into the history because it restated what the history already recorded.)*
- Edit form preserves every existing convention: same field markup/ids as New Request, same location Other path (free-text locations prefill instead of being blanked), same file picker, same confirm dialog pattern.
- Both error shapes now surface in toasts (a flag-validation failure shows its actual message instead of "Action failed.").
- All new CSS uses existing `:root` tokens only; amber = needs-fixing continues the established color language; no new hues, no emoji-as-icons (a real Lucide flag glyph was added to `UI_ICONS`).

---

## 8. Code Quality Improvements

- **~400 lines of dead/hazardous code deleted**, each site left with a short tombstone note pointing at git history (matching the repo's established removal convention).
- **Duplication consolidated where byte-identical:** one `renderRequestTable`, one sort-options builder, one counted-options builder, one status-count loop. Dashboard's requestor table (different columns) deliberately not forced into the shared renderer.
- **The callable-surface checker is now part of the repo** (`tools/callable-surface.js`), with the expected count as an explicit reviewed constant. This turns the #1 security property of the codebase from tribal knowledge into a failing exit code.
- **Every doc-comment lie found by the sweep is fixed.** The remaining SYNCING/addAttachment mentions are deliberate tombstones explaining removals, not drift.

---

## 9. Breaking Changes

**None for users or data.** All DTO additions are additive; the frozen contracts (STATUS strings, `resubmitHistory` format, `getRequestDetail` null semantics, `getApprovers_` shape) are untouched; old requests render identically; a plain no-flag return and a files-only resubmit behave exactly as before.

For **operators/developers**, three contract changes to know:
1. The callable surface is 27; anything depending on the deleted trigger family (nothing in-repo did) is gone.
2. `resubmit_`, `handleReturn`, `handleResubmit`, `sendReturnToRequestor_`, `sendResubmitApprovalRequest_` have extended signatures (all backward-compatible: new args optional).
3. The spreadsheet gains a 9th tab on first flagged return. No manual migration is required (self-healing), but org spreadsheet backups/exports should expect it.

---

## 10. Final Production Readiness Assessment

**Verdict: feature-complete and structurally sound, NOT yet production-ready. The sole blocker is execution: five stacked change layers with zero runtime verification.**

**Layman:** Kumpleto na ang mga kailangan, at maayos ang pagkakagawa sa papel. Pero lahat ng ito ay parang eroplanong buo na pero hindi pa nakakalipad ni isang beses. Ang pagitan sa production ay ISANG maayos na test session (sundan ang `TEST_SCRIPT.md`, mga 2 oras), tapos ang mga config flip sa go-live runbook.

What stands between now and go-live, in order:
1. `clasp push`, republish `/exec`, run `_testConfig`.
2. Execute `reference/TEST_SCRIPT.md` Phases 0-8 in one sitting; fix what breaks.
3. Go-live config flips (Phase D of the runbook): `EMAIL_DEV_TAG=false`, prod Drive folder IDs, `ORG.ALLOWED_DOMAINS=["megaworldcorp.com"]`, seed the prod sheets, register the two triggers on the Megaworld account.

---

## Final Game Plan

### HIGH (blocking go-live)
1. **Run the full test pass** (`TEST_SCRIPT.md`, Phases 0-8). Everything else on this list is meaningless until this happens. The three highest-value assertions: EXPIRY_* actions never leak into a timeline (33), the flag round-trip resolves end to end (37-41), and the adversarial console calls all reject (24, 42-44).
2. **Fix whatever the pass surfaces**, re-running the affected phase after each fix.
3. **Go-live config flips + per-account trigger registration** per `GO_LIVE_RUNBOOK.md` Phase D, including removing `dlsu.edu.ph` from `ORG.ALLOWED_DOMAINS` and `TRANSITIONAL_DOMAINS` at handover.

### MEDIUM (soon after go-live)
4. **Weekly Executions-log check for soft failures** (Gmail quota, "sharing could not be set", lock timeouts) until a month of quiet passes; `sendBrandedEmail_` failing soft means the UI will never tell you mail stopped.
5. **Node-based tests for the pure helpers** (validators, timeline projection, formula guard) using the `domaintest.js` sandbox pattern; wire `tools/callable-surface.js` + `node --check` into a pre-push script.
6. **Error-shape normalization** as one dedicated pass (frontend already tolerates both, so this is now cleanup, not a bug).

### LOW (only with a demonstrated need)
7. Emails.js sender consolidation; list-DTO projection consolidation.
8. Cache-drift reconciler; per-request locks; archive strategy for `Activity_Log`/`Requests`.
9. Product features: requestor cancel, delegation/OOO, Tier 3 admin, chain length > 3, draft autosave.

**Explicitly avoid:** re-introducing any sheet-change trigger (the deleted family exists in git history; its double-send and wrong-identity hazards are documented in `Triggers.js`), memoizing the `Requests` tab (documented correctness hazard), and any "quick" edit to the frozen DTO contracts listed in `CLAUDE.md`.
