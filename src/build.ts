/**
 * build.ts — minimal build: load YAML, validate, emit dataset.json.
 *
 * The single command a reviewer runs:
 *   npm run data
 *
 * Reads data/*.yaml, configures jurisdiction parameters, resolves intervals,
 * runs composable validators, and emits src/generated/dataset.json + static/
 * exports. Fails on any error (no artifact emitted on failure).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { loadParameters, getParameters } from './config.ts';
import { applyOngoingObservation, configureTime, resolveInterval, durationYears } from './time.ts';
import {
  SourceSchema,
  InstitutionSchema,
  RoleSchema,
  PersonSchema,
  PositionSchema,
  RelationshipSchema,
  EventSchema,
  EraSchema,
  deriveBasis
} from './claim.ts';
import { runValidators } from './validate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA_DIR = process.env.DT_DATA_DIR ?? join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'src', 'generated');
const STATIC_DIR = join(ROOT, 'static');

const errors: string[] = [];
const warnings: string[] = [];
function fail(where: string, msg: string) { errors.push(`${where}: ${msg}`); }
function warn(where: string, msg: string) { warnings.push(`${where}: ${msg}`); }

// ---------------------------------------------------------------------------
// Load parameters first — every other module reads them
// ---------------------------------------------------------------------------

const parameters = loadParameters(join(DATA_DIR, 'parameters.yaml'));
configureTime(parameters.time);

// ---------------------------------------------------------------------------
// YAML loader
// ---------------------------------------------------------------------------

function loadYaml<T>(file: string, schema: z.ZodType<T>): T[] {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    // Empty file is valid for optional kinds; missing file is noted but not fatal
    // for the core kinds we require, missing is a failure.
    const required = ['sources.yaml', 'institutions.yaml', 'roles.yaml', 'people.yaml'];
    if (required.includes(file)) fail(file, 'file not found');
    return [];
  }
  let raw: unknown;
  try { raw = parseYaml(readFileSync(path, 'utf8')); } catch (e) { fail(file, `YAML parse: ${(e as Error).message}`); return []; }
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) { fail(file, 'expected top-level YAML list'); return []; }
  const out: T[] = [];
  raw.forEach((entry, i) => {
    const res = schema.safeParse(entry);
    if (!res.success) {
      const label = entry && typeof entry === 'object' && 'id' in (entry as any) ? String((entry as any).id) : `index ${i}`;
      for (const iss of res.error.issues) {
        const p = iss.path.length ? iss.path.join('.') : '(root)';
        fail(`${file} [${label}]`, `${p} — ${iss.message}`);
      }
      return;
    }
    out.push(res.data);
  });
  return out;
}

const sources = loadYaml('sources.yaml', SourceSchema);
const institutions = loadYaml('institutions.yaml', InstitutionSchema);
const roles = loadYaml('roles.yaml', RoleSchema);
const people = loadYaml('people.yaml', PersonSchema);
const positions = loadYaml('positions.yaml', PositionSchema);
const relationships = loadYaml('relationships.yaml', RelationshipSchema);
const events = loadYaml('events.yaml', EventSchema);
const eras = loadYaml('eras.yaml', EraSchema);

// ---------------------------------------------------------------------------
// Referential integrity (minimal)
// ---------------------------------------------------------------------------

function indexById<T extends { id: string }>(rows: T[], label: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) { if (m.has(r.id)) fail(label, `duplicate id "${r.id}"`); m.set(r.id, r); }
  return m;
}
const sourceById = indexById(sources, 'sources.yaml');
const institutionById = indexById(institutions, 'institutions.yaml');
const roleById = indexById(roles, 'roles.yaml');
const personById = indexById(people, 'people.yaml');
const eventById = indexById(events, 'events.yaml');

const entityIds = new Set<string>([...personById.keys(), ...institutionById.keys(), ...roleById.keys()]);

function checkSources(where: string, ids: string[]) {
  for (const id of ids) if (!sourceById.has(id)) fail(where, `unknown source "${id}"`);
}
for (const inst of institutions) {
  checkSources(`institution ${inst.id}`, inst.sources);
  if (inst.parent && !institutionById.has(inst.parent)) fail(`institution ${inst.id}`, `unknown parent "${inst.parent}"`);
}
for (const role of roles) {
  checkSources(`role ${role.id}`, role.sources);
  if (!institutionById.has(role.institution)) fail(`role ${role.id}`, `unknown institution "${role.institution}"`);
}
for (const p of people) checkSources(`person ${p.id}`, p.sources);
for (const pos of positions) {
  checkSources(`position ${pos.id}`, pos.sources);
  if (!roleById.has(pos.role)) fail(`position ${pos.id}`, `unknown role "${pos.role}"`);
  if (!personById.has(pos.holder)) fail(`position ${pos.id}`, `unknown holder "${pos.holder}"`);
}
for (const rel of relationships) {
  checkSources(`relationship ${rel.id}`, rel.sources);
  if (!entityIds.has(rel.from)) fail(`relationship ${rel.id}`, `unknown "from" "${rel.from}"`);
  if (!entityIds.has(rel.to)) fail(`relationship ${rel.id}`, `unknown "to" "${rel.to}"`);
  if (rel.from === rel.to) fail(`relationship ${rel.id}`, 'self-referential edge');
}
for (const ev of events) {
  checkSources(`event ${ev.id}`, ev.sources);
  for (const a of ev.actors) if (!personById.has(a)) fail(`event ${ev.id}`, `unknown actor "${a}"`);
  for (const inst of ev.institutions) if (!institutionById.has(inst)) fail(`event ${ev.id}`, `unknown institution "${inst}"`);
}

// ---------------------------------------------------------------------------
// Resolve intervals + derive basis
// ---------------------------------------------------------------------------

function safeInterval(where: string, spec: { start?: string | null; end?: string | null }, allowTrim = false) {
  try { return resolveInterval(spec, { allowEnvelopeTrim: allowTrim }); }
  catch (e) { fail(where, (e as Error).message); return resolveInterval({}, { allowEnvelopeTrim: allowTrim }); }
}

/** Latest publication date among a record's sources — the ongoing observation. */
function latestObservation(ids: string[]): number | null {
  let max: number | null = null;
  for (const id of ids) {
    const date = sourceById.get(id)?.date;
    if (!date) continue;
    const t = Date.parse(date);
    if (!Number.isNaN(t) && (max === null || t > max)) max = t;
  }
  return max;
}

