/**
 * emit.ts — the single-region splicer.
 *
 * Data lives in data/*.yaml, CRLF. The build emits dataset.json, but the
 * admin / community write-path must edit YAML without reflowing the file.
 * An edit that reflows 900 unrelated lines is not reviewable — it is a
 * rubber stamp with extra steps.
 *
 * This module never calls doc.toString(). It parses only to locate byte
 * offsets, then splices the original string. Every byte outside the spliced
 * region is the original byte, by construction.
 *
 * Line endings are preserved: the source is spliced as read, CRLF and all,
 * and inserted text adopts the file's prevailing ending.
 */

import { parseDocument, stringify, isMap, isSeq, isScalar, type YAMLMap } from 'yaml';

export type Target = { id: string } | { index: number; match?: Record<string, string> };

export type Edit =
  | { op: 'set'; target: Target; field: string; value: unknown }
  | { op: 'add-field'; target: Target; field: string; value: unknown; at?: 'start' | 'end' }
  | { op: 'append-to-list'; target: Target; field: string; item: string }
  | { op: 'add-block'; target: Target; field: string; entries: Record<string, string> }
  | { op: 'append-record'; record: Record<string, unknown> };

const describe = (t: Target) => ('id' in t ? `"${t.id}"` : `#${t.index}`);

export class EmitError extends Error {}

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

type Doc = ReturnType<typeof parseDocument> & { contents: { items: unknown[] } };
type Records = Array<Record<string, unknown>>;

function docOf(source: string): Doc {
  const doc = parseDocument(source);
  if (doc.errors.length) throw new EmitError(`source does not parse: ${doc.errors[0].message}`);
  if (!isSeq(doc.contents)) throw new EmitError('expected a top-level sequence');
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
  for (const [field, expected] of Object.entries(target.match ?? {})) {
    const actual = item.get(field);
    if (actual !== expected) {
      throw new EmitError(
        `record #${target.index} has ${field}="${actual}", expected "${expected}" — file changed under edit`
      );
    }
  }
  return item;
}

function pairOf(record: YAMLMap, field: string) {
  return record.items.find((p) => isScalar(p.key) && p.key.value === field);
}

function valueRange(node: unknown): [number, number] {
  const range = (node as { range?: [number, number, number] })?.range;
  if (!range) throw new EmitError('node carries no source range');
  return [range[0], range[1]];
}

function inlineValue(value: unknown): string {
  const out = stringify(value, { lineWidth: 0, collectionStyle: 'flow', flowCollectionPadding: false }).trimEnd();
  if (out.includes('\n')) throw new EmitError(`value does not fit on one line: ${JSON.stringify(value)}`);
  if (out.includes('�')) throw new EmitError(`value contains U+FFFD: ${JSON.stringify(out.slice(0, 60))}`);
  if (typeof value === 'string' && /^[\d~<>?]/.test(value) && !out.startsWith('"')) {
    return JSON.stringify(value);
  }
  return out;
}

function lineEnding(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return source.slice(lineStart, offset).replace(/[^\t ]/g, ' ');
}

function endOfFields(source: string, record: YAMLMap): { at: number; indent: string } {
  let last = -1;
  for (const pair of record.items) {
    const node = pair.value ?? pair.key;
    const [, end] = valueRange(node);
    if (end > last) last = end;
  }
  if (last < 0) throw new EmitError('record has no fields');
  const nextNewline = source.indexOf('\n', last);
  const restOfLine = source.slice(last, nextNewline === -1 ? source.length : nextNewline);
  if (restOfLine.trimStart().startsWith('#')) last = nextNewline === -1 ? source.length : nextNewline;
  const firstKey = record.items[0].key;
  const [keyStart] = valueRange(firstKey);
  return { at: last, indent: indentAt(source, keyStart) };
}

function splice(source: string, start: number, end: number, text: string): EmitResult {
  return { text: source.slice(0, start) + text + source.slice(end), splice: { text, start, end, replaced: source.slice(start, end) } };
}

function opSet(source: string, doc: Doc, target: Target, field: string, value: unknown): EmitResult {
  const record = recordOf(doc, target);
  const pair = pairOf(record, field);
  if (!pair) throw new EmitError(`record ${describe(target)} has no field "${field}" — use add-field`);
  if (!pair.value) throw new EmitError(`field "${field}" on ${describe(target)} has no value`);
  const [start, end] = valueRange(pair.value);
  return splice(source, start, end, inlineValue(value));
}

