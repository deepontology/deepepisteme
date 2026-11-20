/**
 * atlas/resolve.ts: which record kinds are dated, and where their authored
 * interval tokens sit.
 *
 * The resolving itself is engine machinery and lives in resolve() in
 * src/engine.ts. What belongs here is the atlas fact each row states: the field
 * names one kind carries its start and end in, whether an envelope that ends
 * before it begins may be trimmed because the record itself disputes the span,
 * and whether `ongoing` is settled against the record's sources and held to
 * the cutoff contract.
 *
 * Ported from the consumer's build script, which resolves the same kinds the
 * same way before it emits them. A kind that carries authored date tokens but
 * no resolved interval there (an agreement, a world claim, a declaration, a
 * person's birth and death) has no row here either.
 */

/** One dated kind, as loose rows: resolve runs after parse, not instead of it. */
type Row = Record<string, unknown>;

export interface DatedKind {
  readonly kind: string;
  /** The record's authored interval tokens, in the kind's own field names. */
  spec(record: Row): { start?: string | null; end?: string | null };
  /**
   * Whether an over-wide envelope may be trimmed because the record records
   * the disagreement as a dispute (V22). Kinds without this keep the failure.
   */
  allowEnvelopeTrim?(record: Row): boolean;
  /**
   * Whether `ongoing` is settled against the record's latest dated source and
   * the end is held to the cutoff. A kind that anchors a point in time (a
   * licence's grant) resolves its tokens and nothing more.
   */
  readonly settled: boolean;
}

function token(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The trim escape the consumer grants exactly the three disputed kinds. */
function disputesItself(record: Row): boolean {
  return Array.isArray(record.disputes) && record.disputes.length > 0;
}

/** The span a record's own start and end fields describe. */
function span(record: Row): { start?: string; end?: string } {
  return { start: token(record.start), end: token(record.end) };
}

export const DATED_KINDS: readonly DatedKind[] = Object.freeze([
  {
    kind: 'position',
    spec: span,
    allowEnvelopeTrim: disputesItself,
    settled: true
  },
  {
    kind: 'relationship',
    spec: span,
    allowEnvelopeTrim: disputesItself,
    settled: true
  },
  {
    kind: 'event',
    // An event may span time; a point event is its own end.
    spec: (record) => span({ start: record.date, end: record.date_end ?? record.date }),
    allowEnvelopeTrim: disputesItself,
    settled: true
  },
  { kind: 'era', spec: span, settled: true },
  { kind: 'contract', spec: span, settled: true },
  { kind: 'vacancy', spec: span, settled: true },
  { kind: 'education', spec: span, settled: true },
  {
    kind: 'institution',
    // An institution carries its span in an `active` object rather than on
    // the record itself.
    spec: (record) => {
      const active = (record.active ?? {}) as { start?: unknown; end?: unknown };
      return { start: token(active.start), end: token(active.end) };
    },
    settled: true
  },
  {
    kind: 'licence',
    // A licence anchors the grant; the consumer resolves no end for it.
    spec: (record) => ({ start: token(record.grant), end: null }),
    settled: false
  }
]);
