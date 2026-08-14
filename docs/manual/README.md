# Megaworld E-Certificate Portal: User & Maintenance Manual

**System:** COC Portal (Certificate of Completion) — Megaworld Information Systems Management
**Architecture:** one Google Apps Script web app over a 10-tab Google Spreadsheet
**Replaces:** a legacy Google AppSheet application (`reference/ARCHITECTURE.md` §2 and §8)
**Last updated:** 14 August 2026

---

The COC Portal is Megaworld's internal pipeline for issuing Certificates of Completion. An
employee files a request with supporting documents, it routes through a sequential chain of up
to three named approvers, and on full approval the system generates a branded PDF certificate
and emails it to the requestor.

This manual is **one document split across files** so each part stays readable and maps cleanly
to a chapter when exported to `.docx`. Everything shared across roles lives in **Part 0**; the
per-audience parts link back to it instead of repeating it.

> 🚩 **If two places disagree, Part 0 wins.**
>
> This rule exists because it was previously absent. The same fact lived in five documents and
> they drifted apart independently: three still described a background trigger that had been
> deleted, and two described a certificate engine that had been replaced. When you correct
> something, correct it in Part 0 and let the other parts link to it.

> **Legend:** 🧑 end-user · 🛠 admin · 👨‍💻 developer · 🚩 = do not break this / hard-won lesson.

---

## How to read this manual

- **Filing or approving a request?** Read **Part 0 §0.1** (what the portal is), then
  **[Part 1](part-1-users.md)**. That is the whole of what you need.
- **Administering the portal?** Read **[Part 2](part-2-admin.md)**, plus **Part 0 §0.4**
  (operations) and **§0.6** (security).
- **Taking over the code?** Read **all of [Part 0](part-0-common.md)**, then
  **[Part 3](part-3-developer.md)**. Budget an hour; §0.6 is the part that will save you.
- **Deploying to a new Google account?** `GO_LIVE_RUNBOOK.md` is the step-by-step. Part 0 §0.4
  explains *why* each step exists.

---

## Table of contents

### [Part 0: Common Reference](part-0-common.md) *(read first)*
- §0.1 What the portal is
- §0.2 Architecture & data model *(canonical 10-sheet schema)*
- §0.3 The approval chain, returns, and flags
- §0.4 🚩 Operations: deployment & configuration
- §0.5 🚩 Known gotchas & debugging
- §0.6 🚩 Security model
- §0.7 Glossary & status vocabulary

### [Part 1: Using the portal](part-1-users.md) 🧑
Requestors and approvers. Filing, tracking, resubmitting, reviewing, approving, returning.

### [Part 2: Administration](part-2-admin.md) 🛠
Admin console, groups and approver chains, locations, scheduled jobs, routine tasks.

### [Part 3: Developer handover](part-3-developer.md) 👨‍💻
Repo layout, frontend and backend architecture, frozen contracts, verification approach, debt.

### [Appendices](appendices.md)
A Changelog · B Testing & QA · C Security findings · D Certificate rendering

---

## Related repo docs (canonical sources)

This manual summarizes and links to these rather than duplicating them. When they disagree with
the manual, **these win for their own subject**, and the manual should be corrected.

| Doc | What it is |
|-----|------------|
| `reference/ARCHITECTURE.md` | Design decisions vs the AppSheet system this replaced (§2, §8) |
| `reference/GO_LIVE_RUNBOOK.md` | Step-by-step deployment to a new Google account |
| `reference/TEST_SCRIPT.md` | The full manual test pass, ordered for one sitting |
| `reference/FINAL_AUDIT_REPORT.md` | Security/performance audit: fixed, deferred, and why |
| `reference/COC_SYSTEM_PROFILE.md` | As-built profile written for an external reviewer |
| `reference/ROADMAP.md` | Living status of what is built and what remains |
| `CLAUDE.md` (repo root) | Engineering conventions; the rules a code change must not break |

> ℹ️ **`docs/archive/`** holds superseded material kept for history: the AppSheet-era user guide
> and the `migration-context/` pack that was written to hand context between development
> sessions. Nothing there describes the current system. Do not consult it as documentation.

---

*Authoring note: written in Markdown here (version-controlled); export to `.docx` for
stakeholder distribution when finalized.*
