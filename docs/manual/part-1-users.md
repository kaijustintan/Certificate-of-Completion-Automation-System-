# Part 1: Using the portal 🧑

> For requestors and approvers. Shared concepts (the approval chain, what a return means, status
> vocabulary) live in **[Part 0](part-0-common.md)**; this part covers only what you do on screen.
>
> One person is often both: you file your own requests **and** approve other people's. The portal
> shows you both, so this part covers both.

---

## §1.1: Signing in

Open the portal link and sign in with your **Megaworld Google account**. Personal accounts are
blocked before any page loads.

What you land on depends on who you are:

| You are | You land on | You see |
|---|---|---|
| Not an approver | **My Requests** | Everything you have filed |
| An approver in any group | **My Approvals** | Your queue, plus your own requests under My Requests |
| Also an admin | Same as above | Plus an **Admin** link in the sidebar |

> ℹ️ Being an admin does not change your role. If you are an approver and an admin, you are still
> an approver everywhere except the Admin page.

---

## §1.2: Filing a request 🧑

Click **New Request**. Every field has a small **?** beside its label; hover or tap it for a
one-line explanation of what belongs there. Fields marked with a red asterisk are required.

### Request information

| Field | What to enter |
|---|---|
| **Project title** * | The project or engagement this certificate covers, as it should appear on the certificate |
| **Approver group** * | The chain that will review this. Pick the group your project falls under |
| Requestor designation | Your job title |
| **Accountable person** * | Whoever is answerable for the product or contract |
| **Department** * | The department that owns it |
| **Location** * | The site where the product is deployed. Pick **Other** to type one not listed |
| **PC name** * | The workstation or server it is installed on. `N/A` if not tied to a machine |

### Reference numbers

PRISM and IHelp number are optional. **Purchase Order** and **Supplier name** are required.

### Product and contract

Product type, product name, type of purchase, type of licence, and the contract start and end
dates are all required.

> ⚠️ **The contract end date matters after approval.** It drives the expiry reminders you will
> receive as the contract lapses, and the "Expired" chip on your request. Enter the real end date.

### Purpose

A short statement of why you need the certificate. This now appears in **every notification
email**, so approvers see it without opening the portal. Write it for them.

### Supporting documents *

At least one document is required.

| Limit | Value |
|---|---|
| Accepted types | PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG |
| Max per file | 5 MB |
| Max total | 15 MB |
| Max files | 10 |

**Each file needs a short description.** That description is what an approver reads in the email
before deciding whether to open the file, so "PO scan" beats "document1".

> 🚩 **A file with the wrong contents is rejected even if the name looks right.** The portal
> checks the file's actual bytes, not its extension, so a `.txt` renamed to `.pdf` is refused on
> submit with a message naming the file.

Click **Submit request**. You get a control number (e.g. `EC-2026-00001-A6A`) and Approver 1 is
emailed immediately.

---

## §1.3: Tracking your request 🧑

**My Requests** lists everything you have filed, with a status badge, and search and filters
across control number, project, group and requestor.

| Badge | Meaning | What you do |
|---|---|---|
| **Pending Approver 1 / 2 / 3** | Sitting with that approver | Wait. They are nudged automatically |
| **Fully Approved** | Done. Certificate issued | Check your email for the PDF |
| **Returned to Requestor** | Needs correction | **Your turn.** See §1.4 |
| **Declined** | Terminal rejection | File a new request; this one cannot be revived |
| **Expired** *(chip)* | The contract end date has passed | Shown *beside* the status, not instead of it |

Open any request to see everything you submitted, your attachments, the approver chain with each
person's current state, and **Request History**.

### Request History

The full story of the request from filing to now: who approved and when, any comment they left,
every return with its reason, and every resubmit with a summary of what you changed.

**Your approvers see exactly this same list.** There is no separate internal version.

> ℹ️ A brand-new request shows one line, not a timeline. Cycle headings ("Original submission",
> "Resubmit #1") only appear once the request has actually been through a resubmission.

### Viewing your documents

Press **View** on any attachment. It opens in a new tab.

> ℹ️ **If nothing opens, your browser blocked the pop-up.** The file downloads instead, so you
> still get it. Allow pop-ups for the portal to get the preview back.
>
> Documents are never exposed as shareable Drive links. Every view is checked against your
> identity server-side, so forwarding an approval email does not leak the attachments.

---

## §1.4: Fixing a returned request 🧑

A return is **not** a rejection. It means an approver needs something corrected.

You will get an email with the reason, and if the approver marked specific items, an itemized
list of exactly what to fix. Open the request from **My Requests** (amber "Returned" badge).

**What you see:**

