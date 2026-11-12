# DeepEpisteme — reusable epistemic infrastructure

[![CI](https://github.com/deepontology/deepepisteme/actions/workflows/ci.yml/badge.svg)](https://github.com/deepontology/deepepisteme/actions/workflows/ci.yml)

**DeepEpisteme is the engine. Tunisia is the first deployment.**

This repository is the extraction of the jurisdiction-agnostic layer from
[DeepTunisia](https://deeptunisia.org) — the build machinery that lets any
contested dataset distinguish a documented fact from a circulating claim at
compile time, rather than at reading time.

> Tunisia is the reference deployment (1,200+ sources, ~800 claim-bearing
> records, 24 validators, fuzzy-interval time model). The engine — evidence
> envelope, interval resolver, parameterised validators, single-region splicer,
> deterministic entity linking — is portable. A new jurisdiction forks this
> crate, edits one file (`data/parameters.yaml`), and inherits the build gate.

## What lives here

| Module | What it does |
|---|---|
| `src/engine.ts` | `createEngine(deployment)`, the 1.0 entry point: validates a deployment and returns its time model and envelope helpers |
| `src/kernel/` | The layers true of any evidence-graded corpus: `kernel/time.ts` (`createTime`, the interval resolver), the basis ladder, reviews and disputes, the claim envelope. No country, no module state |
| `src/claim.ts` | Record schemas built on the evidence envelope; the envelope itself now lives in `src/kernel/` and is re-exported here |
| `src/time.ts` | v0.1 path to the interval resolver: `src/kernel/time.ts` holds `createTime(parameters)`; this module delegates to one Time object |
| `src/config.ts` | `ParametersSchema` — **the fork point**. One YAML file retargets the whole engine |
| `src/validate.ts` | Composable validator passes (`passReferential`, `passUnmooredInfluence`, `passDirection`, `passReviewOverclaim`, …) |
| `src/emit.ts` | Single-region splicer (`applyEdit`) — every edit touches one contiguous region; the rest of the file is byte-identical |
| `src/match.ts` | Deterministic entity linker (`buildMatcher`) — string matching over authored surface forms, no language model in the path |
| `src/build.ts` | Minimal build: load → configure → resolve intervals → validate → emit `dataset.json` |
| `data/parameters.yaml` | Template — replace with your jurisdiction's bbox, gazette vocabulary, registry, time bounds |
| `data/` | Synthetic example jurisdiction **Ruritania** — ~25 records across 7 kinds, not a real country, that runs the full build + test gate green |

## The Ruritania example

`data/` contains a toy jurisdiction — a fictional parliamentary republic — that
exercises every layer of the engine:

* 5 sources (tier 1 gazette → tier 5 lead)
* 4 institutions (ministry, party, university, state enterprise)
* 5 roles, 6 people (including one **inferred** person + position that require `reasoning`/`falsifiable_by`)
* 6 positions, 4 relationships (including one **reported-influence** edge moored via V9)
* 2 events, 2 eras

It exists to prove portability: the example compiles from its own data
directory, with its own parameters, through the same validators Tunisia uses.

## Quick start

```bash
npm ci
npm run data   # build src/generated/dataset.json + static/dataset.json
npm run test   # gate: layers, two engines, intervals, counts, envelope, splicer, matcher
npm run check  # tsc --noEmit
```

All three are green on a fresh clone.

## Forking

1. Copy `data/parameters.yaml` and set:
   * `jurisdiction.name`, `jurisdiction.bbox` (WGS84 bounds)
   * `jurisdiction.gazette.vocabulary` + `sourcePrefixes` (what counts as a gazette citation)
   * `jurisdiction.registry.registries` (allowed corporate registries)
   * `time.floor` / `time.cutoff` (dataset horizon)
2. Replace the `data/*.yaml` files with your corpus — same schemas, same envelope rules.
3. `npm run data` — the build fails on a dangling reference, an unattributed C/D claim, an inference without reasoning, an impossible interval, or an unmoored influence edge. Fix the record, not the validator.
4. `npm run test` — extend `src/test.ts` with jurisdiction-specific invariants.

No corpus ships in the crate. `parameters.yaml` is a template; the synthetic
Ruritania data is `~25` records by design — near-empty, but enough to run the
gate.

## Relation to DeepTunisia

DeepTunisia's repository is untouched. This crate was extracted from:

* `scripts/schema.ts` → `src/claim.ts`
* `scripts/dates.ts` → `src/time.ts`
* `scripts/parameters.ts` → `src/config.ts`
* `scripts/build-data.ts` (validator passes) → `src/validate.ts`
* `scripts/emit.ts` → `src/emit.ts` (preserved verbatim, including the single-region splicer guarantee)
* `src/lib/match.ts` → `src/match.ts`

Tunisia-specific literals (bounding box, gazette prefixes, registry slugs) were
removed from code and now live only in `data/parameters.yaml`, so a fork
changes configuration — not validators.

## Status

Skeleton — extraction begun, not complete. The crate demonstrates that the
engine is separable and portable; the full DeepTunisia validator suite (V1–V24),
media/world layers, and CI portability proof are tracked as later milestones.

See the DeepTunisia repository for the
milestone map. This directory is a sibling to that repository, not a subdirectory,
so the Tunis corpus is never at risk from an extraction edit.

## License

MIT — same as DeepTunisia.