/**
 * Resolve an interval and settle `ongoing` against its observation. An ongoing
 * claim with no observation within ONGOING_CONFIRMATION_DAYS of the cutoff is
 * downgraded to `last-verified` with a warning; certainty stops at the
 * observation instead of running unbounded to the cutoff.
 */
function resolvedInterval(where: string, record: { sources?: string[] }, spec: { start?: string | null; end?: string | null }, allowTrim = false) {
  const raw = safeInterval(where, spec, allowTrim);
  if (raw.status !== 'ongoing') return raw;
  const settled = applyOngoingObservation(raw, latestObservation(record.sources ?? []));
  if (settled.status !== 'ongoing') {
    warn(where, 'ongoing without a source dated within 90 days of the cutoff — downgraded to last-verified');
  }
  return settled;
}

const resolvedPositions = positions.map((pos) => {
  const interval = resolvedInterval(`position ${pos.id}`, pos as any, { start: (pos as any).start, end: (pos as any).end }, (pos.disputes?.length ?? 0) > 0);
  const basis = deriveBasis((pos as any).confidence, (pos as any).verification, (pos as any).basis);
  if (basis === 'inferred' && !(pos as any).reasoning) fail(`position ${pos.id}`, 'inferred claim with no reasoning');
  if (basis === 'inferred' && !(pos as any).falsifiable_by) fail(`position ${pos.id}`, 'inferred claim with no falsifier');
  const role = roleById.get((pos as any).role);
  return { ...pos, basis, interval, years: durationYears(interval), roleTitle: role?.title_en ?? (pos as any).role };
});

const resolvedRelationships = relationships.map((rel: any) => ({
  ...rel,
  basis: deriveBasis(rel.confidence, rel.verification, rel.basis),
  interval: resolvedInterval(`relationship ${rel.from}->${rel.to}`, rel, { start: rel.start, end: rel.end }, (rel.disputes?.length ?? 0) > 0)
}));

const resolvedEvents = events.map((ev: any) => ({
  ...ev,
  basis: deriveBasis(ev.confidence, ev.verification, ev.basis),
  interval: resolvedInterval(`event ${ev.id}`, ev, { start: ev.date, end: ev.date_end ?? ev.date }, (ev.disputes?.length ?? 0) > 0)
}));

// ---------------------------------------------------------------------------
// Composable validators
// ---------------------------------------------------------------------------

