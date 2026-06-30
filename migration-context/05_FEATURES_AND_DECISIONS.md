# 05 · Features & Decisions Log

> Feature-by-feature: **what** was built, **why**, the **decisions locked**, and the **alternatives rejected**. This is the "why is it built this way" reference. Chronological order is in `07_SESSION_HISTORY.md`.

---

## Category 1 — Data Layer & Resubmit Tracking

**What:** Hardened how the system remembers the return/resubmit cycle so a bounced request keeps clean history; stopped double-click action bugs.

**Decisions & rationale:**
- **Capture returner identity AT return-time, not reconstruct it later.** The original `resubmit()` tried to reconstruct *who returned it and why* after the fact — but by then `Step` is already 0 and old remark values linger from prior test cycles. "Unreliable by design." Fix: write a `[PENDING] Approver N (email) / date / reason` block inside `handleReturn()` **while state is still live**; `resubmit()` just promotes `[PENDING]` → `Resubmit #N`. This is the genesis of the **"capture before clear"** pattern and the `[PENDING]` contract.
- **Only ONE active `[PENDING]` entry may exist.** Returning an already-returned request was stacking duplicate `[PENDING]` lines. Fix: if history already contains `[PENDING]`, slice it out before appending the fresh one.
- **Button-lock adapted to the existing async/await pattern.** Kai's prescribed snippet used a `.action-btn` class + `.catch()` chain that didn't exist (buttons were `btn btn-*`, handlers used try/catch via `runReviewAction`). Via AskUserQuestion, chose "Adapt to existing async/await" — lock at start, unlock only on failure (success navigates away).
- **(Original schema)** Added columns `Resubmit_Count`, `Resubmit_History`, later `Previous_Approvals` (JSON of who'd approved at each return). *(All later absorbed into `Activity_Log` by the normalization — these columns no longer exist.)*

**Rejected:** post-hoc returner reconstruction (unreliable); a strict "date AND remark" returner-ID rule (Return writes a remark but **no** `AppN_Date`, so it would never match); embedding previous-approval data as text inside the history narrative (mixed two data types, forced fragile regex — refactored into a dedicated JSON column, later into the timeline).

**Bugs fixed:** Accountable Person showed "—" (saved fine, but `getRequestDetail` never included the key); "Unknown approver / wrong reason" in history (the reconstruct-after timing trap); duplicate `[PENDING]` stacking; double-click firing actions twice; App3 remark not cleared on resubmit.

---

## Category 2 — Approver UX Redesign (purely frontend)

**What:** A pleasant approver review screen — a visual **5-state approvers chain** (replacing the old flat "Approval Log"), a resubmit banner, focused action mode.

**Decisions & rationale:**
- **Added 4th & 5th chain states** (Declined ✕, Returned ↩) beyond Acted/Current/Awaiting — because a declining/returning approver otherwise fell through to gray "Awaiting" (misleading, since those actions stamp no date and status isn't "Pending").
- **Resubmit banner split into Block A (current return, always shown) + Block B (history, collapsible)** — the old banner keyed off `resubmitCount` and showed a confusing count vs the expanded entries. Now it parses the history string and classifies by prefix.
- **Email privacy = blur future approvers on the REQUESTOR view only** (`renderApproversChain(detail, blurFutureEmails)` — `true` requestor, `false` approver). Inspired by DLSU's internship form. Approvers see the full chain for context.
- **Focused action mode** — opening the Decline or Return panel hides the other action buttons (via `style.display`) to prevent conflicting clicks; Cancel restores them.
- **Parse the LATEST return-cycle entry, not `[PENDING]`-only** — the "you previously approved this" note must still show after resubmit (when `[PENDING]` has already been promoted to `Resubmit #N`).

**Rejected:** the prescribed 3-state chain; a `.hidden` class for focused mode (used `style.display`); `parsePreviousApprovals()` reading `[PENDING]`-only (would render nothing post-resubmit).

> **War-story / unresolved-at-the-time:** the Cat 2 session ended mid-debug of a regression — the "Approver 1 previously approved" note **disappeared** after a refactor that cleared `Previous_Approvals` on resubmit (so by the time A1 re-reviewed the resubmitted request, the JSON was already gone). This *exact* timing trap is what the later normalization fixed for good with `priorApprovals` (earlier-cycle approvals derived from the immutable timeline).

---

## Category 3 — Navigation, Dashboards & **Backend Security Hardening**

**What:** Role-based navbar, filter/sort dashboards, and — critically — **server-side authorization** so a user can't bypass the UI and call approval functions from the browser console.

**Decisions & rationale:**
- **Security pulled forward (was Phase 11).** Cat 2's role-based UX controlled *visibility*, not *authority* — any user could open DevTools and call `google.script.run.handleApprove(...)`. So Cat 3 added server guards.
- **Harden `addAttachment`/`deleteAttachment` too** — exploration found they were callable with zero auth (not in the original spec). Caller must own the parent request.
- **`getRequestDetail` returns `null` on unauthorized, NOT `{success:false}`** — overrode a pasted plan's blanket "all failures return `{success:false}`" rule, because the renderer reads `.projectTitle` off the result and an error object would crash it.
- **`sameEmail()` over raw `===`** — Google casing differs across sessions (risks locking out the legit approver) + a non-blank guard (two empty cells must not match).
- **Filter tabs → dropdowns on BOTH dashboards.** Kai found the 5-tab row noisy. Claude first argued to keep tabs on the approver side (count badges), Kai pushed back ("the count is already shown by stat cards"), Claude **conceded its own reasoning was inconsistent** and switched to consistent dropdowns + a new approver stat grid.
- **Actioned-list fix = add an audit column** (`LAST_ACTION_BY`) rather than infer from dates. *(Later replaced by the timeline's actor.)*
- **Audience tag behind `EMAIL_DEV_TAG`** (`[FOR APPROVER]`/`[FOR REQUESTOR]`) — Kai tests with one email and needs to tell recipients apart. Must flip to `false` for prod.

**Rejected:** rubber-stamping the pasted "Finalized Category 3 Plan" — Claude listed 9 discrepancies first; Kai chose "update the plan doc to match code" (make it an as-built record); `afterRender_Dashboard()` capitalized hooks (dead — must be lowercase route key).

**Bug fixed:** declined/returned requests invisible in "Actioned by you" + stat stuck at 0 — `getMyActionedRequests()` inferred "you actioned this" from a stamped `AppN_Date`, but decline/return stamp none. Fix: the `LAST_ACTION_BY` audit column (later: the timeline actor).

---

## Category 4 — Notification Completeness & Email Overhaul

**What:** Closed every "left in the dark" gap (intermediate-approver receipts, requestor progress, prior-approver bounce alerts); rebuilt all emails to one labeled format with portal deep-links. Emails 7 → 12 functions.

**Decisions & rationale:**
- **Email "standardization" was a near non-task.** The roadmap claimed "standardize 9 emails"; the audit found only 7, already clean. The real work was the *new* emails; the one real fix was subject casing (ALL-CAPS → Title Case).
- **Progress email on EVERY intermediate step** (not start/end only) — "start/end only" is the exact status quo Cat 4 exists to fix; real chains are 2–3 approvers so it's 1–2 emails. (Kai briefly said "stop sending it," then **corrected himself: "retain… what I saw was probably a duplicate."**)
- **New subject format** `[COC Request]: <ctrl> | <Status>` + the dev audience tag.
- **Make "who returned" explicit** — `approverLabel` ("Approver 2 (email)") threaded through all return emails.
- **Dedicated resubmit email to Approver 1** carrying the prior return reason — A1 was getting a generic "new request" with no sign it was a resubmission. (Reason must be captured in `handleResubmit` *before* `resubmit()` clears the columns.)
- **Custom `showConfirm()` modal** replacing 3 native `confirm()` dialogs.
- **Deep-links via query params**, contract-date validation on the form.

**Rejected:** widening `getRequestData()` to read col 34 for the chain notification (passed `previousApprovals` as a param instead — it's already in scope before the dates clear); removing the progress email (reversed).

---

## Frontend Redesign + Documentation Standard

**What:** Two-phase redesign (functional polish → visual overhaul) + a Layman-first doc-comment standard applied to all 21 files + the first project `CLAUDE.md`.

**Decisions & rationale:**
- **Left sidebar over top navbar** — two ChatGPT mockups contradicted each other; chose sidebar to match the "enterprise portal" (ServiceNow/Fiori) goal.
- **Restyle the single New Request form, NOT a stepper/wizard** — wizard was a large, risky rewrite for marginal gain.
- **Functional-first, then visual** — separate phases for reviewable diffs. (Behavior: clickable stat cards, approver actioned sub-filter, loading overlays. Visual: sidebar, 1280px content, two-column detail + sticky rail, modernized cards/badges.)
- **Doc standard: Layman (Tropang Ex) FIRST, then Technical** — the deliberate inversion from ChainCert's `index.js` (Technical-first). **Depth scales by function** — substantive functions get STEPS (both tracks) + EXAMPLE; one-liners get a compact block. Codified into global + new project `CLAUDE.md`.
- **No repo restructuring** — flat global scope means folders buy nothing; the real "architecture" is `.clasp.json` `filePushOrder`.

**Rejected:** wizard form; keeping the top navbar; forcing full STEPS on trivial functions; mirroring ChainCert's `services/`/`controllers/` tree.

**Bug fixed (origin of a codified rule):** two-column rail horizontal-scroll + text overlap — grid children don't auto-shrink without **`min-width: 0`**, and `.detail-row`'s `min-width:160px` + long emails left ~0px for the value. Fix: `min-width:0` on grid children + stacked rows in the rail + global `overflow-wrap`. → the **"always add `min-width:0`"** rule.

---

## Phase 9 — COC PDF Generation

**What:** On full approval, auto-generate the Certificate-of-Completion PDF from a Google Docs template, archive it to Drive, log it to `COC_PDFs`, and attach it to the requestor's success email. See `06_EMAIL_AND_COC.md` for the full template spec.

**Decisions & rationale:**
- **"Template 1" — zero schema change.** Every certificate field maps to an existing `Requests` column or the `getApprovers` join. Template 2 would have needed 4 new columns. This kept Phase 9 a pure implementation task.
- **Build method = Option B (manually-built Google Doc), not Option A (code-generated via `DocumentApp`).** `DocumentApp` is weak at pixel-perfect tables/borders/colored dates; a hand-built Doc is "5 minutes." The `replaceText()` core is identical either way. Trade-off: the layout isn't version-controlled → mitigated by `reference/COC_TEMPLATE_SPEC.md` as the repo record.
- **Hook into `sendFullyApprovedToRequestor()` (Emails.js), NOT `handleApprove()`.** There are **two** paths to the fully-approved email (portal `handleApprove` + the `onSheetChange` manual-edit path); both call the shared email fn, so hooking it = one change covers both, generated exactly once. (Relies on: installable triggers don't fire on programmatic `setValue()`, so no double-generate on normal approvals.)
- **Generation is defensive (try/catch) — must NEVER block approval.** A PDF failure can't stop the request being recorded approved or the email sending; body falls back to "provided separately." The PDF is regenerable.
- **Admin copy = Drive folder only** (deferred a sheet index/log) — admin is the sheet owner with Drive access; PDFs named `COC - <ctrl>.pdf` are searchable. (`COC_PDFs` logging was added later in the normalization.)
- **Dual-token matching** — the generator matches BOTH legacy AppSheet `<<…>>` expressions AND clean `{{tokens}}` (the latter fixes cells whose long AppSheet expression broke across a line break, which `replaceText` can't match across).

**Rejected:** Option A code-generated template; hooking into `handleApprove` (misses the trigger path); the initial "missing Drive scope" theory for a `getFileById` error (real cause: a **double-pasted 88-char Doc ID** — a malformed ID throws that exact misleading "Unexpected error while getting the method or property" wording).

---

## Phase 10 / 12 — Miga Mascot Assets

**What:** Replaced placeholder squares with real "Miga" mascot artwork — 6 expressions (default, welcome, approved, pending, declined, returned), base64-embedded.

**Decisions & rationale:**
- **base64 embed, not hosted URLs** — images can't break inside the iframe SPA, no external hosting.
- **Portrait box (64×88, `object-fit:contain`), not a rounded avatar** — Kai's crops are full-body; a circular `cover` avatar would crop to the torso and cut off the face.
- **Phase 10 marked DONE as interim; new Phase 12 created** to finalize — the art has a dark/opaque background (`MIGA-WELCOME` is lighter, inconsistent) and isn't licensed/transparent. **Phase 12 is a pure drop-in re-encode** (replace the 6 PNGs → re-encode to `data:` URIs → swap into `MIGA_IMAGES`; no other code change). This is the main remaining feature item, externally blocked on assets.

---

## Phase 8 — Attachment Upload-Before-Submit + Private Gated Serving

**What:** Require ≥1 supporting doc *before* submit; files upload only at submit (atomic, rollback on failure); stored **fully private** in Drive; served via an identity-gated in-portal **View** button; on resubmit the requestor can re-upload (old files kept, tagged by cycle).

**Decisions & rationale (this feature had the richest security debate):**
- **Submit-time upload, NOT the legacy SYNCING flow.** A real fork: the handoff doc said *extend* legacy infra (keep `SYNCING`, `checkAttachmentSync`, `Expected_Attachments`); the reference docs said the opposite. Kai's ruling — "basta ≥1 file, walang specific required" — killed legacy. Chose **submit-time, atomic, all-or-nothing**. Rejected: post-submit attach-after (orphan-file risk + SYNCING limbo).
- **No per-product required-docs matrix.** The `ARCHITECTURE.md` matrix (Software→quotation+budget…) was killed — original AppSheet had no enforcement, `productType` is free-text with no clean key.
- **Upload-FIRST ordering.** A Plan agent corrected the initial write-row-then-upload to **upload all files first, then write the row + email** — Apps Script has no transactions, so uploads-first is the only ordering that guarantees no orphan files / no limbo row on mid-way failure.
- **Security = fully private files + in-app gated download (`downloadAttachment(id)`).** When Kai questioned whether requestors should hold Drive links, Claude pushed back: removing *requestor* access is "security theater" (they uploaded the files). The real issue is handing out **any durable bearer link** — applies equally to approvers. So: store private (no `setSharing`), serve bytes (base64) only after a `Session` identity check (`sameEmail(requestor)` OR `isChainApprover`, later `|| isAdmin`). **No raw Drive URL ever leaves the server.** Decisive factors: NDA-grade docs, zero dependency on Megaworld's sharing policy, and **it's the only model testable on the DLSU account** (domain-link sharing is blocked there).
- **Inline preview through the server**, blob-cached (instant 2nd view), with a Miga loading tab.
- **Description shown by default** (no "see description" toggle) — the description ("Supplier Quotation") is primary decision info for approvers, often clearer than a cryptic filename.
- **`Expected_Attachments` kept populated but vestigial** (slated for a future removal pass).

**Rejected:** legacy SYNCING/`checkAttachmentSync` extension; per-product matrix; a Drive link in the approver email (would un-private the files; forwardable bearer link to NDAs — argued down twice; the portal deep-link is the secure channel); asymmetric access (approver link / requestor download-only) — "worse on every axis."

**Bugs fixed:** `setSharing(DOMAIN_WITH_LINK)` threw on the DLSU account (admin restricts domain-link sharing) → made non-fatal, then removed entirely when files went fully private; an orphaned-file rollback hole (file created before being pushed to the rollback list) — fixed by the same change; **resubmit stuck in SYNCING forever** (Phase 8 set `Expected_Attachments = files.length > 0`, and `resubmit()` still had the `>0 ? SYNCING` branch) → `resubmit()` now always routes to `PENDING_1`.

---

## Schema Normalization (big-bang, 2026-06-10) — see `03_DATA_MODEL.md`

**What:** 35-col `Certificate_Requests` monolith → 8 normalized sheets behind `Accessors.js`. The headline architectural work.

**Decisions & rationale:**
- **Normalize NOW, big-bang, before the Admin role.** Claude's *own earlier advice* was "post-go-live." It **reversed** that after Kai's pushback: with no users + disposable data, *now* is the safest window for invasive surgery, not post-go-live. Driver: Kai's structure-OCD + the Admin console must be built against the *final* schema (it reads normalized approval history).
- **Strangler → overridden to big-bang.** Kai initially approved incremental/strangler, then asked Claude to hand him a ready `.xlsx` template and "code all that's needed" at once. Claude flagged this as big-bang and accepted it **specifically because** the two risks strangler protects against were gone (no users, disposable data) — but kept the two safety disciplines: **the centralized accessor seam + the frozen DTO**.
- **Surrogate `group_id` keys** (e.g. `G001`) — so renaming a group doesn't rewrite every request's FK.
- **`control_number` stays separate from `request_id`** — surrogate (short internal FK in URLs/emails) vs business key (human-facing).
- **COC link → separate `COC_PDFs` table, not a `Requests` column** — certificates can be re-issued; a table preserves every copy, a column overwrites.
- **`status`/`step`/`resubmit_count` kept as a denormalized cache on `Requests`** — a deliberate Sheets concession (can't cheaply aggregate the actions sheet on every dashboard load).
- **Rename `Approval_Actions` → `Activity_Log`** — the name read as approvals-only; it's the full append-only logbook.

**Rejected:** strangler/incremental migration (overridden); local `.xlsx` generation (no Python/pip/openpyxl on Windows or WSL — delegated the workbook build to Claude web); `control_number` as the `request_id`; COC link as a `Requests` column; normalization post-go-live (Claude's own reversed advice).

---

## Location Dropdown

**What:** The form's "Location" field became a fixed dropdown (predefined Megaworld property codes + "Other" free-text) instead of free text — consistent, filterable data. No backend change (still writes `CR.LOCATION`). The option labels were placeholders (`AGT/GCP/EGP/TWS - Pending`) awaiting real Megaworld property names.

---

## #6 — Attachment Cycle Grouping

**What:** On a resubmitted request, the Attachments card splits into **"Current submission"** (cycle === `resubmitCount`) vs **"Previous versions"** (older, sub-labeled Original / Resubmit #N). Never-resubmitted requests render a flat list (unchanged).

**Decisions:** chose "group by cycle" — prior files already rendered as one undifferentiated card; the gap was telling *which cycle* a file belonged to. #7 (keep both old+new on resubmit) was already decided — resubmit appends, never wipes. Additive `resubmitCycle` DTO field (frozen-DTO-safe); `renderAttachmentsBlock` groups by `RA.RESUBMIT_CYCLE`.

---

## #10 — Contract-Expiry Indicator + 3-Stage Reminders

**What:** (1) A red "Expired" chip next to (never instead of) the status badge on both dashboards + detail pages, plus an "Expired" dropdown filter & stat card. (2) Daily 8am emails to the requestor: **3 days before / day-of / day-after** a Fully-Approved contract lapses.

**Decisions & rationale:**
- **Expiry is a DERIVED LENS, not a stored status.** Never add `"Expired"` to STATUS. `isContractExpired(rawEnd)` (Utils.js) computes it live (end-of-day, Asia/Manila, blank/invalid → false). "Like checking if milk is past its date by reading the carton — always accurate, zero maintenance."
- **Notify the requestor only, not approvers** — an approver who signed a year ago can't act on a lapse now (noise). The Accountable Person is arguably most relevant but is free-text, not guaranteed an email (a flagged data gap, not chased).
- **Cadence evolved across turns:** started T-7 + day-of → Kai pushed for a **post-expiry** email too ("employees won't be looking at the portal unless filing") and Claude **honestly reversed its earlier 'don't add a third email' recommendation** (for a low-touch system, email is the only awareness channel) → final locked at **T-3 / day-of / day-after, each once**, warning window 7→3.
- **Don't stamp "EXPIRED" on the COC PDF** — the PDF is a point-in-time Certificate of Completion; completion happened, the *contract* lapsed. Expiry is operational, not a property of the certificate.
- **Idempotency via `Activity_Log` system actions** (`expiry_warning/notice/overdue`), not a new sheet/column — reuses the timeline; `getApprovalView` ignores them. The warning + overdue stages self-heal (ranges); day-of is exact.

**Rejected:** an `"Expired"` status; notifying approvers; a dedicated `Notifications_Log` sheet for idempotency; stamping the PDF; chasing Accountable-Person-as-email.

---

## Daily Pending-Approval Reminder Digest

**What:** A daily 8am email nudging whoever **currently** holds up a pending request — supervisor-requested, because approvers miss the original email ("natatabunan"). **One digest per approver** listing all their pending requests with `?page=review` deep-links + full per-request detail.

**Decisions & rationale:**
- **Idempotency = the daily schedule itself, NOT an `Activity_Log` flag** — the deliberate **opposite** of the expiry sweep. A daily nudge is *meant* to repeat, so the once-a-day run is the only guard; it writes **nothing** to `Activity_Log` and adds **no `ACTION` value** (one row per pending per day would bloat the timeline). Purely additive — no DTO/column/frontend change.
- **One digest per approver, not per request** — cleaner inbox; multiple emails would re-create the burial problem. Run every day incl. weekends; remind from day 1.
- `checkPendingApprovals()` buckets `PENDING_*` rows by `normalizeEmail(getCurrentApprover(step, group))`.

**Rejected:** copying the expiry pattern's `Activity_Log` idempotency flags; per-request separate emails.

---

## Admin Console (Tier 2) — the biggest feature, 2 refinement rounds

**What:** An in-portal control panel (route `admin`) for users on the `Admins` sheet: (1) view **all requests** read-only; (2) **CRUD on `Groups`/`Group_Approvers`** (create/rename/activate/deactivate groups; set/reorder Approver 1/2/3) without opening the spreadsheet.

**Decisions & rationale:**
- **Tier 2 scope** (oversight + group/chain CRUD). Tier 1 (read-only) insufficient; **Tier 3** (force-approve/reassign — the riskiest auth surface) deliberately deferred post-go-live (unblocked by `Activity_Log` whenever wanted).
- **Admins allowlist is sheet-only (no UI)** — so an admin can't mint other admins.
- **Admin is an additive `isAdmin` flag, NOT a third role** — `detectRole` never returns `"admin"`; an admin-who-is-also-approver keeps `role:"approver"`; zero regression to existing role checks.
- **Empty-group bug → gate the dropdown, not "require an approver at creation."** Kai's instinct was to require ≥1 approver to create a group; Claude's senior read: gating `getApproverGroups()` to active **AND** ≥1 active approver fixes the bug *however* a group became empty (incl. emptied-later) and keeps "create shell first, add chain later" flexibility.
- **Admin audit → separate `Admins_Log` sheet, NOT `Activity_Log`** — admin actions are config-scoped (no `request_id`); injecting blank-request_id rows + new ACTION values would pollute `getApprovalView`'s frozen history reconstruction.
- **Don't email the requestor on every chain change** — Kai worried the requestor (who *does* see approver emails in decline/return/full-approval logs) might follow up with a replaced approver. But per-change requestor emails = notification fatigue. Chosen: a standing **`REQUESTOR_PORTAL_NOTE`** line ("approvers may change — check the portal for the current handler") on in-flight requestor emails.
- **Removed approvers are NOT emailed** — supervisor ruling: "no need to inform regardless" — the approver themselves requests the move, so they already know.
- **New approver IS emailed immediately** (don't wait for the 8am digest) — this **knowingly broke the prior "no emails from admin actions" rule**; Claude flagged the reversal explicitly ("binubuksan natin yon nang tama, hindi by accident") and updated docs.
- **Notification trigger = current-approver-of-an-in-flight-request changed, NOT chain membership.** Round-2 catch: a pure **reorder** (ex-Approver-2 → Approver-1 on a PENDING_1 request) changed *who holds the request* but sent no email (the person was "already in the chain"). Fix: capture each pending request's current approver **before** the replace, compare **after**, email whoever newly becomes the handler. Designation-only edits send nothing. The email wording branches on the recipient's prior sequence: fresh add → "added as approver… Approver N"; reorder → "you were Approver M; you are now Approver N" (subject "Approver Role Changed").
- **In-place chain storage (the headline reversal).** Round-2 locked "keep whole-chain replace (tombstones harmless)." After testing, Kai objected to seeing old rows flipped `ACTIVE=FALSE` + 2 new appended rows on a mere reorder. Claude agreed — this **reverses** the round-2 call, and was exactly the condition pre-flagged: in-place becomes correct **iff a real audit log exists**. Since `Admins_Log` now provides the timestamp+diff, the tombstones are redundant → `replaceGroupChain` switched to **position-matched in-place**: reuse the k-th existing row (overwrite seq/email/designation, stable `GAP.ID`), append only on grow, deactivate only on shrink. A reorder/email-change now writes **zero new rows, zero tombstones**.
- **Two-tile landing** (View Records / View Groups) replaced a confusing "View" dropdown (it read as a filter) — internal `_adminSection` state within the single `admin` route (no sub-routes).
- **Chain editor soft-remove + Undo** — removing a slot greys it "pending removal"; it only drops on Save, so a blocked save / misclick keeps your work.
- **Hard backend guards in `adminSaveChain`:** 1–3 slots (engine hard-capped — `approve()` only branches 1–3); valid + unique emails; and the **in-flight shrink guard** — reject (listing blocking control numbers) if any `PENDING_*` request sits at a step the new chain would delete, else `getCurrentApprover` → null and the request vanishes from every pending list forever.
- **Deactivating a group is routing-safe** (`GRP.ACTIVE` only gates the new-request dropdown) — deliberately NOT blocked when pending requests exist.

**Rejected:** Tier 1 / Tier 3; an admin-managed allowlist UI; requiring an approver at group creation; folding admin actions into `Activity_Log`; emailing removed approvers; per-change requestor broadcast emails; `notifyNewApprovers_` (membership-diff trigger — replaced by `notifyChainChanges_`); whole-chain-replace storage with tombstones (reversed to in-place).

**Bugs fixed:** empty group selectable in the form; reorder sent no notification; reorder email said "added" for an existing approver; a false-alarm "regression" (Kai had tested **without `clasp push`** — old code; he retracted it).

---

## UI/UX Finalization — Design System + Branded Emails + SaaS Dashboard Redesign

**What:** Three phases. (1) Design-system refresh (semantic CSS token aliases, unified type scale, micro-animations, dead-code prune). (2) All 15 emails → **branded dual-format HTML** via new `backend/EmailHtml.js`. (3) Enterprise **SaaS dashboard redesign** (hero cards, icon stat cards, client-side search + pagination, sidebar icons) on a new shared `frontend/components/UI.html`. **All frontend/presentation-only** — no DTO/STATUS/route/recipient/trigger change.

**Decisions & rationale:**
- **Audit-first, not blind editing** — verify the handoff candidate list (read-only) before "fixing" things that aren't broken.
- **Keep navy as the brand anchor; introduce `#2563EB` as the interactive accent; keep AA-verified semantic tints.** `.btn-primary` → blue (SaaS "accent = primary action" convention); navy stays chrome/brand. **Refused to wholesale-swap** to the spec's brighter greens/reds absent an explicit "louder look" request.
- **Keep Inter, refine** (don't introduce a new font pairing).
- **Approve button → solid green** (Decline red outline, Return amber outline).
- **The SaaS redesign reversed two just-approved plan decisions — flagged, not silent.** The mockup wanted icon stat tiles + a gradient Miga hero, contradicting the approved plan ("no icons; Miga as flat aside"). Claude refused to "silently un-do approved work," named the conflict, and got Kai's "do all, choose the best, I trust you."
- **Keep the Expired stat card (5 cards, not the mockup's 4)** — it's the #10 feature.
- **Branded HTML keeps plain-text as the fallback** (3rd positional arg = source-of-truth copy; HTML twin in `options.htmlBody`).
- **Captured a durable preference** → `memory/feedback-commit-summaries.md`: every commit gets a layman-then-technical write-up, then proceed without waiting.

**Rejected:** the consistency/copy "voice" sweep — a *taste* task, not engineering; Claude refused to pick warm-vs-neutral on Kai's behalf (deferred); wholesale palette swap to the spec's brighter colors.

**Bugs fixed:** dead `Syncing Files` residue in 3 code spots (bigger than the candidate list claimed); **5 CSS rules referencing undefined vars** (`.filter-label`, `.modal-title`, etc. — fixed by *defining* the semantic alias layer, no selector rewrites); buttons had no focus/active states. (The admin back-nav state-loss fix was deferred to a later session.)
