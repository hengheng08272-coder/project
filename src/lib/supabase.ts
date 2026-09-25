import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the build has no Supabase credentials; App shows a setup screen. */
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// createClient throws on an empty URL, which would blank the whole page before
// anything can explain why. Fall back to a placeholder so the app still mounts
// and can say what is missing.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);

/**
 * PostgREST answers at most 1000 rows per request and does not say when it
 * truncated: a group with 1500 videos came back as 1000, so topics whose
 * videos sat past that cut-off looked empty and every total was understated.
 * Anything that means "all of them" pages through instead.
 *
 * `build` runs once per page and must return a fresh, ordered query -- the
 * order is what keeps consecutive pages from overlapping or skipping rows.
 */
const PAGE_SIZE = 1000;

interface PageQuery {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

export async function fetchAll<T>(build: () => PageQuery): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error || !data) return all;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) return all;
  }
}
