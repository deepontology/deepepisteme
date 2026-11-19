/**
 * atlas/match.ts: deterministic entity linking for headlines.
 *
 * A headline is tied to a person or an institution without a language model
 * anywhere in the path. A hallucinated link between a named individual and a
 * news story is the one failure this engine cannot survive, so the whole
 * mechanism is string matching over surface forms derived mechanically from a
 * dataset's own name fields. Nothing is guessed.
 *
 * Design bias: precision over recall. Every rule below was chosen so the
 * failure mode is "we did not link a story we could have" rather than "we
 * linked a story to the wrong person". Where a surface form is ambiguous, it
 * is dropped rather than resolved — resolving it would be an inference, and
 * an inference may never become a fact.
 *
 * What is data and what is atlas here:
 *   - The word lists a country's names need — nasab particles, grammatical
 *     function words, splittable prefixes, surname heads — are deployment
 *     data. They arrive as `words: MatcherWords`, in the engine's case from
 *     `deployment.matcher`, and two engines built from different lists answer
 *     differently. Nothing about one country's naming conventions is written
 *     into this file.
 *   - The orthography of scripts is atlas machinery: Latin letters without a
 *     Unicode decomposition, Arabic hamza seats and final letters, Arabic
 *     digits, and the Arabic definite article all fold the same way for any
 *     deployment whose sources use those scripts, and the folding is inert
 *     for text that does not. These stay.
 *
 * The rule set is measured behaviour, not aspiration: R5 (generic head/tail
 * drop) measurably raises recall and measurably produces false positives, so
 * it is off by default and kept so the trade stays testable.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MatchEntity {
  id: string;
  kind: 'person' | 'institution';
  /** Raw authored names: every name field and alias a record carries. */
  names: readonly string[];
}

export interface Match {
  id: string;
  kind: 'person' | 'institution';
  /** The exact substring of the input that matched, offsets into the original text. */
  text: string;
  start: number;
  end: number;
  /** The normalised surface form that matched. Useful for showing why a link was made. */
  form: string;
  /** Which generation rule produced the matched form. See the rules below. */
  rule: RuleName;
}

export type RuleName =
  | 'authored' // an authored name or alias, normalised
  | 'particle-join' // "Ben Ali"      -> "BenAli"
  | 'particle-split' // "Bensedrine"   -> "Ben Sedrine"
  | 'surname' // "Habib Bourguiba" -> "Bourguiba"
  | 'generic-head-drop'; // "Ennahda Movement" -> "Ennahda"  (opt-in; see options)

/**
 * The word lists one deployment's names are made of. Deployment data, not
 * matcher code: a fork supplies its own country's conventions, and the engine
 * builds each matcher from the deployment object it was created with.
 */
export interface MatcherWords {
  /**
   * Nasab particles — the connective tissue of Arabic names ("ben", "bin",
   * "el", and their kin). They may never match alone, but unlike grammatical
   * words they do carry distinguishing weight inside a phrase: "Ben Ali" is
   * not "Ali". Treating them as noise would throw away authored aliases,
   * which is exactly the kind of human judgement an alias table records.
   */
  particles: readonly string[];
  /**
   * Grammatical words. These narrow nothing: "Le Temps" is distinctive only
   * to the extent that "Temps" is, so such a form is gated as a
   * single-content-token match.
   */
  functionWords: readonly string[];
  /** Prefixes recoverable from a surname written as one word: Bensedrine -> Ben Sedrine. */
  splittablePrefixes: readonly string[];
  /** Particles that may head a surname block: "Ben Ali", "Caid Essebsi", "Abd Essalem". */
  surnameHeads: readonly string[];
}

