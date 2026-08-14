# 08 · Gotchas, Frozen Contracts & Go-Live

---

## PART A — Frozen contracts (do NOT change these)

These are compared in filters/badges/email subjects/parsers or relied on by renderers. Changing them silently breaks things.

1. **`STATUS` exact strings** — `"Pending Approver 1/2/3"`, `"Fully Approved"`, `"Declined"`, `"Returned to Requestor"`. A raw-string typo breaks routing. **Never add `"Expired"`** (it's a derived lens). `"Syncing Files"` is gone.
2. **`getRequestDetail()` returns `null`** for BOTH not-found AND unauthorized — never `{success:false}`. The renderer treats `null` as empty state.
3. **DTO field names** the frontend reads (`status`, `step`, `approver1/2/3`, `app1/2/3Date/Remark`, `previousApprovals`, `priorApprovals`, `resubmitHistory`, `isExpired`, `contractEnd`, `resubmitCycle`, …) — additive only; never rename.
4. **`[PENDING]` resubmit-history format** — entries split on `\n\n---\n\n`; only one active `[PENDING]`; promoted to `Resubmit #N —` on resubmit. The banner parser depends on it.
5. **`ACTION` enum lowercase** — workflow: `submitted/approved/declined/returned/resubmitted`; system: `expiry_warning/notice/overdue`. **`getApprovalView` must only branch on the 5 workflow actions** (load-bearing for expiry idempotency).
6. **Route keys + `afterRender_<lowercaseRouteKey>` casing** — exact match or the hook silently never fires.
7. **Frontend hooks:** `data-filter` / `data-statkey` attributes, `#…-list` / `#…-controls` region IDs — preserved by the search/pagination pattern.

## PART B — Gotchas & footguns

- **Two number systems:** 1-based for `getRange()`/`setValue()`, 0-based (`-1`) for array access. Most read-width bugs = forgetting to widen `getRange(row,1,1,N)` when N grows.
- **Email comparison: always `sameEmail()`, never `===`** (casing + non-blank guard).
- **N-of-M uses `approvedCount`, not Step** — `approve()` skips blank approver slots.
- **One global Apps Script scope** — no duplicate top-level function names; key functions live in exactly one file (`Accessors.js`).
- **DB access only via `Accessors.js`** — never read `Activity_Log`/`Groups`/`Group_Approvers` directly from feature code.
- **`Requests.status/step/resubmit_count` are a CACHE** — source of truth is `Activity_Log`. If a screen looks wrong, diff the timeline.
- **`min-width: 0` on flex/grid children** holding long text, or horizontal-scroll/overflow.
- **`clasp push` ≠ publish** — push updates `/dev`; deep-links use the `/exec` URL (last *published* version). Republish after every deploy that touches `doGet`/deep-links/emails. **Hard-refresh (Ctrl+Shift+R)** the `/dev` iframe; use `clasp push -f` for `appsscript.json`.
- **Apps Script can't run locally** — Claude can't execute/test; only Kai can via `clasp push` + browser. Syntax-only checks: `node --check` on `.js` (and on the extracted `<script>` of an `.html`).
- **Identity always server-side** (`Session.getActiveUser().getEmail()`); returns `""` for users outside the owner's Workspace domain under execute-as-me.
- **Installable triggers don't fire on programmatic `setValue()`** — only human UI edits (why portal approvals don't double-fire COC/emails).
- **Dual email-path double-send risk:** `handle*` paths AND `onSheetChange` can both react to a Status change. `onSheetChange` is currently dormant/unregistered; verify with `ScriptApp.getProjectTriggers()` before go-live and gate one path if both are live.
- **A malformed Google Doc ID** throws "Unexpected error while getting the method or property getFileById" — check ID length (valid = 44 chars), not just scopes.
- **Timezone `Asia/Manila`** everywhere; `.atHour(8)` = sometime in the 8–9am window, not 8:00:00.
- **`Admins_Log` / new sheet tabs are created by hand** — `clasp push` won't create them; `appendAdminLog` no-ops (silently) if the tab is missing.
- **Single-account test rig noise:** Kai = requestor + both approvers in G001 → "previously-approved note" can misfire; separate this artifact from real bugs.
- **"Did you `clasp push`?"** — first question on any "regression"; stale deploys masquerade as bugs.

## PART C — Production go-live gate (deliberately LAST)

The whole build ran on Kai's **personal DLSU account** with `EMAIL_DEV_TAG=true` and dev Drive folders. Go-live = migrate everything to a **Megaworld Workspace account** and flip the switches. Checklist (from project `CLAUDE.md` + `reference/ROADMAP.md`):