function opAddField(source: string, doc: Doc, target: Target, field: string, value: unknown, where: 'start'|'end'='end'): EmitResult {
  const record = recordOf(doc, target);
  if (pairOf(record, field)) throw new EmitError(`record ${describe(target)} already has "${field}" — use set`);
  const eol = lineEnding(source);
  if (where === 'start') {
    const [keyStart] = valueRange(record.items[0].key);
    const indent = indentAt(source, keyStart);
    return splice(source, keyStart, keyStart, `${field}: ${inlineValue(value)}${eol}${indent}`);
  }
  const { at, indent } = endOfFields(source, record);
  const trail = at < source.length && source[at] !== '\n' && source[at] !== '\r' ? eol : '';
  return splice(source, at, at, `${eol}${indent}${field}: ${inlineValue(value)}${trail}`);
}

function opAppendToList(source: string, doc: Doc, target: Target, field: string, item: string): EmitResult {
  const record = recordOf(doc, target);
  const pair = pairOf(record, field);
  if (!pair?.value) throw new EmitError(`record ${describe(target)} has no list "${field}"`);
  if (!isSeq(pair.value)) throw new EmitError(`field "${field}" on ${describe(target)} is not a list`);
  const seq = pair.value;
  if (seq.items.some((i) => isScalar(i) && i.value === item)) throw new EmitError(`"${item}" already in ${describe(target)}.${field}`);
  const [start, end] = valueRange(seq);
  const text = source.slice(start, end);
  if (text.trimStart().startsWith('[')) {
    const close = text.lastIndexOf(']');
    const inner = text.slice(0, close).trimEnd();
    const empty = inner.replace('[', '').trim() === '';
    const at = start + close;
    return splice(source, at, at, empty ? item : `, ${item}`);
  }
  const lastItem = seq.items[seq.items.length - 1];
  const [, itemEnd] = valueRange(lastItem);
  const dash = source.lastIndexOf('-', itemEnd - 1);
  // find the dash of last item; fallback to itemEnd
  const dashPos = dash !== -1 ? dash : itemEnd;
  const indent = indentAt(source, dashPos);
  const eol = lineEnding(source);
  return splice(source, itemEnd, itemEnd, `${eol}${indent}- ${item}`);
}

function opAddBlock(source: string, doc: Doc, target: Target, field: string, entries: Record<string, string>): EmitResult {
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

function opAppendRecord(source: string, doc: Doc, record: Record<string, unknown>): EmitResult {
  if (typeof record.id !== 'string' || !record.id) throw new EmitError('a new record needs a string id');
  for (const item of doc.contents.items) {
    if (isMap(item) && item.get('id') === record.id) throw new EmitError(`record "${record.id}" already exists`);
  }
  const eol = lineEnding(source);
  const body = Object.entries(record).map(([k, v], i) => `${i === 0 ? '- ' : '  '}${k}: ${inlineValue(v)}`).join(eol);
  const trimmed = source.replace(/[\r\n]+$/, '');
  return splice(source, trimmed.length, source.length, `${eol}${eol}${body}${eol}`);
}

export function applyEdit(source: string, edit: Edit): EmitResult {
  const doc = docOf(source);
  const result = (() => {
    switch (edit.op) {
      case 'set': return opSet(source, doc, edit.target, edit.field, edit.value);
      case 'add-field': return opAddField(source, doc, edit.target, edit.field, edit.value, edit.at);
      case 'append-to-list': return opAppendToList(source, doc, edit.target, edit.field, edit.item);
      case 'add-block': return opAddBlock(source, doc, edit.target, edit.field, edit.entries);
      case 'append-record': return opAppendRecord(source, doc, edit.record);
    }
  })();
  const reparsed = parseDocument(result.text);
  if (reparsed.errors.length) throw new EmitError(`edit produced invalid YAML: ${reparsed.errors[0].message}`);
  const before = doc.toJS() as Records;
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

export function assertOnlyTargetChanged(before: string|Records, after: string|Records, targetId: string|null): void {
  const index = (source: string|Records) => {
    const parsed = typeof source === 'string' ? (parseDocument(source).toJS() as Records) : source;
    const map = new Map<string,string>();
    const order: string[] = [];
    parsed.forEach((record, i) => {
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
  if (b.order.length !== expected) throw new EmitError(`record count went ${a.order.length} -> ${b.order.length}, expected ${expected}`);
  const exempt = targetId === null ? -1 : a.order.indexOf(targetId);
  for (let i=0; i<a.order.length; i++) {
    if (i===exempt) continue;
    if (a.order[i] !== b.order[i]) throw new EmitError(`edit reordered records at ${i}: ${a.order[i]} -> ${b.order[i]}`);
  }
}
