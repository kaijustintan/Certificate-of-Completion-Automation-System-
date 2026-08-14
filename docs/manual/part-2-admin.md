# Part 2: Administration 🛠

> The Admin console and day-to-day operations. Shared concepts (the approval chain, config
> resolution, deployment, security) live in **[Part 0](part-0-common.md)**.
>
> Source: `backend/Admin.js`, `frontend/pages/Admin.html`.

---

## §2.1: Getting admin access

Admin is **not a role**. It is an allowlist: your email must appear in the **`Admins`** sheet
with `ACTIVE = TRUE`. Add a row, reload the portal, and an **Admin** link appears in the sidebar.

> 🚩 **There is deliberately no UI for managing admins.** The `Admins` sheet is edited by hand
> so an admin cannot mint another admin from inside the app. Granting admin requires access to
> the spreadsheet itself, which is a separate permission.

Every admin action re-verifies your identity server-side. Hiding the nav link is not the control.

---

## §2.2: What the Admin console does, and does not

The console is deliberately **oversight plus configuration**, not intervention.

| Can | Cannot |
|---|---|
| See every request in the system, read-only | Approve, decline or return on someone's behalf |
| Create, rename, activate and deactivate groups | Edit a request's contents |
| Edit approver chains | Delete a request |
| Open any request's detail and attachments | Manage the admin allowlist |

> ℹ️ **Force-approve and reassignment were deliberately not built.** An admin pushing a request
> through would break the meaning of the approval record: the certificate names approvers who did
> not actually approve. If an approver is unavailable, change the chain (§2.4) so the request
> routes to someone who is.

The console opens on two tiles: **View Records** and **View Groups**.

---

## §2.3: Records

Every request in the system, with search, status filter and sort. Click any row to open it
read-only, including attachments and the full history.

> ℹ️ Your back link from a request opened here returns you to **Records**, not to your own
> dashboard.

Admin read access is read-only *by construction*, not by hiding buttons: the resubmit panel is
owner-gated, the decision panel is current-approver-gated, and both handlers re-verify on the
server.

---

## §2.4: Groups and approver chains

A **group** is a named approver chain. A request picks a group at filing time and follows that
group's chain.

### Creating and editing groups

Create, rename, deactivate and reactivate from **View Groups**.

> ℹ️ **Deactivating a group is routing-safe.** It only removes the group from the new-request
> dropdown. Requests already in flight keep flowing through it. This is intentional: pulling a
> group out of circulation should not strand the requests inside it.

### Editing a chain

Open a group and edit its slots in order. Rules the console enforces:

| Rule | Why |
|---|---|
| **1 to 3 approvers** | The routing engine only handles three positions (Part 0 §0.3) |
| **Valid, unique emails** | The same person twice means they approve the same request twice, which is not a control |
| **Cannot shrink below an in-flight step** | See below |

**Removing a slot is a soft-remove.** It greys out with an **Undo** and only commits on Save, so
a misclick or a rejected save does not lose your work.

> 🚩 **The shrink guard.** If any pending request in that group is currently sitting at a step
> beyond your new chain length, the save is **rejected** and the error names the blocking control
> numbers. Without this, that request would vanish from every pending list permanently, with no
> error and nobody assigned.

> 🚩 **A reorder or an email change writes no new rows.** The k-th existing slot is reused for
> the k-th new one, so the underlying IDs stay stable and history keeps resolving. Only shrinking
> leaves a deactivated row behind.

### Who gets emailed when a chain changes

Not everyone in the chain: **whoever newly becomes the current handler of an in-flight request**,
plus anyone newly added.

The console captures each pending request's current approver before the change and compares
after. So:

| Change | Email sent? |
|---|---|
| Reorder that moves someone to the front of a pending request | **Yes** — they hold it now |
| Replacing the approver at an occupied step | **Yes** |
| Adding a new approver who immediately holds something | **Yes**, listing what they now hold |
| Changing only a designation | **No** |
| Creating, renaming, activating, deactivating a group | **No** |

