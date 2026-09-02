/**
 * match.ts — deterministic entity linking for headlines.
 *
 * Ties a headline to a person or institution without a language model.
 * A hallucinated link between a named individual and a news story is the
 * one failure this crate cannot survive, so the mechanism is string matching
 * over surface forms derived mechanically from the dataset's own name fields.
 *
 * Design bias: precision over recall. Where a surface form is ambiguous,
 * it is dropped rather than resolved.
 */

export interface MatchEntity {
  id: string;
  kind: 'person' | 'institution';
  names: string[];
}

export interface Match {
  id: string;
  kind: 'person' | 'institution';
  text: string;
  start: number;
  end: number;
  form: string;
  rule: RuleName;
}

export type RuleName = 'authored' | 'particle-join' | 'particle-split' | 'surname' | 'generic-head-drop';

export interface MatcherOptions {
  maxTokenEntityFrequency?: number;
  arabicArticleFolding?: boolean;
  caseEvidence?: boolean;
  caselessSurnameOnly?: boolean;
}

interface Entry {
  form: string;
  normalised: string;
  entity: MatchEntity;
  rule: RuleName;
}

function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function articleFold(s: string): string {
  return s.replace(/ال/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): string[] {
  return normalise(s).split(/\s+/).filter(Boolean);
}

export function buildMatcher(entities: MatchEntity[], opts: MatcherOptions = {}) {
  const maxFreq = opts.maxTokenEntityFrequency ?? 1;
  const foldArticle = opts.arabicArticleFolding ?? true;
  const caseEvidence = opts.caseEvidence ?? true;

  // Count token frequencies (for single-token match gating)
  const tokenFreq = new Map<string, number>();
  for (const e of entities) {
    const seen = new Set<string>();
    for (const n of e.names) {
      for (const tok of tokenize(n)) seen.add(tok);
    }
    for (const t of seen) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
  }

  // Build surface-form table
  const entries: Entry[] = [];
  const seenForms = new Map<string, string>(); // normalised -> entity id (for dedup)

  function addForm(form: string, entity: MatchEntity, rule: RuleName) {
    const norm = normalise(form);
    if (!norm) return;
    // Single-token gate: token must be unique enough
    if (!norm.includes(' ') && !norm.includes('-')) {
      const freq = tokenFreq.get(norm) ?? 99;
      if (freq > maxFreq) return;
    }
    // Ambiguity: two entities share the same normalised form — drop both (precision)
    const prev = seenForms.get(norm);
    if (prev && prev !== entity.id) {
      // remove earlier entry
      const idx = entries.findIndex((e) => e.normalised === norm);
      if (idx !== -1) entries.splice(idx, 1);
      return;
    }
    seenForms.set(norm, entity.id);
    entries.push({ form, normalised: norm, entity, rule });
  }

  for (const e of entities) {
    for (const name of e.names) {
      if (!name.trim()) continue;
      addForm(name, e, 'authored');
      // particle-join: "Ben Ali" -> "BenAli"
      if (/\bBen\s+\w/i.test(name)) {
        addForm(name.replace(/\bBen\s+(\w)/gi, 'Ben$1'), e, 'particle-join');
        addForm(name.replace(/\bBen\s+/gi, 'Ben'), e, 'particle-join');
      }
      // particle-split: "Bensedrine" -> "Ben Sedrine" (reverse)
      if (/Bens\w/i.test(name) || /Ben\w/i.test(name)) {
        const split = name.replace(/^(Ben)([A-Z])/g, '$1 $2').replace(/^(Bens)([A-Z])/g, '$1 $2');
        if (split !== name) addForm(split, e, 'particle-split');
      }
      // generic-head-drop: "Ennahda Movement" -> "Ennahda"
      const parts = name.trim().split(/\s+/);
      if (parts.length > 1) {
        const headDropped = parts.slice(0, -1).join(' ');
        const genericTails = new Set(['movement', 'party', 'front', 'union', 'association', 'group', 'coalition']);
        if (genericTails.has(parts[parts.length - 1].toLowerCase())) {
          addForm(headDropped, e, 'generic-head-drop');
        }
      }
      // surname: last token (only for multi-token names)
      const toks = tokenize(name);
      if (toks.length >= 2) {
        const surname = toks[toks.length - 1];
        // handled via addForm gate (frequency check)
        // use original last word capitalisation for form
        const words = name.trim().split(/\s+/);
        addForm(words[words.length - 1], e, 'surname');
      }
    }
    if (foldArticle) {
      // add article-folded variants for Arabic names
      for (const name of e.names) {
        if (/[\u0600-\u06ff]/.test(name)) {
          const folded = articleFold(name);
          if (folded !== name) addForm(folded, e, 'authored');
        }
      }
    }
  }

  // Longest forms first so overlapping matches prefer the more specific
  entries.sort((a, b) => b.normalised.length - a.normalised.length);

  function hasCaseEvidence(text: string, start: number, end: number): boolean {
    if (!caseEvidence) return true;
    const slice = text.slice(start, end);
    // Caseless scripts (Arabic) have no case evidence — allow
    if (/^[\u0600-\u06ff\s-]+$/.test(slice.trim())) return true;
    // Need at least one uppercase letter in the matched slice
    return /[A-Z]/.test(slice);
  }

  function find(text: string): Match[] {
    const normText = normalise(text);
    // Build offset map from normalised to original
    // Simpler: search normalised forms inside normalised text, then map back via indexOf on original's normalised view
    // For demo fidelity, we use normalise(text) for search and then locate in original via case-insensitive search
    const lowerOriginal = text.toLowerCase();
    const results: Match[] = [];
    const covered = new Set<number>(); // normalised offsets already covered by longer match

    for (const entry of entries) {
      let idx = 0;
      while (true) {
        const pos = normText.indexOf(entry.normalised, idx);
        if (pos === -1) break;
        // check overlap with already-covered region
        let overlaps = false;
        for (let i = pos; i < pos + entry.normalised.length; i++) if (covered.has(i)) { overlaps = true; break; }
        if (!overlaps) {
          // Map normalised position to original offsets (approximate via searching)
          const needle = entry.form.toLowerCase();
          // Try to find the form in original around the area
          const searchFrom = Math.max(0, pos - 5);
          // Fallback: use pos as approximate original offset (works when normalisation is mostly lowercasing)
          // More accurate: find needle in lowerOriginal
          let origStart = lowerOriginal.indexOf(needle, searchFrom);
          if (origStart === -1) origStart = lowerOriginal.indexOf(entry.normalised, searchFrom);
          if (origStart === -1) origStart = pos;
          const origEnd = origStart + entry.form.length;

          // Case-evidence gate for single-token forms
          if (!entry.normalised.includes(' ') && !hasCaseEvidence(text, origStart, origEnd)) {
            idx = pos + 1;
            continue;
          }

          // Surname guard: if match is surname-only, ensure not preceded by another capitalised given name
          if (entry.rule === 'surname') {
            const before = text.slice(Math.max(0, origStart - 20), origStart).trim();
            if (/[A-Z][a-z]+\s*$/.test(before) && before.split(/\s+/).length >= 1) {
              // There is a capitalised word immediately before — likely a different person's given name
              idx = pos + 1;
              continue;
            }
          }

          // Arabic caseless surname-only gate
          if (entry.rule === 'surname' && /[\u0600-\u06ff]/.test(entry.form) && !opts.caselessSurnameOnly) {
            idx = pos + 1;
            continue;
          }

          results.push({
            id: entry.entity.id,
            kind: entry.entity.kind,
            text: text.slice(origStart, origEnd),
            start: origStart,
            end: origEnd,
            form: entry.form,
            rule: entry.rule
          });
          for (let i = pos; i < pos + entry.normalised.length; i++) covered.add(i);
        }
        idx = pos + 1;
      }
    }
    results.sort((a, b) => a.start - b.start);
    return results;
  }

  return { find, entries: entries.slice() };
}
