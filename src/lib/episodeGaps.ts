/**
 * Which episode numbers a topic is missing.
 *
 * A series topic is supposed to run 1..N with nothing skipped, but an upload
 * can be deleted, fail to post, or simply never happen -- and with hundreds of
 * episodes per topic nobody spots the hole by scrolling. Everything here works
 * off ep_number alone, so it costs no extra request.
 */
export interface EpisodeGapReport {
  /** Lowest and highest episode number seen, or null when none is numbered. */
  first: number | null;
  last: number | null;
  /** Numbers between first and last that no video carries. */
  missing: number[];
  /** Numbers carried by more than one video -- usually a re-upload. */
  repeated: number[];
  /** Videos whose title had no recognizable episode number at all. */
  unnumbered: number;
}

export function findEpisodeGaps(episodes: { ep_number: number | null }[]): EpisodeGapReport {
  const counts = new Map<number, number>();
  let unnumbered = 0;

  for (const episode of episodes) {
    const ep = episode.ep_number;
    if (ep == null || !Number.isFinite(ep)) {
      unnumbered += 1;
      continue;
    }
    counts.set(ep, (counts.get(ep) ?? 0) + 1);
  }

  if (counts.size === 0) return { first: null, last: null, missing: [], repeated: [], unnumbered };

  const numbers = [...counts.keys()].sort((a, b) => a - b);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];

  const missing: number[] = [];
  for (let n = first; n <= last; n += 1) {
    if (!counts.has(n)) missing.push(n);
  }

  return {
    first,
    last,
    missing,
    repeated: numbers.filter((n) => (counts.get(n) ?? 0) > 1),
    unnumbered,
  };
}

/**
 * "1, 4-7, 12" -- consecutive numbers collapse into a range, because a topic
 * missing fifty episodes in a row should not print fifty numbers. `max` caps
 * how many groups are listed; the rest become "+n".
 */
export function formatNumberRanges(numbers: number[], max = 6): string {
  if (numbers.length === 0) return '';
  const groups: string[] = [];
  let start = numbers[0];
  let prev = numbers[0];

  const flush = () => groups.push(start === prev ? String(start) : `${start}-${prev}`);

  for (const n of numbers.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    flush();
    start = n;
    prev = n;
  }
  flush();

  if (groups.length <= max) return groups.join(', ');
  return `${groups.slice(0, max).join(', ')} +${groups.length - max}`;
}
