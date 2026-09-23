import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Hash,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  Users,
  MessagesSquare,
  Search,
  Link2,
  List,
} from 'lucide-react';

import {
  backendConfigured,
  joinChat,
  listDialogs,
  listTelegramAccounts,
  resolveGroup,
  searchPublicChats,
  type DialogInfo,
  type PublicChatResult,
  type ResolvedGroupInfo,
  type TelegramAccount,
} from '@/lib/backend';
import { useLanguage } from '@/lib/i18n';

export interface NewGroupInput {
  chat_id: string;
  title: string;
  username: string;
  is_forum: boolean;
  /** Which Telegram account scans/downloads this group. Null = the default account. */
  account_id: string | null;
}

type Source = 'mine' | 'search' | 'id' | 'invite';

export function AddGroupModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (data: NewGroupInput) => void;
}) {
  const { t } = useLanguage();
  const [source, setSource] = useState<Source>(backendConfigured ? 'mine' : 'id');
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!backendConfigured) return;
    listTelegramAccounts().then(setAccounts).catch(() => {});
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-dark-700 bg-dark-900 p-6 shadow-2xl shadow-black/40 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-bold text-white">{t('addGroup.title')}</h3>
        <p className="mb-4 text-xs text-dark-500">
          {t('addGroup.subtitle')}
        </p>

        {/* Only shown once a second account exists -- a single-account setup
            never sees this and keeps working exactly as before. */}
        {accounts.length > 0 && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-dark-400">{t('addGroup.accountLabel')}</label>
            <select
              value={accountId ?? ''}
              onChange={(e) => setAccountId(e.target.value || null)}
              className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-primary-500"
            >
              <option value="">{t('addGroup.defaultAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.connected}>
                  {a.label}{a.account_username ? ` (@${a.account_username})` : ''}{!a.connected ? ` — ${t('addGroup.notConnected')}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-dark-800 bg-dark-800/40 p-1">
          <SourceTab active={source === 'mine'} onClick={() => setSource('mine')} icon={<List className="h-3.5 w-3.5" />} label={t('addGroup.tabMyGroups')} />
          <SourceTab active={source === 'search'} onClick={() => setSource('search')} icon={<Search className="h-3.5 w-3.5" />} label={t('addGroup.tabSearch')} />
          <SourceTab active={source === 'id'} onClick={() => setSource('id')} icon={<Hash className="h-3.5 w-3.5" />} label={t('addGroup.tabChatId')} />
          <SourceTab active={source === 'invite'} onClick={() => setSource('invite')} icon={<Link2 className="h-3.5 w-3.5" />} label={t('addGroup.tabInvite')} />
        </div>

        {source === 'mine' && <MyGroups onAdd={onAdd} onFallback={() => setSource('id')} accountId={accountId} />}
        {source === 'search' && <SearchGroups onAdd={onAdd} accountId={accountId} />}
        {source === 'id' && <ByChatId onAdd={onAdd} onClose={onClose} accountId={accountId} />}
        {source === 'invite' && <ByInvite onAdd={onAdd} accountId={accountId} />}
      </div>
    </div>
  );
}

function SourceTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
        active ? 'bg-primary-500/15 text-primary-400' : 'text-dark-400 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Lists the groups the userbot is already in — no chat ID to copy. */
function MyGroups({ onAdd, onFallback, accountId }: { onAdd: (data: NewGroupInput) => void; onFallback: () => void; accountId: string | null }) {
  const { t } = useLanguage();
  const [dialogs, setDialogs] = useState<DialogInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    (async () => {
      if (!backendConfigured) {
        setError(t('addGroup.errNoBackendList'));
        setLoading(false);
        return;
      }
      try {
        const result = await listDialogs(accountId);
        setDialogs(result.dialogs ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('addGroup.errLoadGroups'));
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dialogs;
    return dialogs.filter(
      (d) => d.title.toLowerCase().includes(q) || (d.username ?? '').toLowerCase().includes(q)
    );
  }, [dialogs, query]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-dark-800 bg-dark-800/40 p-4 text-center">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-warning-400" />
        <p className="text-xs text-dark-400">{error}</p>
        <button
          onClick={onFallback}
          className="mt-3 rounded-lg bg-dark-800 px-3 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-dark-700 hover:text-white"
        >
          {t('addGroup.enterChatIdInstead')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-dark-700 bg-dark-800 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-dark-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('addGroup.searchNGroups').replace('{n}', String(dialogs.length))}
          autoFocus
          className="flex-1 bg-transparent text-sm text-white placeholder-dark-600 outline-none"
        />
      </div>

      <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-dark-600">{t('addGroup.noGroupMatches')}</p>
        ) : (
          filtered.map((dialog) => (
            <button
              key={dialog.chat_id}
              onClick={() =>
                onAdd({
                  chat_id: dialog.chat_id,
                  title: dialog.title,
                  username: dialog.username ?? '',
                  is_forum: dialog.is_forum,
                  account_id: accountId,
                })
              }
              className="flex w-full items-center gap-3 rounded-lg bg-dark-800/40 p-2.5 text-left transition-colors hover:bg-primary-500/10"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500/30 to-accent-500/30">
                <span className="text-sm font-bold text-white">
                  {dialog.title.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{dialog.title}</p>
                <div className="flex items-center gap-2 text-[10px] text-dark-500">
                  {dialog.username && <span className="text-accent-400">@{dialog.username}</span>}
                  {typeof dialog.participants_count === 'number' && (
                    <span className="flex items-center gap-1">
                      <Users className="h-2.5 w-2.5" /> {dialog.participants_count.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              {dialog.is_forum && (
                <span className="shrink-0 rounded bg-accent-500/10 px-1.5 py-0.5 text-[9px] font-medium text-accent-400">
                  {t('addGroup.forum')}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Finds public groups/channels the account has never joined (Telegram's own
 * global directory search), then joins whichever one is picked before adding
 * it -- so a show's group doesn't need to be found and joined by hand first.
 */
function SearchGroups({ onAdd, accountId }: { onAdd: (data: NewGroupInput) => void; accountId: string | null }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicChatResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        const result = await searchPublicChats(q, 20, accountId);
        setResults(result.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('addGroup.errSearchFailed'));
      }
      setSearched(true);
      setSearching(false);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, accountId]);

  const handleJoin = async (result: PublicChatResult) => {
    setJoiningId(result.chat_id);
    setError('');
    try {
      const joined = await joinChat(result.username ? `@${result.username}` : result.chat_id, accountId);
      onAdd({
        chat_id: joined.chat_id,
        title: joined.title,
        username: joined.username ?? '',
        is_forum: joined.is_forum,
        account_id: accountId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addGroup.errJoinFailed'));
      setJoiningId(null);
    }
  };

  if (!backendConfigured) {
    return (
      <div className="rounded-xl border border-dark-800 bg-dark-800/40 p-4 text-center">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-warning-400" />
        <p className="text-xs text-dark-400">{t('addGroup.errNoBackendSearch')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-dark-700 bg-dark-800 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-dark-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('addGroup.searchPublicPlaceholder')}
          autoFocus
          className="flex-1 bg-transparent text-sm text-white placeholder-dark-600 outline-none"
        />
        {searching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-dark-500" />}
      </div>
      <p className="text-[10px] text-dark-500">
        {t('addGroup.searchPublicHint')}
      </p>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-error-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {query.trim().length > 0 && query.trim().length < 3 && (
          <p className="py-6 text-center text-xs text-dark-600">{t('addGroup.keepTyping')}</p>
        )}
        {searched && !searching && results.length === 0 && (
          <p className="py-6 text-center text-xs text-dark-600">{t('addGroup.noPublicMatch')}</p>
        )}
        {results.map((result) => (
          <div
            key={result.chat_id}
            className="flex items-center gap-3 rounded-lg bg-dark-800/40 p-2.5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500/30 to-accent-500/30">
              <span className="text-sm font-bold text-white">{result.title.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{result.title}</p>
              <div className="flex items-center gap-2 text-[10px] text-dark-500">
                {result.username && <span className="text-accent-400">@{result.username}</span>}
                {typeof result.participants_count === 'number' && (
                  <span className="flex items-center gap-1">
                    <Users className="h-2.5 w-2.5" /> {result.participants_count.toLocaleString()}
                  </span>
                )}
                {result.already_joined && (
                  <span className="rounded bg-success-500/10 px-1.5 py-0.5 font-medium text-success-400">{t('addGroup.joined')}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => handleJoin(result)}
              disabled={joiningId === result.chat_id}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {joiningId === result.chat_id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              {result.already_joined ? t('addGroup.add') : t('addGroup.joinAndAdd')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Joins a public @name or a t.me/+hash link, then adds what it joined. */
function ByInvite({ onAdd, accountId }: { onAdd: (data: NewGroupInput) => void; accountId: string | null }) {
  const { t } = useLanguage();
  const [invite, setInvite] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    const value = invite.trim();
    if (!value || joining) return;
    setJoining(true);
    setError('');
    try {
      const result = await joinChat(value, accountId);
      onAdd({
        chat_id: result.chat_id,
        title: result.title,
        username: result.username ?? '',
        is_forum: result.is_forum,
        account_id: accountId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addGroup.errJoinFailed'));
      setJoining(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-dark-400">
          {t('addGroup.inviteLabel')}
        </label>
        <input
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          placeholder="https://t.me/+AbCdEf... or @groupname"
          autoFocus
          className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 font-mono text-sm text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
        />
        <p className="mt-1.5 text-[10px] text-dark-500">
          {t('addGroup.inviteHint')}
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-error-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <button
        onClick={handleJoin}
        disabled={!invite.trim() || joining}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        {t('addGroup.joinAndAdd')}
      </button>
    </div>
  );
}

/** The original flow: paste a chat ID and let the service confirm it. */
function ByChatId({ onAdd, onClose, accountId }: { onAdd: (data: NewGroupInput) => void; onClose: () => void; accountId: string | null }) {
  const { t } = useLanguage();
  const [chatId, setChatId] = useState('');
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [isForum, setIsForum] = useState(false);

  const [verifyState, setVerifyState] = useState<'idle' | 'checking' | 'verified' | 'failed'>('idle');
  const [verifyError, setVerifyError] = useState('');
  const [resolved, setResolved] = useState<ResolvedGroupInfo | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Auto-verify as soon as a plausible chat ID is typed, so the user
  // immediately sees the real group name and knows the ID is correct.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResolved(null);
    setVerifyError('');

    const trimmed = chatId.trim();
    if (!trimmed || !backendConfigured) {
      setVerifyState('idle');
      return;
    }

    setVerifyState('idle');
    debounceRef.current = setTimeout(async () => {
      const myRequestId = ++requestIdRef.current;
      setVerifyState('checking');
      try {
        const info = await resolveGroup(trimmed, accountId);
        if (myRequestId !== requestIdRef.current) return; // superseded by a newer request
        setResolved(info);
        setTitle(info.title || '');
        setUsername(info.username || '');
        setIsForum(info.is_forum);
        setVerifyState('verified');
      } catch (err) {
        if (myRequestId !== requestIdRef.current) return;
        setVerifyError(err instanceof Error ? err.message : t('addGroup.errConnectFailed'));
        setVerifyState('failed');
      }
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, accountId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatId || !title) return;
    onAdd({ chat_id: chatId, title, username, is_forum: isForum, account_id: accountId });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-dark-400">{t('addGroup.chatIdLabel')}</label>
        <div className="relative">
          <Hash className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" />
          <input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-100xxxxxxxxxx"
            autoFocus
            className={`w-full rounded-lg border bg-dark-800 py-2.5 pl-10 pr-9 font-mono text-sm text-white placeholder-dark-600 outline-none transition-colors ${
              verifyState === 'verified'
                ? 'border-success-500/60 focus:border-success-500'
                : verifyState === 'failed'
                ? 'border-error-500/60 focus:border-error-500'
                : 'border-dark-700 focus:border-primary-500'
            }`}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {verifyState === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-dark-500" />}
            {verifyState === 'verified' && <ShieldCheck className="h-4 w-4 text-success-400" />}
            {verifyState === 'failed' && <ShieldAlert className="h-4 w-4 text-error-400" />}
          </div>
        </div>

        {verifyState === 'checking' && (
          <p className="mt-1.5 text-xs text-dark-500">{t('addGroup.connectingToTelegram')}</p>
        )}
        {verifyState === 'failed' && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-error-400">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{' '}
            {verifyError || t('addGroup.groupNotFound')}
          </p>
        )}
        {verifyState === 'verified' && resolved && (
          <div className="mt-2.5 rounded-xl border border-success-500/30 bg-gradient-to-br from-success-500/10 to-dark-900 p-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500/30 to-accent-500/30">
                <span className="text-sm font-bold text-white">
                  {(resolved.title || '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{resolved.title}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-dark-400">
                  {resolved.username && <span className="text-accent-400">@{resolved.username}</span>}
                  {typeof resolved.participants_count === 'number' && (
                    <span className="flex items-center gap-1">
                      <Users className="h-2.5 w-2.5" /> {resolved.participants_count.toLocaleString()}
                    </span>
                  )}
                  {resolved.is_forum && (
                    <span className="rounded bg-primary-500/10 px-1.5 py-0.5 font-medium text-primary-400">
                      {t('addGroup.forum')}
                    </span>
                  )}
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-success-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> {t('addGroup.connected')}
              </span>
            </div>

            {resolved.topics && resolved.topics.length > 0 && (
              <div className="mt-3 border-t border-dark-800/80 pt-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-dark-500">
                  <MessagesSquare className="h-3 w-3" />{' '}
                  {(resolved.topics.length === 1 ? t('addGroup.topicsFoundOne') : t('addGroup.topicsFoundMany')).replace(
                    '{n}',
                    String(resolved.topics.length)
                  )}
                </p>
                <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {resolved.topics.slice(0, 12).map((topic) => (
                    <span
                      key={topic.topic_id}
                      className="max-w-[160px] truncate rounded-md border border-dark-700/60 bg-dark-800/70 px-2 py-1 text-[10px] text-dark-300"
                    >
                      {topic.title}
                    </span>
                  ))}
                  {resolved.topics.length > 12 && (
                    <span className="px-2 py-1 text-[10px] text-dark-500">
                      {t('addGroup.moreCount').replace('{n}', String(resolved.topics.length - 12))}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-dark-400">
          {t('addGroup.groupTitleLabel')}{' '}
          {verifyState === 'verified' ? <span className="text-success-500">{t('addGroup.autoFilled')}</span> : '*'}
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('addGroup.groupTitlePlaceholder')}
          className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2.5 text-sm text-white placeholder-dark-600 outline-none transition-colors focus:border-primary-500"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <button
          type="button"
          onClick={() => setIsForum(!isForum)}
          className={`relative h-6 w-10 rounded-full transition-colors ${isForum ? 'bg-primary-500' : 'bg-dark-700'}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              isForum ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className="text-sm text-dark-300">{t('addGroup.isForumLabel')}</span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg bg-dark-800 px-4 py-2.5 text-sm font-medium text-dark-300 transition-colors hover:bg-dark-700"
        >
          {t('addGroup.cancel')}
        </button>
        <button
          type="submit"
          disabled={!chatId || !title}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> {t('addGroup.addAndScan')}
        </button>
      </div>
    </form>
  );
}
