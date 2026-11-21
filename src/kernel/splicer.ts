/**
 * kernel/splicer.ts: the single-region YAML splicer.
 *
 * This module edits a YAML file that is the canonical record of a corpus. The
 * property that matters more than any feature:
 *
 *   AN EDIT CHANGES EXACTLY ONE CONTIGUOUS REGION OF THE FILE. NOTHING ELSE MOVES.
 *
 * That is what makes a proposed change reviewable, and it is why this module
 * never calls `doc.toString()`. It parses only to locate byte offsets, then
 * splices the original string, so every byte outside the spliced region is the
 * original byte by construction. Line endings survive for the same reason:
 * inserted text adopts the file's prevailing ending.
 *
 * Nothing here knows a country or a file name. The caller passes the file text
 * and one edit.
 */
import { parseDocument, stringify, isMap, isSeq, isScalar, type YAMLMap } from 'yaml';

/**
 * How to find the record being edited. `id` is the normal case.
 *
 * The index form exists for a file whose records are not yet keyed. It states
 * what it expects to find there and is refused if the record has moved, so a
 * stale index cannot write onto whichever record now occupies the slot.
 */
export type Target = { id: string } | { index: number; match?: Record<string, string> };

/** A single change to one record. Each maps to one contiguous splice. */
export type Edit =
  | { op: 'set'; target: Target; field: string; value: unknown }
  | { op: 'add-field'; target: Target; field: string; value: unknown; at?: 'start' | 'end' }
  | { op: 'remove-field'; target: Target; field: string }
  | { op: 'append-to-list'; target: Target; field: string; item: string }
  | { op: 'append-object'; target: Target; field: string; item: Record<string, unknown> }
  | { op: 'add-block'; target: Target; field: string; entries: Record<string, string> }
  | { op: 'append-record'; record: Record<string, unknown> };

const describe = (t: Target) => ('id' in t ? `"${t.id}"` : `#${t.index}`);

export class EmitError extends Error {}

/** The region a splice touched, so callers can render or assert on it. */
export interface Splice {
  text: string;
  start: number;
  end: number;
  replaced: string;
}

export interface EmitResult {
  text: string;
  splice: Splice;
}

/** Records as a parsed file yields them. */
export type Records = Array<Record<string, unknown>>;

export interface Splicer {
  applyEdit(fileText: string, edit: Edit): EmitResult;
  assertOnlyTargetChanged(before: string | Records, after: string | Records, targetId: string | null): void;
}

// ---------------------------------------------------------------------------
// Locating
// ---------------------------------------------------------------------------

type Doc = ReturnType<typeof parseDocument> & { contents: { items: unknown[] } };

/**
 * Parse once and thread the result through. A parse costs milliseconds; doing
 * it four times per edit is what made a full-corpus sweep minutes long. Two is
 * the floor: the source, and the result.
 */
function docOf(source: string): Doc {
  const doc = parseDocument(source);
  if (doc.errors.length) {
    throw new EmitError(`source does not parse: ${doc.errors[0].message}`);
  }
  if (!isSeq(doc.contents)) {
    throw new EmitError('expected a top-level sequence of records');
  }
  return doc as Doc;
}

function recordOf(doc: Doc, target: Target): YAMLMap {
  if ('id' in target) {
    for (const item of doc.contents.items) {
      if (isMap(item) && item.get('id') === target.id) return item;
    }
    throw new EmitError(`no record with id "${target.id}"`);
  }

  const item = doc.contents.items[target.index];
  if (!isMap(item)) throw new EmitError(`no record at index ${target.index}`);

  // A positional target must prove it still points at what the caller meant.
  for (const [field, expected] of Object.entries(target.match ?? {})) {
    const actual = item.get(field);
    if (actual !== expected) {
      throw new EmitError(
        `record #${target.index} has ${field}="${actual}", expected "${expected}"; ` +
          `the file has changed under this edit`
      );
    }
  }
  return item;
}

function pairOf(record: YAMLMap, field: string) {
  return record.items.find((p) => isScalar(p.key) && p.key.value === field);
}

/**
 * Byte range of a node's value, excluding any trailing comment and line break.
 *
 * yaml gives [start, value-end, node-end]; node-end swallows trailing comments
 * and the newline, so splicing to it would eat a reviewer's note.
 *
 * A block scalar is the one node whose value-end also includes the line break
 * that terminates it. That break is file structure, not value: splicing over it
 * glues the replacement onto the next key and the file stops parsing. Block
 * collections behave the same way, so both are trimmed here.
 */
