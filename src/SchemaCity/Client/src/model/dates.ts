/**
 * The date half of an ISO timestamp, or null for none and for the epoch, which only
 * a pinned fixture or a snapshot without a real date carries. The date half rather
 * than a local date, so it reads the same on every machine.
 */
export const dayOf = (iso: string | null | undefined): string | null =>
  iso && !iso.startsWith("1970-01-01") ? iso.slice(0, 10) : null;