- [ ] `EMAIL_DEV_TAG = false` in `backend/Emails.js` (removes the `[FOR APPROVER]`/`[FOR REQUESTOR]` subject tags).
- [ ] `clasp push` **and publish** a new `/exec` version (deep-links point to `/exec`; push alone won't update it).
- [ ] Swap `COC.ARCHIVE_FOLDER_ID` (`Constants.js`) from the dev folder → Megaworld `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y`; confirm the executing account can read the template Doc + write that folder.
- [ ] Swap `COC.ATTACHMENTS_FOLDER_ID` → the Megaworld supporting-docs folder; set **both** Drive folders to **Restricted** (no link sharing — files serve only through `downloadAttachment`); purge old `ANYONE_WITH_LINK` dev test files.
- [ ] All **8 sheet tabs** present with exact `SHEET_NAMES` names + headers; `Groups` + `Group_Approvers` seeded (each request's `group` = a valid `group_id` FK; each group has ≥1 active approver).
- [ ] **`Admins` sheet seeded** on the production spreadsheet (email + `ACTIVE=TRUE` per admin) — the Admin console only appears for allowlisted accounts.
- [ ] **`Admins_Log` tab created by hand** (headers `log_id | admin_email | action | target_group | details | timestamp`).
- [ ] Run **`registerExpiryTrigger()`** once on the Megaworld account (daily 8am expiry sweep, #10).
- [ ] Run **`registerApproverReminderTrigger()`** once on the Megaworld account (daily 8am pending-approval digest).
- [ ] **Do NOT run `registerTrigger()`.** It now throws on purpose. Registering the legacy `onSheetChange` path would send a SECOND copy of every workflow email, and inside an installable trigger `Session.getActiveUser()` resolves to the trigger owner rather than the acting approver, so receipts go to the wrong person. Reviving it requires deliberately removing the throw AND neutralising the sends in `handleCertificateRequestChange` first.
- [ ] Deploy under the Megaworld account with **"Execute as: Me"** (NOT execute-as-user — that would force sharing the backend Sheet with every user and break the Cat-3 auth hardening). Revert any temporary dev "anyone can access" / Sheet-sharing.
- [ ] Verify the production email sender is the Megaworld service account (`GmailApp` sends as the script owner).

> **Why per-account triggers must be re-run:** time-based triggers are per-Google-account and are **NOT** created by `clasp push`. There are **TWO** registrations to run once each in the Apps Script editor on the Megaworld account: `registerExpiryTrigger()` and `registerApproverReminderTrigger()`. `registerTrigger()` is **not** a third — it is intentionally disabled and throws.

## PART D — Exactly where the project was left (as of 2026-06-11)

- **Code state:** functionally complete, live-verified on dev. **Git branch clean** — all features through the SaaS redesign committed. Recent commits: `47e18e4` (SaaS dashboard redesign), `383d757` (CSS token aliases + type scale), `1308977` (Admin side), `2042ac7` (pending-approval reminder), `5af7a6e` (contract-expiry).
- **What remains:**
  1. **Phase 12 — final Miga art.** Externally blocked on licensed, transparent-background mascot images. Pure drop-in: re-encode the 6 PNGs to `data:` URIs → swap into `MIGA_IMAGES` in `MigaWidget.html`. No code change. (Current hero mascot has a dark background that blends into the navy hero — a soft halo is an interim workaround.)
  2. **Go-live gate** (Part C above) — the last step, all at once on the Megaworld account.
- **Deferred post-go-live (optional):** Admin **Tier 3** (request intervention — force-approve/reassign/cancel-reopen, the riskiest auth surface; unblocked by `Activity_Log`); a read-only Activity Timeline UI; an in-portal `Admins_Log` viewer; all-requests search/pagination on the admin side.
- **The admin back-nav state-loss fix** (clicking a record from Admin Records loses section+filter+sort on "Back") was confirmed real and the fix shape decided (param-passing) but **deferred** — worth checking whether it was done.
- **Open supervisor questions** that were outstanding: real Megaworld property names for the Location dropdown (placeholders `AGT/GCP/EGP/TWS - Pending`); confirming the AppSheet email sender; whether a non-technical Megaworld manager will own group management post-internship.

> **Next session's likely first move (if resuming COC):** none of the remaining items need code — they're the externally-blocked Miga art and the go-live migration. If new feature work resumes, the natural candidates are Admin Tier 3 and the Activity Timeline UI (data already exists in `Activity_Log`). The developer has since moved to sibling projects (`megaworld-DCS-automation`, `CAP-2459-IT-AFTER-RESET`) — those are separate and not covered here.