1. An amber banner with who returned it and why.
2. A **"What needs fixing"** card listing each flagged field or document, its comment, and
   **which approver raised it** ("Flagged by Approver 2").
3. The request itself, now as a **fully editable form** with your current values prefilled.
   Flagged fields are highlighted amber with the comment pinned underneath.

**Everything is editable except the approver group.** If the group itself is wrong, that request
cannot be salvaged; ask the approver to decline it and file a new one. *(The group is recorded on
every action already taken, so changing it mid-history would make the record contradict itself.)*

**Documents:** the files already on the request are shown in the form, with any flagged one
highlighted. Below them is **"Add corrected or missing documents"**.

> 🚩 **You cannot delete a document; you add a corrected one.** Both versions stay on the record,
> grouped by round. This is deliberate: if a flagged file could vanish, the flag would point at
> something nobody can see and the audit trail would lose what was objected to.

Click **Resubmit request**.

> 🚩 **Resubmitting sends the request back to Approver 1**, not to whoever returned it. The whole
> chain reviews it again. Approvers who already approved will be asked again, and they are told
> the request was returned in the meantime.

The next approver's email carries a **"What changed"** line listing the fields you edited, so
they are not re-reading the whole request looking for a difference.

---

## §1.5: Reviewing a request (approvers) 🧑

**My Approvals** shows your queue. Requests waiting on you appear under **Awaiting your action**;
everything you have already decided is under **Actioned**.

Open one. You see the full request, its attachments, the approver chain, and the same **Request
History** the requestor sees, including any comments from approvers before you.

You have three decisions.

### Approve

Opens a panel with an **optional comment** box. Leave it blank to simply approve, or add a note
for the record. That comment appears in the request history for the requestor and for every
approver after you, so it is a good place for "checked against PO, figures match" or a
qualification you want recorded.

The panel tells you whether you are the final signatory. If you are, approving issues the
certificate immediately.

### Return to requestor

For anything fixable. Requires a **reason of at least 20 characters** explaining what is wrong.

**Optionally flag specific items.** Expand **"Flag specific items"** and tick any field or
document that needs correcting; each tick asks for its own short comment. The requestor sees
those flags highlighted directly on the affected fields and listed in their email.

> 💡 **Flagging is worth the extra few seconds.** Without flags the requestor gets one paragraph
> and has to guess which of twenty fields you meant.

The confirm button stays disabled until the reason and every flag comment are filled.

### Decline

**Terminal.** The request is closed and cannot be resubmitted; the requestor must file a new one.
Requires a reason of at least 20 characters, which is sent to them.

> ⚠️ **Use Return, not Decline, for anything correctable.** Decline is for requests that should
> not have been filed at all.

### If you are not the current approver

You can still open and read the request, but the decision panel is replaced by a notice saying
whose turn it is. Approvers act in sequence; you cannot approve ahead of your turn.

---

## §1.6: Reminders and expiry emails 🧑

**If you are an approver** and a request sits with you without action, you get a reminder after
**7 days**, then every **3 days** until you act. Reminders are bundled: one email listing
everything waiting on you, not one per request.

**If you are a requestor** and your approved contract is lapsing, you get an email 3 days before
the end date, one on the day, and one after it has passed. These are renewal nudges; the portal
does not renew anything automatically, and a renewal is filed as a new request.

---

## §1.7: Troubleshooting 🧑

| Problem | What to do |
|---|---|
| "Not authorized" / cannot sign in | Use your Megaworld account, not a personal one. Try an incognito window if you are signed into several. |
| A file was rejected on submit | Check the type and that it is under 5 MB. A file renamed to `.pdf` that is not really a PDF is refused. |
| The Location I need is not listed | Pick **Other** and type it. Ask an admin to add it permanently. |
| "New Request" shows "No approver groups available" | No group has an approver configured yet. Contact an admin; this is a setup gap, not your error. |
| Pressing **View** does nothing | Your browser blocked the pop-up; the file downloaded instead. Allow pop-ups for the portal. |
| I cannot approve, the buttons are missing | Either it is not your turn, or the request already moved on. The panel says which. |
| The confirm button stays greyed out | Return and Decline need a 20-character reason. If you ticked flags, every flag needs a comment too. |
| I approved but nothing seems to have happened | If you were the final approver it is now Fully Approved and the certificate has been emailed. Check My Approvals → Actioned. |
| I never got my certificate | Check spam. If the request shows Fully Approved but no email arrived, tell an admin: the send fails quietly by design and is visible in the execution logs. |
| My request says "Expired" | The contract end date has passed. The certificate is still valid as a record; file a new request to renew. |

---

*← [Part 0](part-0-common.md) · Next: [Part 2: Administration](part-2-admin.md) →*
