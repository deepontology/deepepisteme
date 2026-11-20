# DeepEpisteme

[![CI](https://github.com/deepontology/deepepisteme/actions/workflows/ci.yml/badge.svg)](https://github.com/deepontology/deepepisteme/actions/workflows/ci.yml)

DeepEpisteme is the engine of an evidence-graded map of power: the machinery
that tells a documented fact from a circulating claim at build time, not at
reading time. Everything about one subject is a deployment, data and not code.
The engine ships one example deployment, the invented country Ruritania under
`examples/ruritania/`, and a fork starts by copying it.

## The three stages

| Stage | Input | Output |
|---|---|---|
| parse | records as loaded from YAML, the exception register | typed records, findings from the schema-level checks |
| resolve | typed records | the id index, the derived basis of every claim record |
| validate | resolved records | findings from every rule in the register |

`engine.check(raw, register?)` runs all three and returns `{ ok, findings }`.
A finding is a rule id, a severity, the record and one sentence. The run is
not ok when any finding is an error. Warnings are returned and never dropped.

## The three layers

| Layer | What belongs in it |
|---|---|
| kernel | What a ledger of court cases would need: the time model, the basis ladder, the claim envelope, reviews and disputes, the exception register, the rule runner, canonical bytes and the dataset hash, the splicer, the source, question, hypothesis and verification kinds. `src/kernel/` |
| atlas | What a map of power of another country would need: seventeen record kinds, one file each under `src/atlas/kinds/`, the default vocabulary a deployment extends or trims, the rules under `src/atlas/rules/`, the name matcher |
| deployment | One subject: languages, the gazette vocabulary, the registry list, the bounding box, reviewer labels, word lists for the matcher, region kinds, any extra kind or rule. A deployment is an object, never engine code |

Nothing is module state. `createEngine(deployment)` returns functions closed
over one deployment, so two engines in one process cannot see each other.

## Writing a deployment

A deployment is one object, validated by `createEngine` before anything runs
(a malformed deployment is a programming error, not a finding). The example
to copy is `examples/ruritania/deployment.ts`.

- `name`, `time` (`floor`, `cutoff`, `beforeWindowYears`, `approxSlackDays`)
- `translatedLocales`, `sourceLanguages` (must include `en`)
- `gazette`: `vocabulary` and `sourcePrefixes`, what counts as a primary source
- `registry`: `label`, `idLabel` and the `registries` a company registration may name
- `bbox`, `reviewerLabels`, `index` (the basis discount weights)
- `vocabulary`: starts from `atlasDefaults.vocabulary`, extended or trimmed
- `matcher`: `particles`, `functionWords`, `splittablePrefixes`, `surnameHeads`
- `extraKinds`, `extraRules`: kinds and rules only this deployment has

A deployment directory carries `deployment.ts` (default-exporting the
object) and `data/`, one YAML list per registered kind named by the kind's
`file` field; a missing file is zero records, not a failure. Records may
break a named rule on purpose until a date: list them in
`data/source-exceptions.yaml` with a rule, a deadline and a reason, and the
engine reports the entry when its deadline passes instead of silently
dropping it.

## Running check

```bash
npx deepepisteme check examples/ruritania
```

`<dir>` is a deployment directory as above. The command loads the
deployment, parses every record, resolves and validates them, and exits 0
when no finding is an error, printing warnings as it goes. It exits 1 naming
every finding otherwise, and 2 when the directory is not a deployment.

## Adding a rule

1. One file per rule or small family under `src/atlas/rules/` (kernel rules
   live in `src/kernel/rules.ts`). A rule is a frozen value: `id`, `title`,
   `layer`, `severity`, `needs` ('parsed' or 'resolved') and `run(ctx)`.
2. Register it in `ATLAS_RULES` in `src/atlas/rules/index.ts`. The register
   order is the order findings are reported in.
3. In `test/atlas-rules.ts`, a failing fixture and a control that differs
   from it by exactly one field, and one run through `engine.check`.
4. Add its row to the table below; `test/readme.ts` fails until the table
   matches `engine.rules`.

## The rule register

Every rule the engine runs, in register order. A numbered id missing from
this table does not run in the engine.

| Id | Rule |
|---|---|
| V12 | Every claim record cites at least one source, or is a live exception |
| V25 | A grade-A claim record cites a tier-1 or tier-2 source, or is a live exception |
| V27 | A basis override carries a review, reasoning, a falsifier where owed, a source and a reason |
| V4 / V5 | A contract award value is attributed or backed by a tier-1 or tier-2 source |
| V10 | A place has a parent region, a real owner if it names one, and coordinates for the map |
| V16 | Duplicate relationships on the same key with overlapping intervals fail |
| V17 | A rupture event not linked into the causal graph is flagged |
| V8 | A cause cannot begin after its consequence, and a causal cycle fails |
| V3 | Company registration numbers are valid and unique |
| V11 | Events with no participants, organisations or documents are orphaned |

## The claim envelope

Every claim-bearing record carries the same envelope: the fields that say
what kind of claim a record makes and what stands behind it. The field by
field reading, with the rules that read each one and a worked example, is
[docs/envelope.md](docs/envelope.md).

## Imports

The package ships TypeScript source, as its consumers run it. The entry
points are the exports in `package.json`: `.` (createEngine, createTime,
atlasDefaults, the types), `./kernel` and `./kernel/time`, the interval
resolver alone, so a browser bundle that needs only dates pulls in no schema
library.

The v0.1 import paths `deepepisteme/time`, `/claim`, `/validate`, `/emit`,
`/match`, `/parameters` are replaced by the exports in `package.json`.

## Quick start

```bash
npm ci
npm test
npm run check
npm run check:example
```

## License

MIT.
