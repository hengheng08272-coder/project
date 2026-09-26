import { AlertTriangle } from 'lucide-react';

import { AppLogo } from '@/components/Brand';

/**
 * Shown instead of the app when the build has no Supabase credentials.
 * Without this the page is simply blank and the reason is only in the console.
 */
export function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-950 p-6 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-dark-800 bg-dark-900 p-6">
        <div className="mb-4 flex items-center gap-3">
          <AppLogo size={40} />
          <div>
            <h1 className="text-lg font-bold">SaveIt KH</h1>
            <p className="text-xs text-dark-500">Configuration needed</p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm text-warning-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The database credentials are missing from this build, so nothing can load.
          </span>
        </div>

        <p className="mt-4 text-xs text-dark-400">
          Set these where the site is built (Vercel → Settings → Environment Variables, or a
          local <code className="rounded bg-dark-800 px-1 py-0.5 font-mono">.env</code> file),
          then redeploy:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-dark-800 bg-dark-950 p-3 font-mono text-[11px] leading-relaxed text-dark-300">
          <code>{`VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>

# Optional, but scanning and forwarding need it:
VITE_TELEGRAM_BACKEND_URL=http://localhost:8000
VITE_TELEGRAM_BACKEND_KEY=<same as BACKEND_API_KEY>`}</code>
        </pre>
        <p className="mt-3 text-[11px] text-dark-500">
          The values live in your Supabase project under Settings → API. Vite reads them at build
          time, so a redeploy is required after changing them.
        </p>
      </div>
    </div>
  );
}
