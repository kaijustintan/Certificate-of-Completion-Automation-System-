# 01 · Project Overview

## 1. What the system is

**E-Certificate Automation** (a.k.a. the **COC portal**) is a multi-level approval workflow for processing **certificate requests** at Megaworld — for IT acquisitions and renewals: software licenses, hardware purchases, service contracts, etc.

The flow in one breath: a **requestor** submits a request form + supporting documents → the system routes it through **up to 3 approvers in sequence** (a per-department "group" chain) → each approver can **Approve / Decline / Return** → emails fire at every status change → when the final approver approves, the status becomes **"Fully Approved"** and a **Certificate of Completion (COC) PDF is auto-generated and emailed** to the requestor.

**Three actors:**

| Actor | Role | Surface |
|---|---|---|
| **Requestor** | Files requests, uploads docs, tracks status, resubmits if returned | Web portal |
| **Approver** | Reviews & decides Approve/Decline/Return (notified by email) | Web portal |
| **System** | Routes, sends emails, generates PDFs, runs scheduled reminders | Behind the scenes |
| **Admin** *(added later)* | Oversees all requests (read-only) + manages approver groups/chains | Admin console page |

> Admin is **not a third role** — it's an additive `isAdmin` flag layered on top of approver/requestor. See `02`.

## 2. Where it came from — the AppSheet origin (Carl's system)

The original was a **no-code AppSheet app** built by the previous intern, **Carl**. Key facts about the original (preserved for behavior parity):

- **Two AppSheet roles:** *Admin* (Edit app — manages the `Approver_Settings` table + sees all requests) and *User* (Use app — sees only their own requests).
- **Two core tables:** `Approver_Settings` (per-group chain: Group + Approver 1/2/3 emails & designations, slots 2–3 optional) and `Certificate_Requests` (the request rows). Plus `Request_Attachments`.
- **5 AppSheet "bots"** (automation): Next-Approver, Decline-Notification, Fully-Approved-Notification, Return-Notification, and a **Sync Finisher** bot that flipped a request out of a `"Syncing Files"` holding state once the attachment count met `Expected_Attachments`.
- **Email-embedded action cards:** approvers could Approve/Decline/Return *from inside the email*.
- **COC PDF** auto-generated and emailed on full approval.
- Original AppSheet links + the shared Google Sheet + the Drive folder (`1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y`) are recorded in `reference/E-Certificate Automation Documentation.md`.

Carl's original documentation is preserved at **`reference/E-Certificate Automation Documentation.md`** (his AppSheet guide) — useful for verifying behavior parity.

## 3. Why migrate — the goal

