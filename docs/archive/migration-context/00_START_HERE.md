# 00 · START HERE — Portable Context Pack for the Megaworld COC Automation Project

> **What this is.** A self-contained knowledge pack so a **fresh Claude account with zero memory** can pick up the *megaworld-COC-automation* project and understand it cold — the system, the architecture, every major decision and *why* it was made, the bugs that shaped the code, and exactly where the work was left off. It was generated on **2026-06-30** by mining the project's on-disk reference docs **and** ~13 past Claude Code session transcripts (late-May → 2026-06-11).
>
> **Why it exists.** Kai (the developer) is migrating to a new Claude account before his subscription lapses. The *code* lives in git, but the *conversation history* — the decisions, dead-ends, and reasoning — does not travel with the repo. These files capture that.

---

## How to use this pack (for the new Claude)

1. Read this file, then **`01_PROJECT_OVERVIEW.md`** for the what/why.
2. Before touching code, read **`02_ARCHITECTURE_AND_CONVENTIONS.md`** and **`03_DATA_MODEL.md`** — they contain hard contracts that, if violated, silently break routing/auth/history.
3. For "why is it built this way?", **`05_FEATURES_AND_DECISIONS.md`** is the decisions log; **`07_SESSION_HISTORY.md`** is the chronological story with bug war-stories and reversals.
4. Before any deploy, read **`08_GOTCHAS_AND_GO_LIVE.md`**.
5. This pack is *knowledge*, not source. The actual code is on disk and in git — read the real files (`backend/*.js`, `frontend/*.html`) for current line-accurate implementation. Where this pack cites `file:function`, the **function names are stable**; line numbers may have drifted.

## File manifest

| File | Contents |
|---|---|
| `00_START_HERE.md` | This file — orientation, Kai's profile, working preferences |
| `01_PROJECT_OVERVIEW.md` | What the system is, AppSheet origin, migration goal, actors, current status |
| `02_ARCHITECTURE_AND_CONVENTIONS.md` | Stack, one-global-scope, Accessors seam, frozen DTO, routing, roles, frontend patterns, deploy model |
| `03_DATA_MODEL.md` | The 8 normalized sheets (full column maps), enums, cache-vs-truth, the normalization story |
| `04_WORKFLOWS_AND_FLOWS.md` | Request lifecycle, the 9 operation flows, the 3 repeating code patterns |
| `05_FEATURES_AND_DECISIONS.md` | Every feature/phase with the WHY + rejected alternatives (the decisions log) |
| `06_EMAIL_AND_COC.md` | Email system + COC PDF generation + full COC template spec (rebuildable) |
| `07_SESSION_HISTORY.md` | Chronological session-by-session narrative + bug war-stories + key reversals |
| `08_GOTCHAS_AND_GO_LIVE.md` | All frozen contracts/gotchas + production checklist + exact "where I left off" |

---

## Who Kai is (the developer)

- **Kai Justin Tan** — BS Information Technology, De La Salle University (DLSU). Filipino; mixes English + Tagalog ("Taglish") naturally in casual explanation (yung, kasi, naman, diba).
- Led the backend on **ChainCert** (a blockchain credential platform on Hyperledger Fabric 2.5.14) — his capstone. He frequently references ChainCert's `index.js` chaincode as the gold standard for documentation style. (That capstone lives in a *separate* project, `CAP-2459-IT-AFTER-RESET` — **not** part of this pack.)
- This COC portal is an **internship project at Megaworld** (the Philippine real-estate company). Kai inherited it from a previous intern, **Carl**, who built the original AppSheet version.
- Works in **VS Code on Windows 11**, with WSL2 Ubuntu available. Dev account during the whole build was his **personal DLSU account** (`kyle_justin_tan@dlsu.edu.ph`); production will run under a **Megaworld Workspace account** (migration is the deliberate last go-live step).
- Supervisors he reports to: **Sir Darwin** and **Miss Christine** (he sends them weekly progress reports). **Sir Sam** is the ISM (Information Security Management) head tied to a *separate* deliverable (a Security Awareness Video series — not part of this project).

## How Kai likes to work (preferences that shaped these sessions)

- **Direct, no padding.** No "Great question!" sycophancy. Push back when he's wrong; do an honest re-evaluation rather than capitulating or stubbornly digging in. Show the trade-off, let him decide.
- **Ask clarifying questions when ambiguous** — a 30-second clarification beats 30 minutes of wrong work. Don't silently guess; state the ambiguity and propose the safest interpretation. He answered most forks via `AskUserQuestion` menus, and the "(Recommended)" option was usually picked.
- **"Do not deviate without asking first."** When he hands a prescribed code snippet, review it against the *real* code, flag conflicts, and wait for approval before adapting. (He often pasted plans/snippets that referenced classes/columns that didn't exist — see `07_SESSION_HISTORY.md`.)
- **Documentation standard: Layman (casual Taglish "Tropang Ex") FIRST, then Technical.** This applies to code doc-comments AND to every explanation. For multi-concept topics he likes a "Q&A logical sequence" (outline of questions → answer each → takeaway + bridge to next).
- **Commit discipline:** 1–2 features MAX per commit; if a session did 3+ distinct things, propose a split. At every commit boundary give: (1) a conventional commit message, (2) a **layman description**, (3) a **technical description**, then **proceed immediately to the next chunk without waiting** (he commits asynchronously while Claude keeps working). *He never lets Claude run git itself — reminder only.* (In practice he often overrode the split and squashed into one commit anyway — but always wanted the layman+technical write-up.)
- **Friction-earned escalation / conservative on changes.** Don't over-engineer. Smallest safe change that fully solves the task. Preserve working behavior. Reuse existing components/utilities/patterns before creating new ones. Don't refactor unrelated code; don't invent requirements.
- **Model habits:** Opus for planning/architecture/hard debugging; Sonnet for execution (the default ~80%); Haiku for quick lookups; Fable for big multi-file autonomous runs. He likes a one-line "💡 Suggested model" at the start of a session.

---

## The 60-second project summary

The **E-Certificate / Certificate-of-Completion (COC) portal** is a multi-level approval workflow for Megaworld's IT certificate requests (software licenses, hardware, service contracts, renewals). A requestor files a request with supporting documents; it routes through up to 3 sequential approvers; emails fire at every state change; on full approval a **COC PDF is auto-generated and emailed**. It is a **migration from a no-code AppSheet app** (built by the prior intern, Carl) **to a custom Google Apps Script web app** backed by Google Sheets — the explicit goal being **far better UI/UX**, not new business logic.

**Current state (2026-06-11, the last COC session):** Functionally complete and live-verified on the dev account. Done: core migration, enhancement Categories 1–4, a full SaaS-grade frontend redesign, branded HTML emails, COC PDF generation (Phase 9), private gated attachments + resubmit re-upload (Phase 8), a big-bang **database normalization** (35-col monolith → 8 purpose-built sheets), contract-expiry reminders (#10), daily pending-approval reminders, and an in-portal **Admin console (Tier 2)**. All committed (git branch clean). **Pending:** Phase 12 (final Miga mascot art — externally blocked on licensed/transparent assets, pure drop-in) and the **go-live gate** (migrate to a Megaworld account, flip prod flags, swap Drive folders, register triggers). See `08_GOTCHAS_AND_GO_LIVE.md`.

> **One thing to internalize first:** Apps Script can't run locally. Claude **cannot execute or test** this code — only Kai can, via `clasp push` → the `/dev` URL. Every "verified" claim in history means *Kai* tested it in the browser. And `clasp push` ≠ publish: deep-links use the `/exec` URL which serves the last *published* version.
