# Monthly Progress Report — August 2026

**Intern:** Kyle Justin Tan
**Program:** BS Information Technology, De La Salle University
**Project:** Megaworld E-Certificate (Certificate of Completion) Automation Portal
**Reporting period:** 1 to 14 August 2026
**Status:** Feature-complete, pending final verification and go-live configuration

---

## 1. Executive summary

The COC Portal is the replacement for the department's legacy Google AppSheet certificate workflow. It allows an employee to file a Certificate of Completion request with supporting documents, routes it through a sequential chain of named approvers, and on full approval automatically generates a branded PDF certificate and emails it to the requestor.

August was the **hardening and completion month.** Development of core functionality had concluded in prior periods; this period focused on closing the gap between "the system works" and "the system is safe to hand over to a company that will operate it without me."

Three bodies of work were delivered:

1. **Deployment readiness** — the system can now be migrated to a Megaworld-owned Google account without editing source code.
2. **Security and reliability hardening** — a full audit of the codebase, with every finding resolved rather than merely documented.
3. **Two final features** — a complete approval history visible to all parties, and per-item correction flagging on return.

**Quantitatively:** 7 commits, 32 files changed, approximately 6,500 lines added and 2,500 removed.

The remaining work is **verification and configuration**, not development. A consolidated test script and a go-live runbook have been prepared and handed over with the codebase.

---

## 2. Deliverables completed this period

### 2.1 Deployment and migration readiness

**Problem addressed.** Migrating the system to the company's Google account previously required editing Drive folder identifiers directly in the source code and redeploying. This is error-prone and leaves no separation between the program and its environment.

**Delivered.** A configuration resolver that reads settings from Apps Script's Script Properties panel first and falls back to values in source only when a property is not set. The company can now point the system at their own Drive folders through a settings screen, with no code change and no developer involvement. Deleting a property is a complete rollback.

A verification function (`_testConfig`) prints the resolved configuration and its source on demand, so a misconfiguration is diagnosed in seconds rather than by trial and error.

### 2.2 Access control

**Problem addressed.** The sign-in restriction was previously unset. In that state, the system would have admitted any Google account in the world, including personal accounts, if the deployment were ever misconfigured.

**Delivered.** An organization domain allowlist enforced server-side, independent of the deployment setting, so a misconfigured deployment cannot admit outsiders. The allowlist is deliberately kept in version-controlled source rather than a settings panel, because it is a security control and should be reviewable and diffable rather than silently editable.

A temporary maintainer-access entry is registered on a separate list, and the setup verification prints a warning on every run naming any temporary entry still active, so it cannot be forgotten at handover.

### 2.3 Application security audit and remediation

A full-repository security review was conducted and **every finding was resolved within the period.** The significant items:

**Public endpoint surface reduced from 118 functions to 27.** In Google Apps Script, every top-level function is callable directly from any signed-in user's browser console, regardless of whether the user interface exposes it. The system had 118 such functions, most of which were internal helpers never intended to be reachable. These were renamed to the private form, leaving 27 intentional endpoints, each of which resolves the caller's identity from the server session and authorizes before performing any action.

A static checker was written and committed to the repository that counts this surface and fails if it changes unexpectedly, so the property is enforced going forward rather than depending on reviewer memory.

**Spreadsheet formula injection closed.** Values written to a Google Sheets cell that begin with an equals sign are interpreted as live formulas rather than text. A request submitted with a crafted project title could therefore execute a data-retrieval formula under the privileges of any administrator who opened the spreadsheet. Every free-text field, file description, approver comment, and administrator input now rejects such values at the point of entry.

**Concurrent-write data corruption closed.** Two users submitting or resubmitting at the same moment could each compute the same next available row and overwrite one another's attachment records. The affected write paths are now serialized.

**A dormant duplicate notification path removed.** The codebase retained an inactive automation containing a complete second implementation of the notification system. It was one accidental configuration step away from sending duplicate emails attributed to the wrong sender. It was deleted along with other unreachable code.

**File access verified sound.** The document-serving endpoint was reviewed against the privilege-escalation pattern where a caller supplies an arbitrary file identifier. The design was confirmed safe: callers reference an attachment record, and the file location is resolved server-side from that record.

### 2.4 Performance and scalability

- A scheduled job was re-implemented from a quadratic scan to a single pass, removing a limit that would have caused the job to exceed the platform's execution time ceiling at roughly 1,450 accumulated records.
- Frequently repeated database reads are now performed once per operation instead of up to six times, through an execution-scoped caching layer with documented invalidation rules.
- Record lookup was changed from loading the entire table into memory to a server-side indexed search.

### 2.5 Feature: unified approval history

**Problem addressed.** The system recorded every action taken on a request permanently, but almost none of it was visible. A requestor could see only the occasions their request was sent back, and never learned who approved it or when. An approver saw only the current round. Notification emails showed only the latest round. Three people looking at the same request saw three different partial pictures.

**Delivered.** A single chronological history of every action from filing to completion, grouped by revision round, shown identically to the requestor, to every approver, and inside the notification emails. Daily digest emails deliberately retain a compact summary, because a full history per request would make a multi-request digest unreadable.