The email tells an existing approver their position changed ("you were Approver 2, you are now
Approver 1") rather than pretending they are new.

> ℹ️ **Removed approvers are not emailed.** That was a deliberate decision: the approver
> themselves normally requests the move, so telling them is redundant.
>
> **Requestors are not emailed either.** Instead, in-flight requestor emails carry a standing
> note that approvers may change and to check the portal for the current handler.

### Audit

Every group and chain change is written to **`Admins_Log`**, with a before-and-after diff of the
chain. It is append-only and separate from the request timeline, because admin actions are
config-scoped and must not pollute a request's approval history.

---

## §2.5: Editing the Location dropdown

The Location options on the request form come from the **`Locations`** sheet, not from code.

| Column | Meaning |
|---|---|
| `name` | The option text, exactly as it will be stored and printed on the certificate |
| `active` | `FALSE` hides the option. Anything else shows it |

Row order is dropdown order. Add a row to add an option; set `active` to `FALSE` to retire one.
Changes appear the next time someone opens the form. **No developer and no redeploy needed.**

> ℹ️ **Retiring an option never breaks old requests.** A request stores the location *text*, not
> a reference, so an existing request keeps showing what was chosen at the time. If someone
> resubmits a request whose location is no longer in the list, the form keeps it via the **Other**
> free-text path rather than blanking it.

**"Other" is not in the sheet.** The form always appends it, with its free-text box, so users are
never stuck when a site is missing.

---

## §2.6: Scheduled jobs 🛠

Two daily jobs, both around 8am. **Both must be registered once per Google account** by running
them from the Apps Script editor. A code push does **not** create them.

```
registerExpiryTrigger
registerApproverReminderTrigger
```

Afterwards the Triggers page should show **exactly two**, both Time-based:
`checkContractExpiries` and `checkPendingApprovals`.

> ⚠️ **If a third trigger named `onSheetChange` appears, delete it.** That function no longer
> exists in the code. A leftover registration fires on every spreadsheet edit and fails every
> time, generating failure emails.

### Approver reminders: 7 days, then every 3

An approver holding a request is reminded after **7 quiet days**, then every **3 days**
(days 7, 10, 13, …) until they act. One digest per approver, listing everything waiting on them.

The clock is "days since the last workflow action on that request", so any activity resets it.
There is no stored reminder state: the schedule plus the date arithmetic *is* the guard. A missed
run simply skips that day.

To change the cadence, edit `REMINDER_FIRST_AFTER_DAYS` and `REMINDER_REPEAT_DAYS` in
`backend/Triggers.js`. They are source constants on purpose: a policy knob belongs in version
control where a change is reviewable.

### Contract expiry reminders

For **Fully Approved** requests, the requestor is emailed 3 days before the contract end date, on
the day, and once after it has passed. Each stage is sent once, tracked by a flag in the activity
log so a manual re-run never double-sends.

---

## §2.7: Routine tasks 🛠

| When | Do |
|---|---|
| An approver joins or leaves | Update the group chain (§2.4). Do **not** edit `Group_Approvers` by hand; the console's guards exist for good reasons |
| A new site opens | Add a row to `Locations` (§2.5) |
| A new admin is needed | Add a row to `Admins` with `ACTIVE = TRUE` |
| After any code change | Republish the deployment (Part 0 §0.4). A push alone changes nothing users see |
| Monthly | Skim Apps Script **Executions** for failures. Email sends fail *quietly* by design, so this is where they surface |
| Monthly | Confirm both Drive folders are still **Restricted** |

---

## §2.8: Troubleshooting 🛠

| Problem | Cause / fix |
|---|---|
| The Admin link does not appear | Your email is not in `Admins`, or `ACTIVE` is not `TRUE`. Check for typos and stray spaces |
| A group does not appear in the new-request dropdown | It is inactive, **or** it has no active approver. A chain-less group is hidden from requestors so nothing routes into a void. It still shows in admin, flagged "no chain" |
| Saving a chain is rejected for duplicate emails | The same person appears twice. This is enforced; remove the duplicate |
| Saving a chain is rejected naming control numbers | The shrink guard. Those requests sit at a step your shorter chain would delete. Let them finish or lengthen the chain |
| A new Location does not show | Check `active` is not `FALSE`, and reload the form. Requests already open in a tab keep the old list |
| Reminders are not arriving | Check the Triggers page shows both jobs. They are per-account and are not created by a code push |
| Reminders arrive on the wrong days | The project timezone is not `Asia/Manila`. Fix it in the manifest; the cadence is date arithmetic |
| A user says their certificate never arrived | Check Executions. Email sends fail soft, so a quota or address problem shows there, not in the UI |
| A request is stuck with nobody able to action it | Almost certainly a `sequence = 4` row added directly to `Group_Approvers`. See Part 0 §0.3 |
| Uploads fail with a permissions error | The Drive folder IDs point somewhere this account cannot write. Run `_testConfig` and check they resolve to the right folders |

---

*← [Part 1: Using the portal](part-1-users.md) · Next: [Part 3: Developer handover](part-3-developer.md) →*
