import { useState } from 'react';
import { Loader2, Lock, Mail, AlertTriangle, MailCheck } from 'lucide-react';

import { AppLogo } from '@/components/Brand';
import {
  TelegramLoginButton,
  telegramLoginConfigured,
  type TelegramAuthPayload,
} from '@/components/TelegramLoginButton';
import { useLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { telegramLogin } from '@/lib/backend';

type Mode = 'signin' | 'signup';

/**
 * The only screen a visitor sees before they've authenticated. Each
 * subscriber gets their own Supabase Auth account, and everything downstream
 * (their groups, their Telegram connection, their R2 bucket) is scoped to it.
 */
export function AuthPage() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkEmail, setCheckEmail] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup' && password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);
    const result =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    // A fresh sign-up with email confirmation enabled comes back with no
    // session yet -- the account exists, but can't sign in until confirmed.
    if (mode === 'signup' && !result.data.session) {
      setCheckEmail(true);
    }
  };

  const handleTelegramAuth = async (payload: TelegramAuthPayload) => {
    setError('');
    setLoading(true);
    try {
      // token_hash alone is the whole credential -- pairing it with email
      // makes Supabase reject the call ("Only the token_hash and type should
      // be provided"), which is why the widget button used to fail outright.
      const { token_hash } = await telegramLogin(payload as unknown as Record<string, unknown>);
      const { error: otpError } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
      if (otpError) throw otpError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Telegram sign-in failed.');
    }
    setLoading(false);
  };

  if (checkEmail) {
    return (
      <div className="flex min-h-[var(--tg-vh)] items-center justify-center bg-dark-950 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-dark-800 bg-dark-900/60 p-6 text-center">
          <MailCheck className="mx-auto mb-3 h-10 w-10 text-success-400" />
          <h2 className="mb-1 text-base font-bold text-white">{t('auth.checkEmailTitle')}</h2>
          <p className="mb-5 text-sm text-dark-400">{t('auth.checkEmailBody')}</p>
          <button
            onClick={() => {
              setCheckEmail(false);
              setMode('signin');
            }}
            className="w-full rounded-lg bg-dark-800 px-4 py-2.5 text-sm font-medium text-dark-300 transition-colors hover:bg-dark-700"
          >
            {t('auth.backToSignIn')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[var(--tg-vh)] items-center justify-center bg-dark-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <AppLogo size={48} className="glow" />
          <div>
            <p className="text-base font-bold text-white">{t('nav.appName')}</p>
            <p className="text-xs text-dark-500">{t('auth.tagline')}</p>
          </div>
        </div>

        {telegramLoginConfigured && (
          <div className="mb-4 rounded-2xl border border-dark-800 bg-dark-900/60 p-6">
            <TelegramLoginButton onAuth={handleTelegramAuth} />
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-dark-800 bg-dark-900/60 p-6"
        >
          {telegramLoginConfigured && (
            <p className="-mt-1 mb-1 text-center text-[11px] uppercase tracking-wide text-dark-600">
              {t('auth.orEmail')}
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-xs text-error-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-dark-400">
              <Mail className="h-3.5 w-3.5" /> {t('auth.email')}
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-white outline-none transition-colors placeholder-dark-600 focus:border-primary-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-dark-400">
              <Lock className="h-3.5 w-3.5" /> {t('auth.password')}
            </label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-white outline-none transition-colors placeholder-dark-600 focus:border-primary-500"
              placeholder="••••••••"
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-dark-400">
                <Lock className="h-3.5 w-3.5" /> {t('auth.confirmPassword')}
              </label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-white outline-none transition-colors placeholder-dark-600 focus:border-primary-500"
                placeholder="••••••••"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
          </button>

          <p className="text-center text-xs text-dark-500">
            {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
            <button
              type="button"
              onClick={() => {
                setError('');
                setMode(mode === 'signin' ? 'signup' : 'signin');
              }}
              className="font-medium text-primary-400 hover:text-primary-300"
            >
              {mode === 'signin' ? t('auth.switchToSignUp') : t('auth.switchToSignIn')}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