### 2.6 Feature: per-item correction flagging with editable resubmission

**Problem addressed.** When an approver returned a request, they could write only one general explanation. The requestor had to infer which of the twenty-odd fields was wrong. Worse, the requestor could not edit any field on resubmission; they could only attach additional documents. A wrong date could not be corrected through the portal at all.

**Delivered.** Approvers may now flag individual fields and individual documents when returning a request, each with its own explanation. The requestor sees those flags highlighted directly on the affected fields, consolidated in a summary panel, and itemized in their notification email. The resubmission screen is now a complete editable form, prefilled with current values. On resubmission, flags are automatically recorded as resolved while remaining permanently visible as history, and the next approver's notification states exactly which fields changed.

The approver group is deliberately excluded from the editable set, because the audit log records the responsible group for each action and permitting a mid-process change would make the audit record contradict itself.

### 2.7 Certificate generation

The certificate engine was rebuilt to generate the document directly in code rather than by filling a separate Google Docs template. The template was an external dependency with no version history, no review process, and a single careless edit could silently alter every certificate issued thereafter. Generating in code places the certificate's design under the same version control and review as the rest of the system.

---

## 3. Documentation produced

Documentation was treated as a deliverable in its own right, on the premise that the system will be operated and maintained by people who did not build it.

| Document | Purpose |
|---|---|
| `COC_SYSTEM_PROFILE.md` | Complete as-built description of the system, including an explicit section on its known weaknesses and limitations. Written to be read by someone with no prior exposure to the codebase. |
| `FINAL_AUDIT_REPORT.md` | The audit findings, what was fixed, what was deliberately deferred and why, and a prioritized plan for remaining work. |
| `TEST_SCRIPT.md` | A single continuous verification sequence covering every change, ordered for execution in one sitting rather than grouped by feature, so that a skipped step is visible. |
| `GO_LIVE_RUNBOOK.md` | The handover checklist: configuration values to change, scheduled jobs to register, and sheets to prepare on the company's account. |
| `CLAUDE.md` | The project's engineering conventions and the constraints that must not be violated by future changes. |
| Inline code documentation | Every file and every substantial function carries a plain-language explanation followed by a technical one, in a consistent house format. Non-obvious decisions record what the tempting alternative is and why it is wrong. |

---

## 4. Engineering practices applied

- **Verification appropriate to the platform.** Google Apps Script provides no test framework and no local runtime. Verification was performed by static parsing of every file, a committed checker for the public endpoint surface, and targeted offline test harnesses that exercised pure logic against mock data. Thirty distinct assertions were run this way across the approval history projection and the domain access gate.
- **Deliberate scope control.** Several recommended improvements were assessed and explicitly deferred with recorded reasoning rather than partially implemented. Deferring with a written rationale was treated as a valid outcome.
- **Frozen interface contracts.** The boundary between the server and the user interface was treated as immutable during internal restructuring, which allowed a substantial database normalization to be performed without rewriting the user interface.
- **Peer knowledge exchange.** A structured technical review was exchanged with the team maintaining a parallel internal system (DCS). Their findings were verified against this codebase rather than adopted on assertion; five of their eight priority recommendations were confirmed already satisfied or structurally inapplicable here, and the genuinely applicable remainder was added to the backlog with evidence.

---

## 5. Current status and remaining work

**Status: feature-complete, pending verification.**

All planned functionality is implemented, committed, and deployed to the development environment. The system has not yet completed an end-to-end verification run against live data, which is the single outstanding prerequisite before production use.

Remaining work, in order:

1. **Execute the consolidated test script** (estimated two hours) and resolve any defects it surfaces.
2. **Apply go-live configuration** on the company's Google account: production Drive folders, disabling the development email marker, restricting the domain allowlist to the company domain, preparing the database sheets, and registering the two scheduled jobs.
3. **Handover.** The documentation set above is written for this purpose.

One item is flagged for the department's decision rather than for development: what should happen to a request already in progress when its assigned approver leaves the organization. The recommended answer is a narrow, audited single-request reassignment rather than a general delegation feature, based on evidence from the parallel system that a general delegation feature was built and withdrawn as creating an accountability gap.

---

## 6. Reflection

The most useful lesson of this period was that **the defects that mattered produced no error message.** A configuration that silently admitted every domain, an audit trail that recorded events nobody could see, a duplicate notification path that was inactive only by accident, and a text field that could execute a formula. None of these would have appeared as a failure. Each returned a plausible, wrong, or incomplete result that looked correct.

This changed how I approach verification. Checking that code runs is not the same as checking that it does what its name claims. Most of the audit work this month consisted of asking, of each defensive default in the system, what conclusion a caller would draw if it silently returned nothing, and preferring a loud failure wherever that conclusion would have been wrong.

The second lesson was about the value of writing down reasoning rather than results. Several decisions this month were reversals or deliberate refusals to build something. Those are only defensible to the next maintainer if the reasoning is recorded next to the code, which is where the person about to undo it is actually looking.

---

*Prepared 14 August 2026.*
