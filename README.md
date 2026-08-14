# Megaworld E-Certificate Portal (COC Automation)

Internal approval portal for Certificates of Completion. An employee files a request with
supporting documents, it routes through a sequential chain of up to three named approvers, and on
full approval the system generates a branded PDF certificate and emails it to the requestor.

Replaces a legacy Google AppSheet application. Built as a single Google Apps Script web app over
a 10-tab Google Spreadsheet, managed with clasp and VS Code.

---

## 📖 Start here: [`docs/manual/`](docs/manual/README.md)

| I want to | Read |
|---|---|
| File or approve a request | [Part 1: Using the portal](docs/manual/part-1-users.md) |
| Administer the portal | [Part 2: Administration](docs/manual/part-2-admin.md) |
| Take over the code | [Part 0](docs/manual/part-0-common.md), then [Part 3](docs/manual/part-3-developer.md) |
| Deploy to a new Google account | [`reference/GO_LIVE_RUNBOOK.md`](reference/GO_LIVE_RUNBOOK.md) |
| Test after a deploy | [`reference/TEST_SCRIPT.md`](reference/TEST_SCRIPT.md) |
| Change code without breaking things | [`CLAUDE.md`](CLAUDE.md) |

> 🚩 **If two documents disagree, [`docs/manual/part-0-common.md`](docs/manual/part-0-common.md)
> wins.**

---

## Repository layout

```
backend/        11 .js files — one shared Apps Script global scope
frontend/       15 .html files — SPA shell, pages, shared components
tools/          callable-surface.js  ⚠️ Node only; never pushed to Apps Script
docs/manual/    the user & maintenance manual (start here)
docs/archive/   superseded material, kept for history only
reference/      runbook, test script, audit report, as-built profile, roadmap
```

## Before every push

```bash
node tools/callable-surface.js
```

Exits non-zero if the public endpoint surface has drifted from the expected **27**. In Apps
Script every top-level function without a trailing underscore is an HTTP endpoint reachable from
any signed-in user's browser console, so this is a security check, not a style check. See
[Part 0 §0.6](docs/manual/part-0-common.md).

## Deploying

`clasp push` updates `/dev` only. Email deep-links point at the last **published** `/exec`, so
after pushing:

> Deploy → Manage deployments → edit the **existing** deployment → New version → Deploy

⛔ Never "New deployment" on a live app; it mints a new URL and every link in every email already
sent breaks.
