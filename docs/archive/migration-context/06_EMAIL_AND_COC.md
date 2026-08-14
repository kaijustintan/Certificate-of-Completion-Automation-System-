# 06 · Email System + COC PDF Generation

---

# PART A — The Email System

## A1. Core rule: dual-format via `sendBrandedEmail`

Every email goes through **`sendBrandedEmail(recipient, subject, textBody, htmlBody, extraOptions)`** (`backend/EmailHtml.js`) — **never** `GmailApp.sendEmail` directly. The plain-text body (3rd arg) is the **fallback and the source-of-truth copy**; the branded HTML twin rides in `options.htmlBody`. PDF attachments and other options go in `extraOptions`.

> Internally: `sendBrandedEmail` → `GmailApp.sendEmail(recipient, subject, textBody, { htmlBody, attachments, ... })`. `GmailApp` sends **as the script owner** — so in production the official COC emails come from the **Megaworld service account**, not the intern's personal account.

## A2. The HTML layer — `backend/EmailHtml.js`

Table-based, inline-styled (email-client-safe), 600px centered. Helpers:
- `emailLayout({accent, bodyHtml, buttonUrl, buttonLabel})` — the wrapper, with a **per-status accent band**: navy = action-needed, green = approved, red = declined, amber = returned/expiry.
- `emailButton` — **always navy** (the band carries the status signal; the CTA never does).
- `emailInfoTable` / `emailSection` / `emailKeyValueRows` / `emailAttachmentList` / `emailApprovalLog` / `emailRemarkBox` / `emailDivider`.
- **`escapeHtml()`** — a **server-side** escaper (distinct from the frontend one — different runtimes). **Every `email*` helper escapes its own inputs**; any value interpolated directly into HTML must be escaped at the call site.

## A3. Conventions

- **Subject:** `emailSubject(controlNumber, statusLabel, audience)` → `[COC Request]: <ctrl> | <Status>`. While `EMAIL_DEV_TAG = true`, a `[FOR APPROVER]` / `[FOR REQUESTOR]` audience tag is prepended (Kai tests with one email). **Flip `EMAIL_DEV_TAG` to `false` before go-live** (in `Emails.js`).
- **Body shape:** greeting → `buildInfoBlock(rowData)` (labeled Title/ID/Requestor/Group) → sections → `getPortalUrl(requestId, page)` deep-link.
- **Deep-links use query params** (`?page=review&id=XXX`), not hash fragments. `getPortalUrl()` uses `ScriptApp.getService().getUrl()` → the `/exec` URL (last *published* version — republish after each deploy).
- **`REQUESTOR_PORTAL_NOTE`** — a standing line appended to in-flight requestor emails ("approvers may change — check the portal for the current handler"), so requestors don't follow up with a replaced approver instead of per-change emails.
- **N-of-M in emails uses `approvedCount`, not Step** (blank-slot skipping).

## A4. The 15 emails (built up 7 → 12 → 15)

| # | Function (`Emails.js`) | Fires on | To |
|---|---|---|---|
| 1 | `sendApprovalRequest` | submit / advance | next approver |
| 2 | `sendApproveConfirmToApprover` | approve (intermediate) | acting approver (receipt) |
| 3 | `sendProgressUpdateToRequestor` | approve (intermediate) | requestor ("cleared N of M") |
| 4 | `sendFullyApprovedToApprover` | final approve | final approver |
| 5 | `sendFullyApprovedToRequestor` | final approve | requestor (**COC PDF attached** — `generateCOC` hooked here) |
| 6 | `sendDeclineToApprover` | decline | acting approver (receipt) |
| 7 | `sendDeclineToRequestor` | decline | requestor (reason + "Approver N (email)") |
| 8 | `sendReturnConfirmToApprover` | return | acting approver (receipt) |
| 9 | `sendReturnToRequestor` | return | requestor (reason + which approver) |
| 10 | `sendReturnedChainNotification` | return | prior approvers who'd already signed |
| 11 | `sendResubmitConfirmToRequestor` | resubmit | requestor |
| 12 | `sendResubmitApprovalRequest` | resubmit → A1 | Approver 1 (carries prior return reason) |
| 13 | `sendExpiryReminderToRequestor` | daily expiry sweep | requestor (3 stages) |
| 14 | `sendPendingApprovalReminder` | daily nudge | current approver (digest of all their pending) |
| 15 | `sendNewApproverNotice` | admin chain change | newly-current approver (add vs reorder wording) |

