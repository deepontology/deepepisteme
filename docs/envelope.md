# The claim envelope

Every claim-bearing record carries the same envelope: the fields that say
what kind of claim a record makes and what stands behind it. `createEngine`
applies it at parse, per call, with that call's exception register; a breach
is a finding (a rule id, a severity, the record, one sentence), never a
thrown error. The code is `src/kernel/envelope.ts`; this page is its reading.

| Field | What it means | Rules that read it |
|---|---|---|
| confidence | The author's grade, A to D. | V20 (C and D must name who makes the claim), V25 (grade A must cite a tier-1 or tier-2 source), V27 (the authored basis is measured against the grade-implied one), V26 (the source relation must fit the basis the grade implies) |
| verification | Where the record sits in the pipeline: `unflagged`, `verified`, `needs-primary-source`, `disputed`. `unflagged` is the default and moves the derived basis exactly like `verified`: a missing check is not a weaker claim. | V18 (confidence C with `needs-primary-source` derives an inferred basis), V33 (verified requires a review made by a human as a source check; see the last paragraph) |
| basis | What kind of claim this is: `documented`, `reported`, `inferred`, `unsubstantiated`. Authored, or derived from confidence and verification. An authored basis stronger than the grade implies is an override. | V27 (an override owes a review, reasoning, a falsifier where an inference is involved, a source and `basis_override_reason`), V26 (the source relation must be able to carry the effective basis) |
| sources | The source records that carry the claim, at least one. | V12 (cites one, or is a live exception in the register), V25 (grade A: one of tier 1 or 2), V27 (an override cites one) |
| attributed_to | Who makes the claim when the record is not the project's own voice. | V20 (mandatory at C and D), the envelope's unsubstantiated branch (an unsubstantiated claim must name where it circulates), V4 (an atlas rule: a contract award figure is attributed or primary-sourced) |
| reasoning | How an inference was reasoned. | V18 (an inferred claim states it, non-blank), V27 (an override states it) |
| falsifiable_by | What would falsify the claim. A claim that cannot be falsified is a belief. | V18 (an inferred claim states it), V27 (an override touching an inference states it) |
| review | Signed work: `by` (a role label, never a personal name), a calendar-valid ISO `date`, a `method` from the enum (`source-check`, `dedup`, `attribute`, `accept-reject`, `judge`), a free `note`, and an `actor` (`human` or `agent`). Which labels may sign is the deployment's. | V23 (the review schema: label, date, method; and a review note may not claim a gazette verification without a gazette source), V27 (an override carries one), V33 (see the last paragraph) |
| disputes | Competing characterisations held by someone: `claim`, `held_by`, an optional `source`, `assessment`, `status` and resolution fields. | none in the engine's code. The consumer's interval-trim check reads them, so a disputed record may keep a clamped interval |
| evidence | The passage rather than the bibliography: `passage_type`, the `passage`, a `locator`, `retrieved_at`, and either a timestamped `capture_url` or a `capture_missing` retry date, with a `lineage` naming each republishing step. | V29 (the evidence schema) |

Beside the envelope, every claim kind also carries `source_relation` and
`independence` (V26: a relation that cannot honestly carry the record's kind
of claim fails, the relation and the count stand or fall together, and the
count may not exceed the cited sources), and `basis_override_reason` (V27's
own field).

## A worked example

An event, as the event kind parses it. Grade C with `needs-primary-source`
would derive an inferred basis, so authoring `documented` is an override, and
the override owes its provenance: reasoning, a falsifier, a review, a source
and a reason.

```yaml
- id: ev-concession-award-2025
  date: "2025-04-02"
  title_en: "Railway concession awarded to the Ruritanian Railways Company"
  category: economic
  summary: "The gazette published the award under Decree 7/2025; the ministry announced it the same day."
  actors: [iren-voss]
  institutions: [ministry-infrastructure]
  documents: ["gazette-2025-decree-7"]
  confidence: C                    # the author's grade
  verification: needs-primary-source
  basis: documented                # an override: the pair above implies "inferred"
  attributed_to: "The ministry's communiqué, as carried by the Herald"
  reasoning: "The decree structure carries the award; the communiqué restates it."
  falsifiable_by: "A later decree reversing the award, or a register showing no concession."
  basis_override_reason: "The decree is the claim; the grade reflects the missing literature."
  source_relation: direct-record
  independence: 1
  sources: [gazette-2025-decree-7]
  review:
    by: maintainer
    date: 2026-01-15
    method: source-check
    actor: human
  evidence:
    - passage_type: quote
      passage: "Decree 7/2025 awards the operating concession to the Ruritanian Railways Company."
      locator: "Article 1"
      retrieved_at: 2026-01-12
      capture_url: "https://web.archive.org/web/20260112090000/https://example.invalid/gazette/2025/decree-7"
```

## Which rules are in the engine

The rules reading the envelope, as this engine's code has them: V12, V18,
V19 (a strict schema rejects an undeclared key), V20, V23, V25, V26, V27,
V29. V33 is not in the engine's code: the review's `actor` field exists for
it, and the consumer's build enforces it, so a deployment that wants the
check before the pin reaches it declares it as an extra rule.
