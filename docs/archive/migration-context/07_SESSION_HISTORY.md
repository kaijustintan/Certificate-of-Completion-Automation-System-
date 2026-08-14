# 07 · Session History (chronological narrative)

> The story of how the portal got built, session by session, reconstructed from ~13 mined transcripts (late-May → 2026-06-11). Read this for the *arc* + the war-stories. Decisions are in `05`; contracts in `08`.

> **Context:** Claude **cannot run Apps Script** — every "verified/working" below means *Kai* tested it via `clasp push` → the `/dev` URL in a browser. Kai's test rig: G001 with himself as requestor + both approvers (lets him run a full chain solo — but it's a known source of "previously-approved note" misfire noise). Many sessions ended uncommitted/interrupted/compacted; per Kai's rule Claude never runs git itself. The git log shows the work *did* land in commits afterward.

---

## ① Late May — Categories 1 & 2 (one of the earliest sessions)

Picked up right after "Phase 7" (the working core port). Worked **Category 1** (data-layer: added `Resubmit_Count`/`Resubmit_History`/`Previous_Approvals` columns, fixed the Accountable-Person display bug, date-only formatting, the `[PENDING]` capture-at-return pattern, double-click button locks) then **Category 2** (the 5-state approvers chain, the Block-A/Block-B resubmit banner, requestor-only email blur, focused action mode) — each across several "fix-rounds" where Kai brought pre-diagnosed problems with prescribed snippets, Claude reviewed them against real code, flagged conflicts, and adapted with approval.

**Ended on an unresolved regression** (compacted before answering): the "Approver 1 previously approved this, then A2 returned it" indicator **disappeared** after a Round-4 refactor that cleared `Previous_Approvals` (col AH) on resubmit — so by the time A1 re-reviewed the resubmitted request, the JSON was already gone (the same return→resubmit→back-to-A1 timing trap from Round 3). *This was later fixed for good by the normalization's `priorApprovals` (earlier-cycle approvals derived from the immutable timeline).*

---

## ② June 2 — Categories 3 & 4

**Category 3:** backend **security hardening** (the auth helpers `normalizeEmail`/`sameEmail`/`getRequestRowData`/`isCurrentApprover`/`isChainApprover` + guards on every sensitive callable — because Cat 2 only controlled visibility, and any user could call `handleApprove` from the console), role-based navbar, and dashboard filter/sort dropdowns. When Kai pasted a "Finalized Category 3 Plan" and said "analyze first if anything is wrong," Claude refused to rubber-stamp it and listed **9 discrepancies**; Kai chose to update the plan to match the code (as-built record).