All 15 were converted to dual-format (plain-text fallback + branded HTML twin) in the UI/UX finalization session. Special cases handled: COC PDF attachment (#5), digest (#14), new-approver notice (#15).

---

# PART B — COC PDF Generation (Phase 9)

> Authoritative repo record: **`reference/COC_TEMPLATE_SPEC.md`**. This section reproduces it so the template can be **rebuilt from scratch** if the Google Doc is ever lost (the Doc layout is NOT version-controlled — that was the accepted trade-off of choosing a hand-built template).

## B1. How it works

`generateCOC(requestId)` (`backend/Certificate.js`), called from `sendFullyApprovedToRequestor` in try/catch:
1. Guard that `COC.TEMPLATE_DOC_ID` is set.
2. `getRequestRowData(requestId)` (the 25-col `Requests` row) + `getApprovers(group)` (signatory names/designations) + `getApprovalView(requestId).byStep[n].date` (approver action dates — these are NO LONGER request columns post-normalization).
3. `DriveApp.getFileById(TEMPLATE).makeCopy("COC - <ctrl>")` → `DocumentApp.openById()`.
4. `body.replaceText(token, value)` for every token (escaping `{`/`}` since `replaceText` is regex-based).
5. Clear unused Approver 2/3 signatory cells (the **last table** in the Doc; cells `(0,2)`/`(0,3)`) — driven by **approver presence, not step** (respects blank-slot skipping). Clears BOTH the label row and value row of the unused column.
6. Export `getAs("application/pdf")` → archive to `COC.ARCHIVE_FOLDER_ID` → delete the temp Doc copy.
7. Append a row to `COC_PDFs` → return `{success, url, fileId, pdfBlob, fileName}`.

**Dual-token matching:** the generator matches BOTH legacy AppSheet `<<…>>` expressions (the as-built default — the Doc was built by recreating the AppSheet template verbatim) AND clean `{{tokens}}` (used to fix cells whose long AppSheet expression broke across a hard line break — `replaceText` can't match across a paragraph break; short `{{tokens}}` never wrap).

## B2. Config (`Constants.js` `COC.*`)

- `COC.TEMPLATE_DOC_ID` — the Google Doc template ID (44 chars — **a double-pasted 88-char ID throws a misleading "Unexpected error while getting the method or property" — that wording is a malformed ID, not necessarily a scope problem**).
- `COC.ARCHIVE_FOLDER_ID` — **currently a DEV folder**; production folder is `1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y` (the executing account must have read on the template Doc + write on the folder).
- `COC.ATTACHMENTS_FOLDER_ID` — separate folder for supporting docs (Phase 8).
- `appsscript.json` declares explicit `oauthScopes`: spreadsheets, drive, documents, `mail.google.com`, userinfo.email, script.scriptapp.

## B3. Hard build requirements (the code depends on these)

1. **Placeholder spelling is a contract** — each token typed EXACTLY (case-sensitive, double braces, no inner spaces: `{{control_number}}` not `{{ control_number }}`). A typo → a blank or a literal `{{token}}` in the PDF.
2. **The signatory area MUST be a 1-row × 4-column table** — the code hides unused approver columns by clearing a *table cell* (`getCell(0,2)`/`getCell(0,3)`). Tabs/spaces instead of a real table breaks the conditional hide.
3. The table is found by searching for the literal `{{approver1}}`, which must physically live in cell (0,1) of that table.

### Signatory table layout (1×4)
| Cell | Contents | Conditional? |
|---|---|---|
| (0,0) Prepared By | `{{requestor}}` / `{{requestor_desig}}` / Date: `{{prepared_date}}` | always |
| (0,1) Approved By | `{{approver1}}` / `{{desig1}}` / Signed: `{{app1_date}}` | always |
| (0,2) Approved By | `{{approver2}}` / `{{desig2}}` / Signed: `{{app2_date}}` | cleared if no Approver 2 |
| (0,3) Approved By | `{{approver3}}` / `{{desig3}}` / Signed: `{{app3_date}}` | cleared if no Approver 3 |

## B4. Token reference (token → source → port-logic)

**Header:** `{{group}}` (CR.GROUP 9) · `{{control_number}}` (CR.CONTROL_NUMBER 2) · `{{date_of_filing_long}}` (CR.DATE_OF_FILING 5, `"MMMM dd, yyyy"`) · `{{generated_at}}` (`new Date()`, PH time `"MMMM dd, yyyy hh:mm:ss a"`).

**Info block:** `{{project_title}}` (6) · `{{requestor}}` (7) · `{{requestor_desig}}` (8) · `{{accountable_person}}` (10) · `{{department}}` (11) · `{{location}}` (12) · `{{pc_name}}` (13).

**Item details:** `{{prism}}` (14, blank→"N/A") · `{{po_no}}` (15, blank→"N/A") · `{{ihelp}}` (16, blank→"N/A") · `{{product_type}}` (17) · `{{product_name}}` (18) · `{{type_purchase}}` (19) · `{{type_license}}` (20) · `{{contract_period}}` (CR.CONTRACT_START 21 + CR.CONTRACT_END 22, `"MMM dd, yyyy"` joined `" - "`, blank→"N/A") · `{{supplier}}` (23) · `{{requestor_remark}}` (24).

**Signatory:** `{{prepared_date}}` (CR.DATE_OF_FILING 5, `"MM-dd-yyyy"`) · `{{approver1/2/3}}` & `{{desig1/2/3}}` (`getApprovers(group)`; cells 2/3 cleared if null) · `{{app1/2/3_date}}` (`getApprovalView(requestId).byStep[n].date`, `"MM-dd-yyyy HH:mm:ss"`).

## B5. Rebuild steps (in Drive, by hand)

1. New Google Doc → recreate the certificate layout (title, info block, item table, remarks, signatory table) from the AppSheet screenshot ("Image 6" in Carl's doc).
2. Replace every dynamic value with its `{{token}}` (type exactly). Build the signatory area as a **1×4 table**.
3. Share the Doc so the executing account can read it; confirm the archive folder is writable.
4. Copy the Doc ID from the URL → paste into `COC.TEMPLATE_DOC_ID` in `Constants.js`.
5. `clasp push` → run `_testGenerateCOC("<existing requestId>")` in the Apps Script editor (it uses an in-file `TEST_REQUEST_ID` const — the Run button can't pass args) → open the logged PDF URL to verify.

## B6. Gotchas

- Dates come back as `Date` objects OR strings from the sheet — the formatter guards both, falls back to "N/A"/"".
- `replaceText` is regex under the hood (`{`/`}` are metacharacters — escaped in code via `coc_escapeToken_`). Don't add other regex-special chars to token names.
- Timezone is **`"Asia/Manila"`**, never `"GMT+8"`.
- Use **`clasp push -f`** for `appsscript.json` (clasp special-cases the manifest).
- No new data fields are needed for the COC — every token maps to a `Requests` column, the `getApprovers` join, or `getApprovalView` dates (the whole reason Template 1 was chosen).