{
  const ctx: any = {
    sources: sourceById,
    institutions: institutionById,
    roles: roleById,
    people: personById,
    positions: resolvedPositions.map((p: any) => ({ ...p, confidence: p.confidence, verification: p.verification })),
    relationships: resolvedRelationships.map((r: any) => ({ ...r, confidence: r.confidence, verification: r.verification })),
    events: resolvedEvents.map((e: any) => ({ id: e.id, date: e.date, causes: e.causes, consequences: e.consequences, rupture: e.rupture, disputes: e.disputes, sources: e.sources, review: (e as any).review }))
  };
  const result = runValidators(ctx);
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}

// Orphan check (warn-only)
{
  const inPositions = new Set(resolvedPositions.map((p: any) => p.holder));
  const inRels = new Set(resolvedRelationships.flatMap((r: any) => [r.from, r.to]));
  const inEvents = new Set(resolvedEvents.flatMap((e: any) => e.actors));
  for (const person of people) {
    if (!inPositions.has((person as any).id) && !inRels.has((person as any).id) && !inEvents.has((person as any).id)) {
      warn(`person ${(person as any).id}`, 'orphan: holds no position and appears in no relationship or event');
    }
  }
}

// ---------------------------------------------------------------------------
// Emit or fail
// ---------------------------------------------------------------------------

if (errors.length) {
  console.error(`\n  ✗ Build failed with ${errors.length} error(s):\n`);
  for (const e of errors) console.error(`    • ${e}`);
  if (warnings.length) {
    console.error(`\n  ${warnings.length} warning(s):`);
    for (const w of warnings) console.error(`    • ${w}`);
  }
  console.error('');
  process.exit(1);
}

if (warnings.length) {
  console.log(`\n  ⚠ ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`    • ${w}`);
}

// Build dataset.json shape (minimal — enough for a viewer to render)
const dataset = {
  meta: {
    jurisdiction: getParameters().jurisdiction.name,
    parameters: getParameters(),
    generated: new Date().toISOString(),
    counts: {
      sources: sources.length,
      institutions: institutions.length,
      roles: roles.length,
      people: people.length,
      positions: positions.length,
      relationships: relationships.length,
      events: events.length,
      eras: eras.length
    }
  },
  sources,
  institutions: institutions.map((inst: any) => ({ ...inst, basis: deriveBasis(inst.confidence, inst.verification, inst.basis) })),
  roles,
  people: people.map((p: any) => ({ ...p, basis: deriveBasis(p.confidence, p.verification, p.basis) })),
  positions: resolvedPositions,
  relationships: resolvedRelationships,
  events: resolvedEvents,
  eras
};

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(STATIC_DIR, { recursive: true });
mkdirSync(join(ROOT, 'output'), { recursive: true });

writeFileSync(join(OUT_DIR, 'dataset.json'), JSON.stringify(dataset, null, 2), 'utf8');
writeFileSync(join(STATIC_DIR, 'dataset.json'), JSON.stringify(dataset, null, 2), 'utf8');
writeFileSync(join(ROOT, 'output', 'dataset.json'), JSON.stringify(dataset, null, 2), 'utf8');

// CSV exports (minimal, for the tabular kinds)
function toCsv(rows: any[], cols: string[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
if (sources.length) writeFileSync(join(STATIC_DIR, 'sources.csv'), toCsv(sources as any[], ['id', 'title', 'publisher', 'tier']), 'utf8');

// interval-trims.json — publish every clamped envelope
const trims = [
  ...resolvedPositions.filter((p: any) => p.interval.trimmed || p.interval.startClamped).map((p: any) => ({ id: p.id, kind: 'position', interval: p.interval })),
  ...resolvedRelationships.filter((r: any) => r.interval.trimmed || r.interval.startClamped).map((r: any) => ({ id: r.id, kind: 'relationship', interval: r.interval }))
];
writeFileSync(join(STATIC_DIR, 'interval-trims.json'), JSON.stringify(trims, null, 2), 'utf8');

console.log(`\n  ✓ DeepEpisteme build OK — ${getParameters().jurisdiction.name}`);
console.log(`    ${sources.length} sources · ${institutions.length} institutions · ${people.length} people · ${positions.length} positions · ${relationships.length} relationships · ${events.length} events`);
console.log(`    → src/generated/dataset.json  static/dataset.json\n`);
if (trims.length) console.log(`    ${trims.length} interval trim(s) published to interval-trims.json\n`);