**Category 4:** emails 7 → 12 (intermediate receipts, requestor progress, returned-chain alert, resubmit emails), standardized format + portal deep-links, the `showConfirm()` modal, contract-date validation. Discovered the "standardize 9 emails" task was mostly fictional (only 7 existed, already clean). Fixed the **actioned-list bug** (declines/returns were invisible because the filter inferred from `AppN_Date`, which they don't stamp) by adding a `LAST_ACTION_BY` audit column. Kai squashed each category into one commit.

---

## ③ June 2–4 — Frontend Redesign + Documentation Standard + Reference Docs

A long multi-model arc (often spanning multiple transcript files). Three big bodies of work:
1. **Frontend redesign** — functional-first (clickable stat cards, approver actioned sub-filter, loading overlays) then visual (left sidebar over top navbar — chosen from contradictory ChatGPT mockups; 1280px content; two-column detail + sticky rail; modernized cards/badges). New Request stayed a single restyled form (not a wizard).
2. **Documentation pass** — a Layman-first doc-comment standard (inverted from ChainCert's Technical-first `index.js`), depth-scaled, applied comment-only to **all 21 files**, then codified into the global `CLAUDE.md` + a brand-new project `CLAUDE.md` (with ~9 hard-won gotchas).
3. **Knowledge capture** — created `reference/ROADMAP.md` + `FLOWS.md`, reconciled Carl's handover docs, recommended COC "Template 1" (zero schema change), and **deferred** the Admin role + audit log (friction-earned). Diagnosed the cross-domain auth blocker (`Session.getActiveUser().getEmail()` returns `""` for users outside the owner's Workspace domain).

**War-story (a codified rule was born here):** the two-column rail showed a horizontal scrollbar + overlapping long emails. Root cause: grid children don't auto-shrink without **`min-width: 0`**, and `.detail-row`'s `min-width:160px` left ~0px for the value. Fix: `min-width:0` on grid children + stacked rows in the rail → the now-canonical "always add `min-width:0`" rule.

---

## ④ June 4–5 — Phase 9 (COC PDF) + Phase 10 (Miga)

Built **COC PDF generation** end-to-end (copy a Google Docs template → fill via `replaceText` → export PDF → archive → attach to the success email). Chose **Template 1** (zero schema change) + **Option B** (hand-built Doc, not `DocumentApp`-generated) + hooking into the shared `sendFullyApprovedToRequestor` (covers both the portal and `onSheetChange` paths).

**A long live-debugging arc** to get a correct PDF — four real bugs, all instructive:
1. `getFileById` threw "Unexpected error while getting the method or property" — looked like a missing Drive scope; the **real cause was a double-pasted 88-char Doc ID** (a malformed ID throws that exact misleading wording). *(The scope work was kept — still needed.)*
2. "No item with the given ID" — the archive folder ID belonged to the **old AppSheet/prod account**; the dev account had no access → Kai made a dev folder.
3. The PDF still showed raw `<<[Column]>>` syntax — the Doc was built by copying the AppSheet template verbatim (`<<…>>` tokens) but the code searched `{{tokens}}` → made the generator match BOTH.
4. Some narrow-cell fields wouldn't replace — long AppSheet expressions had **hard line breaks mid-expression**, and `replaceText` can't match across a paragraph break → replaced those cells with short single-line `{{tokens}}`.

Then **Phase 10 (Miga)** — base64-embedded 6-expression mascot art in a portrait box (Kai's crops were full-body, so a circular avatar would cut off the face). Marked DONE as interim; spun out **Phase 12** for final transparent/licensed art.

---

## ⑤ June 8–9 — Phase 8 (Attachments) → Schema Normalization (the heavyweight)

The biggest single session. Started with **Phase 8** (mandatory upload-before-submit), pivoted through a security redesign (fully-private files + identity-gated `downloadAttachment` — Claude argued down a Drive-link-in-email approach twice as "security theater"/forwardable-bearer-link), added the Location dropdown, then **escalated into the headline work: a big-bang database normalization** of the 35-col monolith into 7 sheets behind a new `Accessors.js` seam.

The normalization is where Claude **reversed its own earlier advice**: it had said "normalize post-go-live," then — after Kai's structure-OCD pushback — agreed that with no users + disposable data, *now* is the safest window. Kai also overrode his own "strangler" choice to a **big-bang** (handed Claude a manually-built `.xlsx` and "code all that's needed at once"), accepted by Claude *because* the risks strangler protects against were gone, while keeping the two safety disciplines (accessor seam + frozen DTO). The `.xlsx` build itself was delegated to Claude web (no Python/pip on Windows or WSL).

Closed with a batch of post-test bug fixes (the `priorApprovals` fix for the re-review note, declined-chain "—", "Approver N (email)" decline emails, `COC_PDFs` logging, friendlier `__Original__`/`__Resubmit-N__` filenames). **The fix batch was written but NOT re-tested** at session end — flagged as the next session's first job. Durable handoff written to `reference/SESSION_HANDOFF.md`.

---

## ⑥ June 10 — Doc-Sync + #6 Cycle Grouping + #10 Expiry

Opened mid-stream after the normalization (all code-complete but uncommitted). Did: **#6** (attachment cycle grouping — "Current submission" vs "Previous versions"), **#13** (synced `CLAUDE.md` + all `reference/` docs from the old 35-col schema to the new 7-sheet schema — historical sections left as-is for provenance), stale-comment cleanup, and the full **#10 contract-expiry feature** built up across several turns.

**War-story (an honest reversal):** the expiry email cadence evolved live — Kai started with T-7 + day-of, then pushed for a **post-expiry** email too; Claude had *recommended against* a third email, then **reversed** after Kai's argument that "employees won't watch the portal unless filing" (for a low-touch system, email is the only awareness channel). Final: **T-3 / day-of / day-after, each once**. Idempotency reuses `Activity_Log` system flags (the design decision that load-bearingly relies on `getApprovalView` ignoring non-workflow actions). This added the system's **first always-on scheduled job**.

---

## ⑦ June 10 — Daily Pending-Approval Reminder Digest

A small, focused session: a daily 8am digest nudging whoever currently holds up a pending request (supervisor-requested — approvers miss the original email). Deliberately modeled as a near-twin of the expiry reminder, **except** its idempotency is the **schedule itself, not an `Activity_Log` flag** (a nudge is meant to repeat). One digest per approver. This is the **2nd** daily trigger (`registerApproverReminderTrigger` = the 3rd per-account registration). Mid-session Kai asked the digest to carry the full per-request detail block (reusing `buildInfoBlock`/`buildAttachmentList`/`buildApprovalLog`). Handed off to the Admin-role session.

---

## ⑧ June 9–11 — Admin Console (Tier 2), 2 refinement rounds

The biggest feature build. Plan → build `backend/Admin.js` (7 guarded callables) + `frontend/pages/Admin.html` → then **two rounds of live-test refinement** driven by Kai's findings. Scope: Tier 2 (oversight + group/chain CRUD; Tier 3 deferred), additive `isAdmin` (not a third role), sheet-only allowlist.

**Round-2 findings (9 of them)** drove: gating the new-request dropdown to groups with ≥1 approver (empty-group bug); a separate `Admins_Log` audit sheet (8th tab); the `REQUESTOR_PORTAL_NOTE` instead of per-change requestor emails; dropping the removed-approver email (supervisor: "no need to inform"); **adding** an immediate new-approver email (knowingly breaking the "no emails from admin actions" rule — flagged out loud); and the **current-approver-change** notification trigger (a pure reorder changes who holds a request but the old membership-diff trigger sent nothing).

**The headline reversal:** Round 2 locked "keep whole-chain replace (tombstones harmless)"; Round 3, after Kai objected to seeing tombstone rows on a mere reorder, **switched to in-place position-matched storage** (zero new rows/tombstones on reorder) — explicitly conditioned on `Admins_Log` now existing to carry the history the tombstones used to. A two-tile landing replaced a confusing "View" dropdown; the chain editor got soft-remove + Undo. A "still wrong" reorder email turned out to be a **stale-deploy false alarm** (Kai hadn't `clasp push`'d — he retracted it). Hard guards: 1–3 slots, unique emails, and the in-flight shrink guard (don't orphan a pending request below the new chain length).

---

## ⑨ June 11 — UI/UX Finalization (the last COC session)

Audit-first, then a three-phase visual overhaul: (1) design-system refresh (semantic CSS token aliases — which silently fixed 5 rules referencing undefined vars — unified type scale, micro-animations, dead `Syncing Files` code pruned), (2) all **15 emails → branded dual-format HTML** via new `backend/EmailHtml.js`, (3) full **enterprise SaaS dashboard redesign** (hero cards, icon stat cards, client-side search + pagination) on a new shared `frontend/components/UI.html`. All presentation-only — no DTO/STATUS/route/recipient/trigger change.

Notable: the SaaS redesign **reversed two just-approved plan decisions** (icon stat tiles + gradient Miga hero) — Claude flagged the conflict rather than silently un-doing approved work, got Kai's "do all, I trust you." Kept navy as the brand anchor + `#2563EB` as the interactive accent; refused to wholesale-swap to the spec's brighter colors. Captured the durable "layman-then-technical commit summaries" preference to memory. Deferred the consistency/copy "voice" sweep as a taste task. Landed as commits `383d757` + `47e18e4`. **This is where the COC project was left** (the dev then moved on to sibling projects — DCS automation and the CAP-2459 capstone).

---

## Recurring threads across all sessions

- **Claude pushing back honestly** is a feature Kai wants — multiple decisions came from Claude refusing to rubber-stamp a pasted plan/snippet, or reversing its own earlier recommendation when the facts changed (normalization timing, the post-expiry email, in-place chain storage).
- **Pasted snippets referenced things that didn't exist** (`.action-btn`, capitalized `afterRender_` hooks, wrong column reads) — always verify against real code before applying.
- **The single-account test rig** (Kai = requestor + both approvers) repeatedly produced "previously-approved note" misfire noise that had to be separated from real bugs.
- **"Did you `clasp push`?"** — more than one "regression" was a stale `/exec`/`/dev` deploy, not a code bug.
- **Sessions sprawled and often ended uncommitted / interrupted / compacted** — but the git log confirms the work landed.