export interface MatcherOptions {
  /**
   * A token may back a single-token match only if it occurs in the authored
   * names of at most this many entities. Derived from the data, never
   * hand-written. Default 1 — the token must belong to exactly one entity.
   */
  maxTokenEntityFrequency?: number;
  /**
   * Fold the Arabic definite article when comparing multi-token forms, so
   * a source writing one name with the article matches the record without
   * it. Never applied to single-token forms — see the note on `articleFold`.
   * Default true.
   */
  arabicArticleFolding?: boolean;
  /**
   * Require capitalisation evidence in the source text before accepting a
   * match that rests on a single content token ("Le Temps", "UGTT",
   * "Bourguiba"), and refuse a surname-only match that is directly preceded
   * by somebody else's capitalised given name. Skipped for caseless scripts.
   * Default true.
   */
  caseEvidence?: boolean;
  /**
   * Allow surname-only matches in scripts without capitalisation — in
   * practice Arabic. Default false: the given-name guard that makes
   * surname-only matching survivable needs case, so without it a lone
   * Arabic surname would link anybody who shares it in the news to the one
   * entity that carries it in the graph. Article folding recovers most of
   * these as full multi-token matches instead.
   */
  caselessSurnameOnly?: boolean;
  /**
   * Also index institution names with their generic head/tail words removed
   * ("Ennahda Movement" -> "Ennahda"). Measurably raises recall and
   * measurably produces false positives — "Hannibal TV" -> "Hannibal" fires
   * on a headline about a man called Hannibal. Default false; kept so the
   * trade stays testable.
   */
  genericHeadDrop?: boolean;
  /** Minimum characters in the content token of a single-content-token form. Default 3. */
  minTokenChars?: number;
}

export interface MatcherStats {
  entities: number;
  /** Entities with at least one usable surface form. */
  matchable: number;
  /** Accepted surface forms (strict keys). */
  forms: number;
  /** Surface forms discarded because more than one entity claims them. */
  ambiguousForms: number;
  /** Surface forms discarded by the single-token distinctiveness gates. */
  rejectedSingletons: number;
  stoplist: number;
  maxFormTokens: number;
}

export interface Matcher {
  find(text: string): Match[];
  /** Tokens too common across entity names to back a single-token match. */
  readonly stoplist: ReadonlySet<string>;
  /** Ids with at least one usable surface form. */
  readonly matchable: ReadonlySet<string>;
  /** Surface forms claimed by more than one entity, and therefore refused. */
  readonly ambiguous: ReadonlyMap<string, string[]>;
  readonly stats: MatcherStats;
  /** Accepted surface forms for one entity. Empty means the entity is unmatchable. */
  formsFor(id: string): string[];
  /** Why a single-token form was refused, for auditing coverage. */
  rejectionsFor(id: string): string[];
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Latin letters that carry no Unicode decomposition, so NFKD cannot reach
 * them. Kept tiny and mechanical: one letter in, its ASCII skeleton out.
 */
const LATIN_FOLD: Record<string, string> = {
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss'
};

/**
 * Arabic orthographic folding. Sources are inconsistent about hamza seats,
 * final ta marbuta and alef maqsura, so all of them collapse.
 *
 * Most of these are also reachable through NFKD (أ decomposes to ا + hamza-above,
 * which the combining-mark strip then removes) but they are listed explicitly
 * anyway: the folding is a deliberate editorial decision, not an accident of
 * the normalisation form, and ٱ has no decomposition at all.
 */
const ARABIC_FOLD: Record<string, string> = {
  آ: 'ا', // آ  alef with madda
  أ: 'ا', // أ  alef with hamza above
  إ: 'ا', // إ  alef with hamza below
  ٱ: 'ا', // ٱ  alef wasla — no Unicode decomposition, must be listed
  ة: 'ه', // ة  ta marbuta   -> ه
  ى: 'ي', // ى  alef maqsura -> ي
  ؤ: 'و', // ؤ  waw with hamza  -> و
  ئ: 'ي', // ئ  yeh with hamza  -> ي
  ء: '', // ء  standalone hamza — dropped
  ـ: '' // ـ  tatweel — pure typography
};

/** Arabic-Indic and Eastern Arabic-Indic digits -> ASCII. */
function foldDigits(cp: number): string | null {
  if (cp >= 0x0660 && cp <= 0x0669) return String(cp - 0x0660);
  if (cp >= 0x06f0 && cp <= 0x06f9) return String(cp - 0x06f0);
  return null;
}

/**
 * Character-level folding shared by `normalise` and the tokeniser.
 *
 * Order matters: lowercase first (so İ becomes i + combining dot), then NFKD
 * to decompose everything decomposable, then strip **all** combining marks —
 * one pass that removes both Latin diacritics (U+0300–U+036F) and Arabic
 * tashkeel (U+064B–U+0652, plus superscript alef U+0670), since both are \p{M}.
 */
function fold(s: string): string {
  const decomposed = s.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '');
  let out = '';
  for (const ch of decomposed) {
    const digit = foldDigits(ch.codePointAt(0) ?? 0);
    if (digit !== null) {
      out += digit;
      continue;
    }
    out += ARABIC_FOLD[ch] ?? LATIN_FOLD[ch] ?? ch;
  }
  return out;
}

