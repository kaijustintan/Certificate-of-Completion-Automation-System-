# Archive

> ⛔ **Nothing here describes the current system.** These documents are kept for history, not for
> reference. For accurate documentation see [`docs/manual/`](../manual/README.md).

Consulting these as documentation will mislead you. They describe removed features, superseded
counts, and at least one deleted subsystem.

| Item | What it was | Why it is wrong now |
|---|---|---|
| `migration-context/` | A nine-file context pack written to hand project state between development sessions. A working artifact, never intended as documentation. | Describes an 8-tab database (now 10), 31 callables (now 27), and the deleted `onSheetChange` trigger family as live. |
| `AppSheet-era User Guide.md` / `.pdf` | The user documentation for the **AppSheet application this portal replaced.** | Documents a different system entirely. Genuinely useful for understanding what the migration changed; useless as a guide to the portal. |

## Why keep them

Deleting history is worse than labelling it. The AppSheet guide is the only surviving record of
what the previous system did, which is what makes the migration's decisions legible. The context
pack records why several architectural choices were made.

The design decisions taken against the AppSheet system are summarized in
[`reference/ARCHITECTURE.md`](../../reference/ARCHITECTURE.md) §2 and §8, which **is** current.
