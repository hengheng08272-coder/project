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
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  addTelegramAccount,
  callBackend,
  checkHealth,
  deleteTelegramAccount,
  listTelegramAccounts,
  sendAccountCode,
  startTakeout,
  stopTakeout,
  verifyAccountCode,
  type TelegramAccount,
} from '@/lib/backend';
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

      {/* Additional Telegram accounts -- each can scan/download its own set
          of groups, picked when a group is added (see AddGroupModal). */}
      <AccountsSection />

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

/**
 * Manages Telegram accounts beyond the default one above -- each gets its
 * own session and can be picked when adding a group (AddGroupModal), so a
 * group can be scanned/downloaded through a different account than the
 * original single-account setup used. Fully additive: a setup that never
 * adds one here behaves exactly like before this existed.
 */
function AccountsSection() {
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const reload = () => {
    listTelegramAccounts()
      .then(setAccounts)
      .catch((err) => setError(err instanceof Error ? err.message : t('tg.accounts.errAdd')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRemove = async (id: string) => {
    if (!window.confirm(t('tg.accounts.confirmRemove'))) return;
    setError('');
    try {
      await deleteTelegramAccount(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tg.accounts.errRemove'));
    }
  };

  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Users className="h-4 w-4 text-accent-400" /> {t('tg.accounts.title')}
        </h3>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-dark-800 px-3 py-1.5 text-xs font-medium text-dark-300 transition-colors hover:bg-dark-700 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" /> {t('tg.accounts.addAccount')}
        </button>
      </div>
      <p className="mb-4 text-xs text-dark-500">{t('tg.accounts.hint')}</p>

      {error && (
        <p className="mb-3 flex items-start gap-1.5 text-xs text-error-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {showAdd && (
        <AddAccountForm
          onDone={() => {
            setShowAdd(false);
            reload();
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary-500" /></div>
      ) : accounts.length === 0 ? (
        !showAdd && <p className="py-4 text-center text-xs text-dark-600">{t('tg.accounts.empty')}</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} onChanged={reload} onRemove={() => handleRemove(account.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * api_id/api_hash identify the application, not the phone number logging in
 * with it -- the same pair the default account already uses works for any
 * other phone number too. So the normal path here only ever asks for a name
 * and a phone number; api_id/api_hash stay behind "Advanced", collapsed by
 * default, for the rare case an operator wants a distinct app credential.
 */
function AddAccountForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useLanguage();
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    setSaving(true);
    setError('');
    try {
      await addTelegramAccount({
        label: label || t('tg.accounts.defaultLabel'),
        phone,
        ...(apiId && apiHash ? { api_id: apiId, api_hash: apiHash } : {}),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tg.accounts.errAdd'));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-lg border border-dark-700 bg-dark-800/40 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-dark-400">{t('tg.accounts.labelField')}</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('tg.accounts.defaultLabel')}
            className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-dark-400">{t('tg.phoneNumber')}</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+85512345678"
            autoFocus
            className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
          />
        </div>
      </div>
      <p className="text-[11px] text-dark-500">{t('tg.accounts.reuseCredHint')}</p>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-[11px] font-medium text-dark-400 transition-colors hover:text-white"
      >
        {showAdvanced ? t('tg.accounts.hideAdvanced') : t('tg.accounts.showAdvanced')}
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-1 gap-3 border-t border-dark-700/60 pt-3 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-dark-400">{t('tg.apiId')}</label>
            <input
              value={apiId}
              onChange={(e) => setApiId(e.target.value)}
              placeholder="12345678"
              className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 font-mono text-sm text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-dark-400">{t('tg.apiHash')}</label>
            <input
              type="password"
              value={apiHash}
              onChange={(e) => setApiHash(e.target.value)}
              placeholder="your_api_hash_here"
              className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 font-mono text-sm text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-error-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!phone || saving}
          className="flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('tg.accounts.save')}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-dark-400 transition-colors hover:text-white">
          {t('tg.cancel')}
        </button>
      </div>
    </form>
  );
}

function AccountRow({ account, onChanged, onRemove }: { account: TelegramAccount; onChanged: () => void; onRemove: () => void }) {
  const { t } = useLanguage();
  const [connecting, setConnecting] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setError('');
    setConnecting(true);
    try {
      await sendAccountCode(account.id);
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
      const result = await verifyAccountCode(account.id, code, needsPassword ? password : undefined);
      if (result.needsPassword) {
        setNeedsPassword(true);
        return;
      }
      setAwaitingCode(false);
      setCode('');
      setPassword('');
      setNeedsPassword(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tg.errVerifyCode'));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="rounded-lg border border-dark-700/60 bg-dark-800/40 p-3">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${account.connected ? 'bg-success-500/20' : 'bg-dark-800'}`}>
          <User className={`h-4 w-4 ${account.connected ? 'text-success-400' : 'text-dark-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{account.label}</p>
          <p className="truncate text-[11px] text-dark-500">
            {account.account_username ? `@${account.account_username}` : account.phone || '—'}
          </p>
        </div>
        {account.connected ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-success-500/10 px-2.5 py-1 text-[11px] font-medium text-success-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('tg.accounts.connected')}
          </span>
        ) : !awaitingCode ? (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-success-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-success-600 disabled:opacity-50"
          >
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t('tg.accounts.connect')}
          </button>
        ) : null}
        <button
          onClick={onRemove}
          title={t('tg.accounts.remove')}
          className="shrink-0 rounded-lg p-1.5 text-dark-600 transition-colors hover:bg-error-500/20 hover:text-error-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {awaitingCode && !account.connected && (
        <div className="mt-3 space-y-2 border-t border-dark-700/60 pt-3">
          <p className="text-xs text-dark-400">{t('tg.enterCodeSentTo').replace('{phone}', account.phone || '')}</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="12345"
            className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 font-mono text-sm tracking-widest text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
          />
          {needsPassword && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('tg.placeholder2fa')}
              className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
            />
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleVerify}
              disabled={!code || connecting}
              className="flex items-center gap-2 rounded-lg bg-success-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-success-600 disabled:opacity-50"
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {t('tg.verifyConnect')}
            </button>
            <button
              onClick={() => { setAwaitingCode(false); setCode(''); setPassword(''); setNeedsPassword(false); }}
              className="text-xs text-dark-400 transition-colors hover:text-white"
            >
              {t('tg.cancel')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-error-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