**Primary goal: UI/UX.** The business logic was already proven in AppSheet; the rebuild delivers a **custom Megaworld-branded web portal** that approvers and requestors actually enjoy using. Secondary motivations that justified *not* doing a 1:1 port (Kai's own framing to his supervisors):

- **Redundancy** — AppSheet hides a lot (computed columns, relationship lookups, bot triggers). Copying it 1:1 into Apps Script yields bloated, overlapping code.
- **Performance** — naïve ports (reading rows one-by-one, repeated sheet calls in loops) get slow as request volume grows.
- **Security** — AppSheet's built-in visibility/field-lock/action rules don't carry over; they must be deliberately rebuilt, or sensitive data (approver emails, org structure) leaks to anyone with the portal link.

This is why the rebuild was done in **structured phases & categories**, rebuilding each layer properly rather than transliterating AppSheet logic.

## 4. Deliberate design changes from AppSheet

| Area | AppSheet | This portal | Why |
|---|---|---|---|
| **Attachment flow** | Submit first, upload after; `"Syncing Files"` limbo until count met | **Upload BEFORE submit** (≥1 file required); files hit Drive only at submit, atomically | Cleaner state machine; no incomplete requests sitting in limbo; no honor-system `Expected_Attachments` |
| **Approval action** | Embedded in the email card | **Portal-only**; email is notification + deep-link | Better UX, cleaner audit trail, more secure (logged-in session vs interceptable email link) |
| **Required docs** | (none enforced) | Still none — "basta ≥1 supporting document" (supervisor-confirmed) | Original had no per-type enforcement; `productType` is free-text with no clean key |
| **Return flow** | Hard return to Approver 1 (Step→0, resubmit restarts at 1) | **Same** (retained) | Safer default; every approver re-sees the corrected request |
| **`"Syncing Files"` status** | exists | **Removed entirely** | Upload-before-submit made it obsolete |

## 5. The numbering scheme (Phases vs Categories)

Two parallel numbering systems are folded into one roadmap (`reference/ROADMAP.md` is the living status doc):

- **"Phases"** = the original migration plan (Phase 1 = column-map audit, Phases 2–7 = the working core port, Phase 8 = attachments, Phase 9 = COC PDF, Phase 10 = Miga art, Phase 11 = audit log, Phase 12 = final Miga polish).
- **"Categories"** = enhancement build rounds layered on the working portal (Cat 1 = data layer/resubmit tracking, Cat 2 = approver UX, Cat 3 = nav/dashboards/security, Cat 4 = email completeness).

There is no "Category 5" — after Cat 4 the work continued as named phases/features (redesign, normalization, expiry, admin, etc.).

## 6. Current as-built status (as of 2026-06-11, last COC session)

**✅ DONE (all committed; git branch clean at HEAD `47e18e4`):**
- Core AppSheet→Apps Script migration (Phases 1–7): login, file request, route through approvers, emails at each step.
- **Category 1** — data layer & resubmit tracking.
- **Category 2** — approver UX redesign (5-state approvers chain, resubmit banner, focused action mode).
- **Category 3** — role-based nav, filter/sort dashboards, **backend security hardening** (server-side auth on every sensitive callable).
- **Category 4** — notification completeness (7→12 emails), standardized format, portal deep-links.
- **Frontend redesign** — left sidebar, two-column detail, clickable stat cards, loading overlays, custom confirm modal.
- **Documentation pass** — all 21 files doc-commented to a Layman-first standard; project `CLAUDE.md` created.
- **Phase 9** — COC PDF generation + auto-attach on full approval + `COC_PDFs` logging.
- **Phase 8** — attachment upload-before-submit + private gated serving + resubmit re-upload + cycle grouping (#6).
- **Phase 10** — Miga mascot assets (interim art).
- **Schema normalization (big-bang)** — 35-col `Certificate_Requests` monolith → **8 normalized sheets** behind `Accessors.js`. Delivered Phase 11 (audit log) for free via `Activity_Log`.
- **Location dropdown** (predefined Megaworld properties + Other).
- **Contract-expiry indicator + 3-stage reminders (#10).**
- **Daily pending-approval reminder digest** (nudges current approvers).
- **Admin console (Tier 2)** — all-requests oversight + group/approver-chain CRUD + `Admins_Log` audit.
- **UI/UX finalization** — design-system refresh + **branded HTML emails** (`EmailHtml.js`) + enterprise **SaaS dashboard redesign** (hero cards, icon stat cards, client-side search + pagination) on a shared `UI.html` primitives file.

**⏳ PENDING:**
- **Phase 12 — final Miga art.** Externally blocked on licensed, transparent-background mascot images. Pure drop-in re-encode (no code change) — re-encode the 6 PNGs to `data:` URIs and swap into `MIGA_IMAGES`.
- **Go-live gate** (deliberately LAST) — migrate dev→Megaworld account, flip prod flags, swap Drive folder IDs + restrict them, publish `/exec`, seed `Admins`, create `Admins_Log` tab, run the 3 per-account trigger registrations. Full checklist in `08_GOTCHAS_AND_GO_LIVE.md`.

**⏸️ DEFERRED (post-go-live, optional):**
- Admin **Tier 3** (request intervention — force-approve / reassign / cancel-reopen). Unblocked by `Activity_Log` whenever wanted; deliberately held back as the riskiest auth surface.
- Read-only **Activity Timeline** UI and an in-portal `Admins_Log` viewer (the data already exists).

## 7. Dev environment & accounts

- **Stack:** Google Apps Script web app + Google Sheets backend, managed via **clasp + VS Code + GitHub** on Windows 11.
- **Dev account (entire build):** personal DLSU `kyle_justin_tan@dlsu.edu.ph`. Deployed web-app URL is a `script.google.com/a/dlsu.edu.ph/macros/s/.../exec`.
- **Test rig:** Kai seeded **5 groups G001–G005**, 2 approvers each. **G001 = Kai as requestor AND both approvers**, so he can run a full approval chain solo. (This single-account setup is a known source of "previously-approved note misfire" noise in testing — see `07`.)
- **Production target:** a Megaworld Workspace account with "Execute as: Me" (NOT execute-as-user — see `08`). Migration is the final go-live step.