function valueRange(node: unknown, source: string): [number, number] {
  const range = (node as { range?: [number, number, number] })?.range;
  if (!range) throw new EmitError('node carries no source range');
  let end = range[1];
  const type = (node as { type?: string })?.type;
  const block = type === 'BLOCK_FOLDED' || type === 'BLOCK_LITERAL' || isSeq(node) || isMap(node);
  if (block && source[end - 1] === '\n') {
    end--;
    if (source[end - 1] === '\r') end--;
  }
  return [range[0], end];
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

/**
 * Render one value as inline YAML.
 *
 * lineWidth: 0 disables folding: an inserted value must never introduce a wrap,
 * because a wrap is a second changed line and the splice stops being minimal.
 */
function inlineValue(value: unknown): string {
  /*
   * collectionStyle 'flow' is not cosmetic. The default is block, so a list came
   * out as "- a" on the same line as its key, which is not valid YAML. A
   * single-element list contains no newline, so it sailed past the one-line
   * check below and only a multi-element one was ever caught.
   *
   * flowCollectionPadding false matches how the files are already written.
   */
  const out = stringify(value, {
    lineWidth: 0,
    collectionStyle: 'flow',
    flowCollectionPadding: false
  }).trimEnd();
  if (out.includes('\n')) {
    throw new EmitError(`value does not fit on one line: ${JSON.stringify(value)}`);
  }
  /*
   * U+FFFD is the replacement character: it means some earlier step decoded
   * bytes it could not read and gave up, silently. It is never a character
   * anyone intended to write. Callers should reject bad input at the door; this
   * is the backstop for the paths that forget.
   */
  if (out.includes('\uFFFD')) {
    throw new EmitError(
      `value contains U+FFFD, the replacement character: its text was decoded ` +
        `from the wrong encoding somewhere upstream: ${JSON.stringify(out.slice(0, 60))}`
    );
  }

  /*
   * Quote scalars whose meaning depends on which YAML the reader implements.
   * `1957-07-26` is a string under YAML 1.2's core schema and a timestamp under
   * 1.1, so written unquoted it reads back differently depending on the parser.
   * Files this module edits are published exports that other people parse with
   * other libraries, so the emitted text is the property that matters.
   */
  if (typeof value === 'string' && /^[\d~<>?]/.test(value) && !out.startsWith('"')) {
    return JSON.stringify(value);
  }
  return out;
}

/** The file's prevailing line ending, so inserted lines match what is already there. */
function lineEnding(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Whitespace that puts a new line in the same column as `offset`.
 *
 * Not simply the leading whitespace of the line: a record's first key sits on
 * the `- id: x` line, where the leading whitespace is empty but the key's column
 * is 2. Blanking the non-whitespace turns `- ` into `  `, which is where the
 * record's other keys are.
 */
function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return source.slice(lineStart, offset).replace(/[^\t ]/g, ' ');
}

/**
 * Offset just past a record's last field, and the indentation its keys sit at.
 *
 * Insertion happens here rather than at the record's end range, because the end
 * range includes the blank line separating records: inserting past it would put
 * the new field inside the next record.
 */
function endOfFields(source: string, record: YAMLMap): { at: number; indent: string } {
  let last = -1;
  for (const pair of record.items) {
    const node = pair.value ?? pair.key;
    const [, end] = valueRange(node, source);
    if (end > last) last = end;
  }
  if (last < 0) throw new EmitError('record has no fields');

  // Carry past a trailing comment on the same line, so we insert below it.
  const nextNewline = source.indexOf('\n', last);
  const restOfLine = source.slice(last, nextNewline === -1 ? source.length : nextNewline);
  if (restOfLine.trimStart().startsWith('#')) last = nextNewline === -1 ? source.length : nextNewline;

  const firstKey = record.items[0].key;
  const [keyStart] = valueRange(firstKey, source);
  return { at: last, indent: indentAt(source, keyStart) };
}

function splice(source: string, start: number, end: number, text: string): EmitResult {
  return {
    text: source.slice(0, start) + text + source.slice(end),
    splice: { text, start, end, replaced: source.slice(start, end) }
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function opSet(source: string, doc: Doc, target: Target, field: string, value: unknown): EmitResult {
  const record = recordOf(doc, target);
  const pair = pairOf(record, field);
  if (!pair) throw new EmitError(`record ${describe(target)} has no field "${field}", use add-field`);
  if (!pair.value) throw new EmitError(`field "${field}" on ${describe(target)} has no value to replace`);

  const [start, end] = valueRange(pair.value, source);
  return splice(source, start, end, inlineValue(value));
}

function opAddField(
  source: string,
  doc: Doc,
  target: Target,
  field: string,
  value: unknown,
  where: 'start' | 'end' = 'end'
): EmitResult {
  const record = recordOf(doc, target);
  if (pairOf(record, field)) throw new EmitError(`record ${describe(target)} already has "${field}", use set`);

  const eol = lineEnding(source);

  if (where === 'start') {
    // Insert ahead of the first key, on the `- ` line. Records put their id
    // first, and a record whose id is buried at the bottom reads as an
    // afterthought rather than the record's name.
    const [keyStart] = valueRange(record.items[0].key, source);
    const indent = indentAt(source, keyStart);
    return splice(source, keyStart, keyStart, `${field}: ${inlineValue(value)}${eol}${indent}`);
  }

  const { at, indent } = endOfFields(source, record);
  // When the last field's value range ends at the start of the next record's
  // `- id:` line (no blank line between records), `at` sits on a `-` rather
  // than a newline. Without a trailing eol the new field concatenates with the
  // next record's dash on the same line, producing invalid YAML.
  const trail = at < source.length && source[at] !== '\n' && source[at] !== '\r' ? eol : '';
  return splice(source, at, at, `${eol}${indent}${field}: ${inlineValue(value)}${trail}`);
}

function opAppendToList(source: string, doc: Doc, target: Target, field: string, item: string): EmitResult {
  const record = recordOf(doc, target);
  const pair = pairOf(record, field);
  if (!pair?.value) throw new EmitError(`record ${describe(target)} has no list "${field}"`);
  if (!isSeq(pair.value)) throw new EmitError(`field "${field}" on ${describe(target)} is not a list`);

  const seq = pair.value;
  if (seq.items.some((i) => isScalar(i) && i.value === item)) {
    throw new EmitError(`"${item}" is already in ${describe(target)}.${field}`);
  }

  const [start, end] = valueRange(seq, source);
  const text = source.slice(start, end);

  if (text.trimStart().startsWith('[')) {
    // Flow sequence: insert before the closing bracket, preserving its spacing.
    const close = text.lastIndexOf(']');
    const inner = text.slice(0, close).trimEnd();
    const empty = inner.replace('[', '').trim() === '';
    const at = start + close;
    return splice(source, at, at, empty ? item : `, ${item}`);
  }

  // Block sequence: a new "- item" line at the dash column.
  const lastItem = seq.items[seq.items.length - 1];
  const [itemStart, itemEnd] = valueRange(lastItem, source);
  const dash = source.lastIndexOf('-', itemStart);
  const indent = indentAt(source, dash);
  const eol = lineEnding(source);
  return splice(source, itemEnd, itemEnd, `${eol}${indent}- ${item}`);
}

/**
 * Append one map entry to a block sequence of maps.
 *
 * `set` is the wrong tool here. It replaces the collection's whole byte range,
 * which for a block sequence includes the line break terminating the last
 * entry, so a one-line flow replacement glues the following key onto the same
 * line; and it reflows every existing entry into flow style, a whole-record
 * reformat dressed up as an append. Inserting at the last entry's value end
 * leaves every pre-existing byte of the sequence alone.
 */
function opAppendObject(
  source: string,
  doc: Doc,
  target: Target,
  field: string,
  item: Record<string, unknown>
): EmitResult {
  const record = recordOf(doc, target);
  const pair = pairOf(record, field);
  if (!pair?.value) throw new EmitError(`record ${describe(target)} has no list "${field}"`);
  if (!isSeq(pair.value)) throw new EmitError(`field "${field}" on ${describe(target)} is not a list`);

  const entries = Object.entries(item);
  if (entries.length === 0) throw new EmitError('an appended object needs at least one field');

  const seq = pair.value;
  const lastItem = seq.items[seq.items.length - 1];
  if (!lastItem || !isMap(lastItem)) {
    throw new EmitError(`field "${field}" on ${describe(target)} is not a block list of objects`);
  }

  const [itemStart, itemEnd] = valueRange(lastItem, source);
  const dash = source.lastIndexOf('-', itemStart);
  if (dash === -1) throw new EmitError(`could not locate the list dash for "${field}"`);
  const indent = indentAt(source, dash);
  const eol = lineEnding(source);
  const body = entries
    .map(([k, v], i) => `${i === 0 ? `${eol}${indent}- ` : `${eol}${indent}  `}${k}: ${inlineValue(v)}`)
    .join('');
  // A map's value range ends AFTER the line break that terminates it (a plain
  // scalar's does not), so when the entry is not the last line of the file the
  // break has to be re-added or the next key glues onto the appended body.
  const trail = itemEnd < source.length && source[itemEnd] !== '\n' && source[itemEnd] !== '\r' ? eol : '';
  return splice(source, itemEnd, itemEnd, body + trail);
}

/**
 * Remove a key and its value outright.
 *
 * Unlike every other operation this one deletes bytes, so the range has to be
 * the whole field: from the start of the key's line (not the key itself, or the
 * indentation is left behind as a whitespace-only line) through the line break
 * that ends the value. For a block scalar, `valueRange` stops before that break,
 * so the break is carried past explicitly.
 */
function opRemoveField(source: string, doc: Doc, target: Target, field: string): EmitResult {
  const record = recordOf(doc, target);
  const pair = pairOf(record, field);
  if (!pair) throw new EmitError(`record ${describe(target)} has no field "${field}" to remove`);
  if (!pair.value) throw new EmitError(`field "${field}" on ${describe(target)} has no value to remove`);

  const [keyStart] = valueRange(pair.key, source);
  const lineStart = source.lastIndexOf('\n', keyStart - 1) + 1;
  const [, valueEnd] = valueRange(pair.value, source);
  const newline = source.indexOf('\n', valueEnd);
  const end = newline === -1 ? source.length : newline + 1;
  return splice(source, lineStart, end, '');
}

/** A nested block of scalars, such as a `review:` entry. */
function opAddBlock(
  source: string,
  doc: Doc,
  target: Target,
  field: string,
  entries: Record<string, string>
): EmitResult {
  const record = recordOf(doc, target);
  if (pairOf(record, field)) throw new EmitError(`record ${describe(target)} already has "${field}"`);
  if (Object.keys(entries).length === 0) throw new EmitError(`block "${field}" is empty`);

  const { at, indent } = endOfFields(source, record);
  const eol = lineEnding(source);
  const inner = indent + '  ';
  const lines = Object.entries(entries).map(([k, v]) => `${eol}${inner}${k}: ${inlineValue(v)}`);
  const trail = at < source.length && source[at] !== '\n' && source[at] !== '\r' ? eol : '';
  return splice(source, at, at, `${eol}${indent}${field}:` + lines.join('') + trail);
}

/**
 * A new record at the end of the file.
 *
 * Appending rather than inserting into a themed section is deliberate: section
 * comments are editorial, and guessing where a record belongs would file it
 * under a heading that may not describe it. A human can move it; a human cannot
 * easily notice that it was silently filed wrong.
 */
function opAppendRecord(source: string, doc: Doc, record: Record<string, unknown>): EmitResult {
  if (typeof record.id !== 'string' || !record.id) {
    throw new EmitError('a new record needs a string id');
  }
  for (const item of doc.contents.items) {
    if (isMap(item) && item.get('id') === record.id) {
      throw new EmitError(`record "${record.id}" already exists`);
    }
  }

  const eol = lineEnding(source);
  const body = Object.entries(record)
    .map(([k, v], i) => `${i === 0 ? '- ' : '  '}${k}: ${inlineValue(v)}`)
    .join(eol);

  // Append after the file's existing trailing newline, separated by a blank line.
  const trimmed = source.replace(/[\r\n]+$/, '');
  return splice(source, trimmed.length, source.length, `${eol}${eol}${body}${eol}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Apply one edit. Returns the new file text and the region that changed.
 *
 * The single-contiguous-region property is asserted, not assumed: if an
 * operation ever produced a scattered change, this throws rather than writing
 * the file. A silent whole-file rewrite is the failure this module exists to
 * prevent, so it must not be possible to ship one even through a bug here.
 */
export function applyEdit(source: string, edit: Edit): EmitResult {
  const doc = docOf(source);
  const result = (() => {
    switch (edit.op) {
      case 'set':
        return opSet(source, doc, edit.target, edit.field, edit.value);
      case 'add-field':
        return opAddField(source, doc, edit.target, edit.field, edit.value, edit.at);
      case 'remove-field':
        return opRemoveField(source, doc, edit.target, edit.field);
      case 'append-to-list':
        return opAppendToList(source, doc, edit.target, edit.field, edit.item);
      case 'append-object':
        return opAppendObject(source, doc, edit.target, edit.field, edit.item);
      case 'add-block':
        return opAddBlock(source, doc, edit.target, edit.field, edit.entries);
      case 'append-record':
        return opAppendRecord(source, doc, edit.record);
    }
  })();

  // The result must still be YAML. Schema validation is the caller's job (it
  // needs the whole file set to check cross-file references), but a file that
  // no longer parses must never reach disk.
  const reparsed = parseDocument(result.text);
  if (reparsed.errors.length) {
    throw new EmitError(`edit produced invalid YAML: ${reparsed.errors[0].message}`);
  }

  // Both sides are already parsed here; hand the guard the trees rather than
  // the strings so it does not parse a third and fourth time.
  const before = doc.toJS() as Records;

  /*
   * The guard keys records by id, falling back to position. So the target's key
   * has to be read off the RECORD, not off the form of the target: an index
   * targeted edit to a record that has an id is keyed by that id, and only a
   * record with no id is keyed by its position.
   *
   * Deriving it from the target form instead meant an index targeted edit to a
   * keyed record looked to the guard like damage to an unrelated record: the
   * target was never exempted, because the guard was looking for "#0" and the
   * record was called something else.
   */
  let targetKey: string | null = null;
  if (edit.op !== 'append-record') {
    if ('id' in edit.target) targetKey = edit.target.id;
    else {
      const existing = before[edit.target.index]?.id;
      targetKey = typeof existing === 'string' ? existing : `#${edit.target.index}`;
    }
  }

  assertOnlyTargetChanged(before, reparsed.toJS() as Records, targetKey);

  return result;
}

/**
 * Verify that no record except the target came out different.
 *
 * The check is semantic, not textual. Comparing common prefix and suffix
 * lengths would call a change "contiguous" for any pair of strings, which is
 * true and useless, and would accept a file with two separate edits in it.
 *
 * `targetId` is null for an append, where every pre-existing record must survive
 * untouched and exactly one new one may appear.
 */
export function assertOnlyTargetChanged(
  before: string | Records,
  after: string | Records,
  targetId: string | null
): void {
  const index = (source: string | Records) => {
    const parsed = typeof source === 'string' ? (parseDocument(source).toJS() as Records) : source;
    const map = new Map<string, string>();
    const order: string[] = [];
    parsed.forEach((record, i) => {
      // Records without an id are keyed by position. Skipping them would make
      // this guard silently vacuous across a file with no ids at all, where a
      // misplaced edit is hardest to notice because the records look alike.
      const key = typeof record?.id === 'string' ? record.id : `#${i}`;
      map.set(key, JSON.stringify(record));
      order.push(key);
    });
    return { map, order };
  };

  const a = index(before);
  const b = index(after);

  for (const [id, value] of a.map) {
    if (id === targetId) continue;
    if (!b.map.has(id)) throw new EmitError(`edit deleted unrelated record "${id}"`);
    if (b.map.get(id) !== value) throw new EmitError(`edit altered unrelated record "${id}"`);
  }

  const expected = targetId === null ? a.order.length + 1 : a.order.length;
  if (b.order.length !== expected) {
    throw new EmitError(`record count went ${a.order.length} -> ${b.order.length}, expected ${expected}`);
  }

  // Order is meaning: records sit under editorial section comments, so a
  // reordering would silently refile a record under the wrong heading.
  //
  // One slot may legitimately change key: the target's. A record with no id is
  // keyed by position, so giving it an id changes its key without moving it.
  // Only that slot is exempt, and only when it is the slot being edited.
  const exempt = targetId === null ? -1 : a.order.indexOf(targetId);
  for (let i = 0; i < a.order.length; i++) {
    if (i === exempt) continue;
    if (a.order[i] !== b.order[i]) {
      throw new EmitError(`edit reordered records at position ${i}: ${a.order[i]} -> ${b.order[i]}`);
    }
  }
}

/** One splicer. It holds no state, so a caller may share or copy it. */
export function createSplicer(): Splicer {
  return Object.freeze({ applyEdit, assertOnlyTargetChanged });
}