/**
 * Canonical form of a name or a phrase: folded, with every non-alphanumeric run
 * — whitespace, hyphens, apostrophes, the Arabic comma, feed debris —
 * collapsed to a single space.
 *
 * Collapsing to a space rather than to nothing is what makes "Ben-Ali" equal
 * "Ben Ali" and "d'Ennahda" yield a free-standing "ennahda" token. The joined
 * spelling "BenAli" is recovered separately, by generating it as a variant.
 */
export function normalise(s: string): string {
  return fold(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Strip a leading Arabic definite article.
 *
 * **This is never applied to single-token forms, and the reason is a name
 * like "إلياس".** After hamza folding it becomes "الياس", which is
 * indistinguishable from article + "ياس"; blind stripping turns the given
 * name Elyes into a three-letter fragment. The same hazard reaches surnames:
 * a name like "العريض" folds to an ordinary adjective, which would then match
 * any headline using the word.
 *
 * Applied symmetrically to both sides of a multi-token comparison it is safe
 * and useful — the corruption cancels out, because the folded and unfolded
 * spellings fold to the same thing on both sides — and it buys the real-world
 * case of a source writing the article where the record omits it. So: folded
 * for phrases, never for lone words.
 */
function articleFold(token: string): string {
  if (token.startsWith('ال') && token.length - 2 >= 3) return token.slice(2);
  return token;
}

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

interface Tok {
  /** Folded token. Never empty. */
  norm: string;
  /** Original substring, for capitalisation evidence. */
  raw: string;
  start: number;
  end: number;
}

/**
 * Runs of letters, digits and combining marks. Marks are inside the class on
 * purpose: without them a tashkeel-carrying Arabic word would shatter into
 * five tokens, and NFD-form Latin text would lose its accents' host letters.
 *
 * Tokens are folded individually so the reported offsets stay indices into
 * the *original* string — NFKD changes lengths, so folding the whole text
 * first and measuring there would report offsets that do not exist.
 */
const TOKEN_RE = /[\p{L}\p{N}\p{M}]+/gu;

function tokenise(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const norm = fold(raw).replace(/[^\p{L}\p{N}]+/gu, '');
    if (!norm) continue; // e.g. a run of bare tashkeel or tatweel
    out.push({ norm, raw, start: m.index, end: m.index + raw.length });
  }
  return out;
}

/** One deployment-supplied word in its folded form, the shape tokens carry. */
function foldWord(word: string): string {
  return fold(word).replace(/[^\p{L}\p{N}]+/gu, '');
}

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

interface Form {
  tokens: string[];
  rule: RuleName;
}

interface Entry {
  id: string;
  kind: 'person' | 'institution';
  tokens: string[];
  form: string;
  rule: RuleName;
  /** Index into `tokens` of the sole content token, or -1 when there are several. */
  loneContent: number;
  /** Every token of every authored name of this entity — the given-name guard's whitelist. */
  nameTokens: ReadonlySet<string>;
}

const AMBIGUOUS = Symbol('ambiguous');

/** Does this raw token carry a case distinction at all? Arabic does not. */
function hasCase(raw: string): boolean {
  return raw.toLowerCase() !== raw.toUpperCase();
}

function startsCapitalised(raw: string): boolean {
  const letters = raw.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  return letters[0] === letters[0].toUpperCase();
}

export function createMatcher(
  entities: readonly MatchEntity[],
  words: MatcherWords,
  options: MatcherOptions = {}
): Matcher {
  const maxFreq = options.maxTokenEntityFrequency ?? 1;
  const articleFolding = options.arabicArticleFolding ?? true;
  const caseEvidence = options.caseEvidence ?? true;
  const caselessSurnameOnly = options.caselessSurnameOnly ?? false;
  const genericHeadDrop = options.genericHeadDrop ?? false;
  const minTokenChars = options.minTokenChars ?? 3;

  // --- The deployment's vocabulary, folded to the shape tokens carry ------
  const functionWords = new Set<string>();
  for (const w of words.functionWords) {
    const f = foldWord(w);
    if (f) functionWords.add(f);
  }
  const particles = new Set<string>(functionWords);
  for (const w of words.particles) {
    const f = foldWord(w);
    if (f) particles.add(f);
  }
  const surnameHeads = new Set<string>();
  for (const w of words.surnameHeads) {
    const f = foldWord(w);
    if (f) surnameHeads.add(f);
  }
  const splittablePrefixes: string[] = [];
  for (const w of words.splittablePrefixes) {
    const f = foldWord(w);
    if (f) splittablePrefixes.push(f);
  }

  /**
   * A token counts as *content* if it can distinguish one entity from
   * another. Grammatical words cannot. Neither can single characters —
   * elisions ("d'", "l'"), initials and the trailing numerals in a numbered
   * name all reduce to one character and none of them identify anybody.
   */
  const isContent = (token: string): boolean => token.length > 1 && !functionWords.has(token);

  // --- Derived vocabularies -----------------------------------------------
  //
  // Both lists below are computed from the entity set. Nothing is written
  // from memory: a hand-authored list of "common given names" would encode
  // one person's intuition about a language, and would be wrong in exactly
  // the places nobody thought to check.

  /** How many distinct entities use each token anywhere in an authored name. */
  const tokenEntityFreq = new Map<string, number>();
  /** How many distinct institutions use each token — organisational vocabulary. */
  const instTokenFreq = new Map<string, number>();

  for (const e of entities) {
    const seen = new Set<string>();
    for (const name of e.names) {
      for (const t of normalise(name).split(' ')) if (t) seen.add(t);
    }
    for (const t of seen) {
      tokenEntityFreq.set(t, (tokenEntityFreq.get(t) ?? 0) + 1);
      if (e.kind === 'institution') instTokenFreq.set(t, (instTokenFreq.get(t) ?? 0) + 1);
    }
  }

  // The stoplist: tokens shared by more entities than `maxFreq`, plus every
  // particle. A common given name lands here because many people carry it,
  // not because anyone told the matcher it is common.
  const stoplist = new Set<string>();
  for (const [token, freq] of tokenEntityFreq) if (freq > maxFreq) stoplist.add(token);
  for (const p of particles) stoplist.add(p);

  // Generic organisational words ("movement", "bank", a common head word)
  // for R5, derived the same way: whatever institutions share.
  const GENERIC_HEAD_MIN = 3;
  const genericHead = new Set<string>();
  for (const [token, freq] of instTokenFreq) if (freq >= GENERIC_HEAD_MIN) genericHead.add(token);

  // --- Surface-form generation --------------------------------------------

  function pushForm(into: Form[], tokens: string[], rule: RuleName): void {
    if (!tokens.length) return;
    if (!tokens.some(isContent)) return; // grammatical words only — never a name
    into.push({ tokens, rule });
  }

  /**
   * Every surface form generated for one authored name. Each rule is
   * mechanical and reversible to the source string; nothing here invents a
   * spelling the data does not already contain.
   */
  function formsForName(name: string, kind: 'person' | 'institution'): Form[] {
    const tokens = normalise(name).split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const out: Form[] = [];

    // R1 — the authored name itself.
    pushForm(out, tokens, 'authored');

    // R2 — particle joined to the following token. Sources write both
    // "Ben Ali" and "BenAli". One variant per particle occurrence; no
    // combinatorial expansion.
    for (let i = 0; i < tokens.length - 1; i++) {
      if (!particles.has(tokens[i])) continue;
      const joined = [...tokens.slice(0, i), tokens[i] + tokens[i + 1], ...tokens.slice(i + 2)];
      pushForm(out, joined, 'particle-join');
    }

    // R3 — the inverse: a surname written as one word, split back apart.
    // Requires >=3 characters after the prefix so "Ali" is not read as
    // "Al" + "i".
    for (let i = 0; i < tokens.length; i++) {
      for (const prefix of splittablePrefixes) {
        if (!tokens[i].startsWith(prefix)) continue;
        const rest = tokens[i].slice(prefix.length);
        if (rest.length < 3) continue;
        const split = [...tokens.slice(0, i), prefix, rest, ...tokens.slice(i + 1)];
        pushForm(out, split, 'particle-split');
      }
    }

    // R4 — surname alone, people only, because referring to a person by
    // surname is a journalistic convention and referring to an institution
    // by a fragment of its name is not. The block extends leftwards through
    // surname heads, so a nasab-chain name yields the particle block rather
    // than its last word alone.
    //
    // A surname that more than one person shares is dropped later by the
    // ambiguity rule; a surname that is a common word is dropped by the
    // stoplist. Neither is decided here.
    if (kind === 'person' && tokens.length > 1) {
      let from = tokens.length - 1;
      while (from > 0 && surnameHeads.has(tokens[from - 1])) from--;
      if (from > 0) pushForm(out, tokens.slice(from), 'surname');
    }

    // R5 — generic organisational head/tail words removed. Off by default: it
    // is the difference between matching an organisation by its distinctive
    // word and mislinking a headline about a person who shares it.
    if (genericHeadDrop && kind === 'institution' && tokens.length > 1) {
      let lo = 0;
      let hi = tokens.length;
      while (lo < hi && genericHead.has(tokens[lo])) lo++;
      while (hi > lo && genericHead.has(tokens[hi - 1])) hi--;
      if (hi - lo >= 1 && hi - lo < tokens.length) {
        pushForm(out, tokens.slice(lo, hi), 'generic-head-drop');
      }
    }

    return out;
  }

  // --- Index --------------------------------------------------------------

  const strict = new Map<string, Entry | typeof AMBIGUOUS>();
  const loose = new Map<string, Entry | typeof AMBIGUOUS>();
  const ambiguous = new Map<string, string[]>();
  const formsByEntity = new Map<string, string[]>();
  const rejectionsByEntity = new Map<string, string[]>();
  let rejectedSingletons = 0;
  let maxFormTokens = 1;

  const note = (map: Map<string, string[]>, id: string, msg: string) => {
    const list = map.get(id);
    if (list) list.push(msg);
    else map.set(id, [msg]);
  };

  for (const e of entities) {
    const seenForms = new Set<string>();
    const nameTokens = new Set<string>();
    for (const name of e.names) {
      for (const t of normalise(name).split(' ')) if (t) nameTokens.add(t);
    }
    // Does this entity have a one-word name in a script that marks capitals?
    // Used below to decide whether a one-word caseless form can be trusted.
    const casedSingleToken = e.names.some(
      (n) => hasCase(n) && normalise(n).split(' ').filter(Boolean).length === 1
    );

    for (const name of e.names) {
      if (!name) continue;
      for (const f of formsForName(name, e.kind)) {
        const key = f.tokens.join(' ');
        if (seenForms.has(key)) continue;
        seenForms.add(key);

        const contentIdx = f.tokens.map((t, i) => (isContent(t) ? i : -1)).filter((i) => i >= 0);
        const loneContent = contentIdx.length === 1 ? contentIdx[0] : -1;
        const caseless = !hasCase(key);

        const reject = (why: string) => {
          rejectedSingletons++;
          note(rejectionsByEntity, e.id, `${key} — ${why}`);
        };

        // --- Single-token gates -----------------------------------------
        // One word standing for a whole entity is the dangerous case. It
        // must be distinctive in the data itself before it is indexed.
        if (f.tokens.length === 1) {
          const token = f.tokens[0];
          if (particles.has(token)) {
            reject(`"${token}" is a particle`);
            continue;
          }
          if (stoplist.has(token)) {
            reject(`"${token}" appears in ${tokenEntityFreq.get(token) ?? 0} entities`);
            continue;
          }
          if (token.length < minTokenChars) {
            reject(`"${token}" is shorter than ${minTokenChars} characters`);
            continue;
          }
          // A lone word in a script with no capitalisation has no second
          // signal behind it. Trust it only where the entity is also a lone
          // word in a script that does have one: a transliteration backs the
          // Arabic form, while an Arabic form backed only by a multi-word
          // name is just the ordinary word of the language.
          if (caseless && !casedSingleToken) {
            reject('one caseless word with no single-word cased name behind it');
            continue;
          }
        }

        // A surname alone survives only because the given-name guard can read
        // capitalisation. Arabic offers none, so a lone Arabic surname would
        // link everybody who shares it in the news to the one entity that
        // carries it in the graph. Article folding recovers most of these as
        // multi-token matches instead.
        if (f.rule === 'surname' && caseless && !caselessSurnameOnly) {
          reject('surname-only form in a script without capitalisation');
          continue;
        }

        const entry: Entry = {
          id: e.id,
          kind: e.kind,
          tokens: f.tokens,
          form: key,
          rule: f.rule,
          loneContent,
          nameTokens
        };

        maxFormTokens = Math.max(maxFormTokens, f.tokens.length);
        register(strict, key, entry);

        // The loose index only ever holds multi-token forms. See `articleFold`.
        if (articleFolding && f.tokens.length > 1) {
          const lkey = f.tokens.map(articleFold).join(' ');
          if (lkey !== key) register(loose, lkey, entry);
        }
      }
    }
  }

  function register(map: Map<string, Entry | typeof AMBIGUOUS>, key: string, entry: Entry): void {
    const prior = map.get(key);
    if (!prior) {
      map.set(key, entry);
      return;
    }
    if (prior === AMBIGUOUS) {
      const list = ambiguous.get(key);
      if (list && !list.includes(entry.id)) list.push(entry.id);
      return;
    }
    if (prior.id === entry.id) return; // same entity, two authored names — fine
    // Two entities claim the same string. Choosing between them would be an
    // inference. The form is withdrawn from both.
    map.set(key, AMBIGUOUS);
    ambiguous.set(key, [prior.id, entry.id]);
  }

  // Surviving forms, per entity — computed after ambiguity resolution so the
  // coverage figures a caller reports are the honest ones.
  for (const [key, entry] of strict) {
    if (entry === AMBIGUOUS) continue;
    const list = formsByEntity.get(entry.id);
    if (list) list.push(key);
    else formsByEntity.set(entry.id, [key]);
  }

  const matchable = new Set(formsByEntity.keys());
  let formCount = 0;
  for (const v of strict.values()) if (v !== AMBIGUOUS) formCount++;

  // --- Match-time gates ---------------------------------------------------

  /**
   * Capitalisation evidence. Applied only where a single content token
   * carries the match, and only to scripts that have case — so a French
   * cased name needs its capital, while Arabic is judged on distinctiveness
   * alone because the script offers no such signal.
   *
   * An earlier, stricter version demanded ALL CAPS for names authored in
   * caps. Real feeds refuted it within a day: sources lower-case the same
   * name in running prose. Initial capital is the rule that survives
   * contact with a corpus.
   */
  function acceptCase(entry: Entry, slice: Tok[]): boolean {
    if (!caseEvidence || entry.loneContent < 0) return true;
    const tok = slice[entry.loneContent];
    if (!tok || !hasCase(tok.raw)) return true;
    return startsCapitalised(tok.raw);
  }

  /**
   * The given-name guard.
   *
   * A surname alone is the one surface form that legitimately belongs to
   * people outside the graph, and a corpus proves it: a headline can carry a
   * person who happens to share a surname with somebody in the graph. The
   * signal that distinguishes them is already in the text — a capitalised
   * word sitting directly against the surname, with nothing but a space
   * between, is that person's given name. If it is not one of *our* entity's
   * name tokens, this is not our entity.
   *
   * Deliberately narrow so it cannot eat real matches:
   *  - only for `surname` forms; full authored names are never second-guessed
   *  - only when the separator is pure whitespace, so source slugs and
   *    honorifics are untouched
   *  - never at the start of the text, where capitalisation means nothing
   *
   * Its cost is headlines set in Title Case, where every preceding word looks
   * like a given name. That is a missed link, which is the cheap direction to
   * fail in.
   */
  function acceptGivenName(entry: Entry, toks: Tok[], i: number, text: string): boolean {
    if (!caseEvidence || entry.rule !== 'surname' || i === 0) return true;
    const prev = toks[i - 1];
    // Anything other than whitespace between them means it is not a name pair.
    if (!/^\s+$/.test(text.slice(prev.end, toks[i].start))) return true;
    if (!hasCase(prev.raw) || !startsCapitalised(prev.raw)) return true;
    if (particles.has(prev.norm)) return true;
    return entry.nameTokens.has(prev.norm);
  }

  function find(text: string): Match[] {
    const toks = tokenise(text);
    const out: Match[] = [];
    let i = 0;
    while (i < toks.length) {
      let hit: Entry | null = null;
      let span = 0;
      // Longest form wins at each position, and a match consumes its tokens,
      // so results can never overlap. A full name beats its surname block.
      for (let len = Math.min(maxFormTokens, toks.length - i); len >= 1; len--) {
        const slice = toks.slice(i, i + len);
        const key = slice.map((t) => t.norm).join(' ');
        let found = strict.get(key);
        if (!found && articleFolding && len > 1) {
          found = loose.get(slice.map((t) => articleFold(t.norm)).join(' '));
        }
        if (!found || found === AMBIGUOUS) continue;
        if (!acceptCase(found, slice)) continue;
        if (!acceptGivenName(found, toks, i, text)) continue;
        hit = found;
        span = len;
        break;
      }
      if (!hit) {
        i++;
        continue;
      }
      const start = toks[i].start;
      const end = toks[i + span - 1].end;
      out.push({
        id: hit.id,
        kind: hit.kind,
        text: text.slice(start, end),
        start,
        end,
        form: hit.form,
        rule: hit.rule
      });
      i += span;
    }
    return out;
  }

  return {
    find,
    stoplist,
    matchable,
    ambiguous,
    stats: {
      entities: entities.length,
      matchable: matchable.size,
      forms: formCount,
      ambiguousForms: ambiguous.size,
      rejectedSingletons,
      stoplist: stoplist.size,
      maxFormTokens
    },
    formsFor: (id) => formsByEntity.get(id) ?? [],
    rejectionsFor: (id) => rejectionsByEntity.get(id) ?? []
  };
}
