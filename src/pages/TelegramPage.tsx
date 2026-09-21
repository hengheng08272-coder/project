import { useEffect, useState } from 'react';
import {
  Send,
  Phone,
  Key,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Zap,
  Shield,
  User,
  Hash,
  AtSign,
  RotateCcw,
  PackageOpen,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { callBackend, checkHealth, startTakeout, stopTakeout } from '@/lib/backend';
import { useLanguage } from '@/lib/i18n';
import type { TelegramSettings } from '@/lib/types';
import { formatTimeAgo } from '@/lib/utils';

const EMPTY_SETTINGS: TelegramSettings = {
  id: '', api_id: '', api_hash: '', phone: '', session_string: '',
  connected: false, last_connected_at: null,
  account_first_name: null, account_last_name: null,
  account_username: null, account_user_id: null,
  storage_chat_id: null,
  created_at: '', updated_at: '',
};

export function TelegramPage() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  // Snapshot of the last saved/loaded credentials — Reset reverts to this.
  const [savedSettings, setSavedSettings] = useState<TelegramSettings>(EMPTY_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const [takeoutActive, setTakeoutActive] = useState(false);
  const [takeoutBusy, setTakeoutBusy] = useState(false);
  const [takeoutError, setTakeoutError] = useState('');
  const [takeoutNotice, setTakeoutNotice] = useState('');

  useEffect(() => {
    checkHealth()
      .then((health) => setTakeoutActive(health.takeout))
      .catch(() => {
        /* Backend unreachable — leave it as not active rather than guessing. */
      });
  }, []);

  const handleStartTakeout = async () => {
    setTakeoutBusy(true);
    setTakeoutError('');
    setTakeoutNotice('');
    try {
      const result = await startTakeout();
      setTakeoutActive(true);
      setTakeoutNotice(result.already_active ? t('tg.takeoutAlreadyRunning') : t('tg.takeoutStarted'));
    } catch (err) {
      setTakeoutError(err instanceof Error ? err.message : t('tg.takeoutStartFailed'));
    }
    setTakeoutBusy(false);
  };

  const handleStopTakeout = async () => {
    setTakeoutBusy(true);
    setTakeoutError('');
    setTakeoutNotice('');
    try {
      await stopTakeout(true);
      setTakeoutActive(false);
      setTakeoutNotice(t('tg.takeoutEnded'));
    } catch (err) {
      setTakeoutError(err instanceof Error ? err.message : t('tg.takeoutStopFailed'));
    }
    setTakeoutBusy(false);
  };

  useEffect(() => {
    (async () => {
      const { data, error: loadError } = await supabase.from('telegram_settings').select('*').maybeSingle();
      if (loadError) {
        setError(t('tg.errLoadSettings'));
      } else if (data) {
        setSettings(data as TelegramSettings);
        setSavedSettings(data as TelegramSettings);
        setConnected((data as TelegramSettings).connected);
      } else {
        setSettings(EMPTY_SETTINGS);
        setSavedSettings(EMPTY_SETTINGS);
      }
      setLoading(false);
    })();
  }, []);

  const isDirty = !!settings && (
    (settings.api_id || '') !== (savedSettings.api_id || '') ||
    (settings.api_hash || '') !== (savedSettings.api_hash || '') ||
    (settings.phone || '') !== (savedSettings.phone || '') ||
    (settings.storage_chat_id || '') !== (savedSettings.storage_chat_id || '')
  );

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    const result = settings.id
      ? await supabase.from('telegram_settings').update({
          api_id: settings.api_id,
          api_hash: settings.api_hash,
          phone: settings.phone,
          storage_chat_id: settings.storage_chat_id,
        }).eq('id', settings.id)
      : await supabase.from('telegram_settings').insert({
          api_id: settings.api_id,
          api_hash: settings.api_hash,
          phone: settings.phone,
          storage_chat_id: settings.storage_chat_id,
        }).select().maybeSingle();

    if (result.error) {
      setError(t('tg.errSaveCredentials'));
    } else {
      const updated = !settings.id && result.data
        ? { ...settings, id: (result.data as TelegramSettings).id }
        : settings;
      setSettings(updated);
      setSavedSettings(updated);
    }
    setSaving(false);
  };

  // Discards unsaved edits and reverts the form to the last saved credentials
  // (or a blank form if nothing has been saved yet). Does not touch the DB.
  const handleReset = () => {
    setError('');
    setSettings(savedSettings);
  };

  const handleConnect = async () => {
    setError('');
    setConnecting(true);
    try {
      await callBackend('/api/telegram/send-code');
      setAwaitingCode(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tg.errSendCode'));
    } finally {
      setConnecting(false);
    }
  };

  const handleVerify = async () => {
    setError('');
    setConnecting(true);
    try {
      const result = await callBackend('/api/telegram/verify-code', {
        code,
        password: needsPassword ? password : undefined,
      });
      if (result.needsPassword) {
        setNeedsPassword(true);
        return;
      }
      setConnected(true);
      setAwaitingCode(false);
      setCode('');
      setPassword('');
      setNeedsPassword(false);
      const { data } = await supabase.from('telegram_settings').select('*').maybeSingle();
      if (data) setSettings(data as TelegramSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tg.errVerifyCode'));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError('');
    try {
      await callBackend('/api/telegram/logout');
    } catch {
      // fall through and clear local state / DB flag either way
    }
    setConnected(false);
    setAwaitingCode(false);
    if (settings?.id) {
      const { error: disconnectError } = await supabase.from('telegram_settings').update({ connected: false }).eq('id', settings.id);
      if (disconnectError) setError(t('tg.errDisconnect'));
    }
  };

  const update = (field: keyof TelegramSettings, value: string) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-primary-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {/* Connection Status */}
      <div className={`relative overflow-hidden rounded-2xl border p-6 ${
        connected ? 'border-success-500/30 bg-gradient-to-br from-success-500/10 to-dark-900' : 'border-dark-800 bg-dark-900/60'
      }`}>
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${connected ? 'bg-success-500/20' : 'bg-dark-800'}`}>
              <Send className={`w-6 h-6 ${connected ? 'text-success-400' : 'text-dark-500'}`} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{t('tg.title')}</h2>
              <p className="text-xs text-dark-500">
                {connected
                  ? (settings?.account_username
                      ? `@${settings.account_username}`
                      : settings?.account_first_name || settings?.phone || t('tg.userFallback'))
                  : t('tg.notConnected')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {connected ? (
              <>
                <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success-500/10 text-success-400 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4" /> {t('tg.active')}
                </span>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-800 hover:bg-error-500/20 text-dark-400 hover:text-error-400 text-xs font-medium transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" /> {t('tg.disconnect')}
                </button>
              </>
            ) : (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-800 text-dark-400 text-xs font-medium">
                <XCircle className="w-4 h-4" /> {t('tg.offline')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* API Credentials */}
      <div className={`rounded-xl border p-5 transition-colors ${isDirty ? 'border-warning-500/30 bg-dark-900/60' : 'border-dark-800 bg-dark-900/60'}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Key className="w-4 h-4 text-primary-400" /> {t('tg.apiCredentials')}
          </h3>
          {isDirty && (
            <span className="text-[10px] text-warning-400 font-medium px-2 py-0.5 rounded-full bg-warning-500/10 border border-warning-500/20">
              {t('tg.unsaved')}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">{t('tg.apiId')}</label>
            <input
              type="text"
              value={settings?.api_id || ''}
              onChange={(e) => update('api_id', e.target.value)}
              placeholder="12345678"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-dark-400 font-medium block mb-1.5">{t('tg.apiHash')}</label>
            <input
              type="password"
              value={settings?.api_hash || ''}
              onChange={(e) => update('api_hash', e.target.value)}
              placeholder="your_api_hash_here"
              className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors font-mono"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-dark-400 font-medium block mb-1.5">{t('tg.phoneNumber')}</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input
                type="text"
                value={settings?.phone || ''}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="+85512345678"
                className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-dark-400 font-medium block mb-1.5">{t('tg.storageChatId')}</label>
            <div className="relative">
              <Send className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input
                type="text"
                value={settings?.storage_chat_id || ''}
                onChange={(e) => update('storage_chat_id', e.target.value)}
                placeholder="-1001234567890"
                className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors font-mono"
              />
            </div>
            <p className="mt-1.5 text-[10px] text-dark-500">{t('tg.storageChatIdHint')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('tg.saveCredentials')}
          </button>
          <button
            onClick={handleReset}
            disabled={saving || !isDirty}
            title={t('tg.resetTitle')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" /> {t('tg.reset')}
          </button>
          {isDirty && (
            <span className="text-[11px] text-warning-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> {t('tg.unsavedChanges')}
            </span>
          )}
        </div>
      </div>

      {/* Connection / OTP */}
      {!connected && (
        <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-warning-400" /> {t('tg.connectUserbot')}
          </h3>
          <div>
            {!awaitingCode ? (
              <>
                <p className="text-xs text-dark-400 mb-4">
                  {t('tg.connectInstructions')}
                </p>
                <button
                  onClick={handleConnect}
                  disabled={!settings?.api_id || !settings?.api_hash || !settings?.phone || connecting}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-success-500 hover:bg-success-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {t('tg.connectSendCode')}
                </button>
                {(!settings?.api_id || !settings?.api_hash || !settings?.phone) && (
                  <p className="text-xs text-warning-400 mt-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> {t('tg.fillCredentialsFirst')}
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-dark-400">
                  {t('tg.enterCodeSentTo').replace('{phone}', settings?.phone || '')}
                </p>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="12345"
                  className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors font-mono tracking-widest"
                />
                {needsPassword && (
                  <>
                    <p className="text-xs text-dark-400">
                      {t('tg.twoStepEnabled')}
                    </p>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('tg.placeholder2fa')}
                      className="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none focus:border-primary-500 transition-colors"
                    />
                  </>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleVerify}
                    disabled={!code || connecting}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-success-500 hover:bg-success-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t('tg.verifyConnect')}
                  </button>
                  <button
                    onClick={() => { setAwaitingCode(false); setCode(''); setPassword(''); setNeedsPassword(false); }}
                    className="text-xs text-dark-400 hover:text-white transition-colors"
                  >
                    {t('tg.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session Info */}
      {connected && (
        <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-success-400" /> {t('tg.sessionInfo')}
          </h3>

          {/* Account identity banner */}
          <div className="flex items-center gap-4 p-4 rounded-lg bg-gradient-to-br from-success-500/10 to-dark-900 border border-success-500/20 mb-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shrink-0">
              <User className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">
                {[settings?.account_first_name, settings?.account_last_name].filter(Boolean).join(' ') || t('tg.telegramUserFallback')}
              </p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {settings?.account_username && (
                  <span className="text-xs text-accent-400 flex items-center gap-1">
                    <AtSign className="w-3 h-3" /> {settings.account_username}
                  </span>
                )}
                {settings?.account_user_id && (
                  <span className="text-xs text-dark-500 flex items-center gap-1 font-mono">
                    <Hash className="w-3 h-3" /> {settings.account_user_id}
                  </span>
                )}
              </div>
            </div>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success-500/15 text-success-400 text-xs font-medium shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> {t('tg.active')}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-dark-800/40 rounded-lg p-3">
              <p className="text-xs text-dark-500 mb-1 flex items-center gap-1.5"><Phone className="w-3 h-3" /> {t('tg.phone')}</p>
              <p className="text-sm text-white font-medium font-mono">{settings?.phone || '—'}</p>
            </div>
            <div className="bg-dark-800/40 rounded-lg p-3">
              <p className="text-xs text-dark-500 mb-1 flex items-center gap-1.5"><User className="w-3 h-3" /> {t('tg.accountId')}</p>
              <p className="text-sm text-white font-medium font-mono">{settings?.account_user_id || '—'}</p>
            </div>
            <div className="bg-dark-800/40 rounded-lg p-3">
              <p className="text-xs text-dark-500 mb-1 flex items-center gap-1.5"><Shield className="w-3 h-3" /> {t('tg.lastConnected')}</p>
              <p className="text-sm text-white font-medium">{formatTimeAgo(settings?.last_connected_at ?? null)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Takeout mode — advanced, off by default */}
      {connected && (
        <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <PackageOpen className="w-4 h-4 text-accent-400" /> {t('tg.takeoutMode')}
              <span className="text-[10px] font-normal text-dark-500">{t('tg.advanced')}</span>
            </h3>
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium shrink-0 ${
              takeoutActive ? 'bg-primary-500/15 text-primary-400' : 'bg-dark-800 text-dark-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${takeoutActive ? 'bg-primary-400 animate-pulse' : 'bg-dark-600'}`} />
              {takeoutActive ? t('tg.active') : t('tg.off')}
            </span>
          </div>

          <p className="text-xs text-dark-400 leading-relaxed mb-3">
            {t('tg.takeoutDesc1')}{' '}
            <span className="text-white font-medium">{t('tg.takeoutDescBold')}</span>{' '}
            {t('tg.takeoutDesc2')}
          </p>

          <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
            <AlertTriangle className="w-4 h-4 text-warning-400 shrink-0 mt-0.5" />
            <p className="text-xs text-warning-300 leading-relaxed">
              {t('tg.takeoutWarning')}
            </p>
          </div>

          {takeoutError && (
            <p className="text-xs text-error-400 mb-3 flex items-start gap-1.5">
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {takeoutError}
            </p>
          )}
          {takeoutNotice && (
            <p className="text-xs text-success-400 mb-3 flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {takeoutNotice}
            </p>
          )}

          <button
            onClick={takeoutActive ? handleStopTakeout : handleStartTakeout}
            disabled={takeoutBusy}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              takeoutActive
                ? 'bg-dark-800 hover:bg-error-500 text-dark-300 hover:text-white'
                : 'bg-dark-800 hover:bg-primary-500 text-dark-300 hover:text-white'
            }`}
          >
            {takeoutBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageOpen className="w-4 h-4" />}
            {takeoutActive ? t('tg.stopTakeout') : t('tg.startTakeout')}
          </button>
        </div>
      )}

      {/* Setup Guide */}
      <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-accent-400" /> {t('tg.setupGuideTitle')}
        </h3>
        <div className="space-y-2 text-xs text-dark-400">
          {[
            t('tg.setupStep1'),
            t('tg.setupStep2'),
            t('tg.setupStep3'),
            t('tg.setupStep4'),
            t('tg.setupStep5'),
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
          <Shield className="w-4 h-4 text-warning-400 shrink-0 mt-0.5" />
          <p className="text-xs text-warning-300">
            {t('tg.setupWarning')}
          </p>
        </div>
      </div>
    </div>
  );
}
