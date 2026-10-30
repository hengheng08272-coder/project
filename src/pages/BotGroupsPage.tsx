import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Clock,
  Download,
  Loader2,
  RefreshCw,
  Square,
  Trophy,
  Users,
} from 'lucide-react';

import { Tabs } from '@/components/Tabs';
import { useLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { formatTimeAgo } from '@/lib/utils';

// Rows written by the Telegram bot (backend-node/src/classroom.js).
interface Member {
  chat_id: number;
  user_id: number;
  first_name: string | null;
  username: string | null;
  team: string | null;
  created_at: string;
}
interface GroupSettings {
  chat_id: number;
  title: string | null;
  per_message: number;
  gap_seconds: number;
  lesson_time: string | null;
  lesson_every_days: number;
  lesson_next_pos: number;
  lesson_next_at: string | null;
  moved_to: number | null;
}
interface Lesson {
  id: string;
  chat_id: number;
  position: number;
  title: string;
  kind: string;
  text: string | null;
  created_at: string;
}
interface Auto {
  id: string;
  short_id: number;
  chat_id: number;
  text: string;
  times: number;
  every_minutes: number;
  tag: boolean;
  team: string | null;
  sent_count: number;
  next_at: string;
  active: boolean;
}
interface Quiz {
  poll_id: string;
  chat_id: number;
  question: string;
}
interface QuizAnswer {
  poll_id: string;
  user_id: number;
  correct: boolean;
}

interface Data {
  members: Member[];
  settings: GroupSettings[];
  lessons: Lesson[];
  reads: { lesson_id: string; user_id: number }[];
  autos: Auto[];
  quizzes: Quiz[];
  answers: QuizAnswer[];
}

type Tab = 'members' | 'messages' | 'auto' | 'quiz';

const nameOf = (m: Pick<Member, 'first_name' | 'username' | 'user_id'>) =>
  m.first_name || (m.username ? `@${m.username}` : String(m.user_id));

/** PostgREST returns at most 1000 rows a request, so "all of them" pages. */
async function fetchAll<T>(table: string, columns = '*'): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return all;
  }
}

/**
 * Admin view of every Telegram group the bot serves -- a class, a team, a
 * club: who joined, what was sent and who read it, auto messages, quiz
 * scores. Sending still happens in Telegram (or the backend's script).
 */
export function BotGroupsPage() {
  const { t } = useLanguage();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('members');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [members, settings, lessons, reads, autos, quizzes, answers] = await Promise.all([
        fetchAll<Member>('class_members'),
        fetchAll<GroupSettings>('class_settings'),
        fetchAll<Lesson>('class_lessons', 'id, chat_id, position, title, kind, text, created_at'),
        fetchAll<{ lesson_id: string; user_id: number }>('class_lesson_reads', 'lesson_id, user_id'),
        fetchAll<Auto>('class_autos'),
        fetchAll<Quiz>('class_quizzes', 'poll_id, chat_id, question'),
        fetchAll<QuizAnswer>('class_quiz_answers', 'poll_id, user_id, correct'),
      ]);
      setData({ members, settings, lessons, reads, autos, quizzes, answers });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const ids = new Set<number>([...data.settings.map((s) => s.chat_id), ...data.members.map((m) => m.chat_id)]);
    return [...ids]
      .map((chatId) => ({
        chatId,
        settings: data.settings.find((s) => s.chat_id === chatId),
        members: data.members.filter((m) => m.chat_id === chatId).length,
        lessons: data.lessons.filter((l) => l.chat_id === chatId).length,
        autos: data.autos.filter((a) => a.chat_id === chatId && a.active).length,
      }))
      .sort((a, b) => b.members - a.members);
  }, [data]);

  useEffect(() => {
    if (selected === null && groups.length) setSelected(groups[0].chatId);
  }, [groups, selected]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
      </div>
    );
  }

  const group = groups.find((g) => g.chatId === selected);

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-xs text-error-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-dark-500">{t('botGroups.intro')}</p>
        <button
          onClick={load}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-dark-800 px-3 py-1.5 text-xs text-dark-300 hover:bg-dark-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('botGroups.refresh')}
        </button>
      </div>

      {groups.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <button
                key={g.chatId}
                onClick={() => setSelected(g.chatId)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  g.chatId === selected
                    ? 'border-primary-500/60 bg-primary-500/10'
                    : 'border-dark-800 bg-dark-900/60 hover:border-dark-700'
                }`}
              >
                <p className="truncate text-sm font-bold text-white">{g.settings?.title || g.chatId}</p>
                <p className="mt-0.5 text-[11px] text-dark-500">
                  ID {g.chatId}
                  {g.settings?.moved_to ? ` · ${t('botGroups.movedTo')} ${g.settings.moved_to}` : ''}
                </p>
                <div className="mt-3 flex gap-4 text-xs text-dark-300">
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {g.members}</span>
                  <span className="flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> {g.lessons}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {g.autos}</span>
                </div>
              </button>
            ))}
          </div>

          {group && data && (
            <div className="space-y-3">
              <Tabs
                active={tab}
                onChange={(key) => setTab(key as Tab)}
                tabs={[
                  { key: 'members', label: t('botGroups.members'), icon: <Users className="h-3.5 w-3.5" />, badge: group.members },
                  { key: 'messages', label: t('botGroups.messages'), icon: <BookOpen className="h-3.5 w-3.5" />, badge: group.lessons },
                  { key: 'auto', label: t('botGroups.auto'), icon: <Clock className="h-3.5 w-3.5" />, badge: group.autos },
                  { key: 'quiz', label: t('botGroups.quiz'), icon: <Trophy className="h-3.5 w-3.5" /> },
                ]}
              />
              {tab === 'members' && <MembersPanel data={data} chatId={group.chatId} title={group.settings?.title ?? ''} />}
              {tab === 'messages' && <MessagesPanel data={data} chatId={group.chatId} />}
              {tab === 'auto' && <AutoPanel data={data} chatId={group.chatId} settings={group.settings} onChanged={load} />}
              {tab === 'quiz' && <QuizPanel data={data} chatId={group.chatId} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border border-dark-800 bg-dark-900/60 p-6 text-sm text-dark-300">
      <p className="mb-3 font-bold text-white">{t('botGroups.emptyTitle')}</p>
      <ol className="list-decimal space-y-1 pl-5 text-xs">
        <li>{t('botGroups.step1')}</li>
        <li>{t('botGroups.step2')}</li>
        <li>{t('botGroups.step3')}</li>
      </ol>
    </div>
  );
}

const card = 'rounded-xl border border-dark-800 bg-dark-900/60';

function MembersPanel({ data, chatId, title }: { data: Data; chatId: number; title: string }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const members = data.members.filter((m) => m.chat_id === chatId);
  const shown = members.filter((m) =>
    `${m.first_name ?? ''} ${m.username ?? ''} ${m.team ?? ''} ${m.user_id}`.toLowerCase().includes(query.toLowerCase())
  );
  const teams = [...new Set(members.map((m) => m.team).filter(Boolean))];

  const exportCsv = () => {
    const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['user_id', 'name', 'username', 'team', 'joined'], ...members.map((m) => [m.user_id, m.first_name, m.username, m.team, m.created_at])];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(quote).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title || chatId}-members.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className={`${card} p-3`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('botGroups.search')}
          className="min-w-0 flex-1 rounded-lg border border-dark-700 bg-dark-800 px-3 py-1.5 text-xs text-white outline-none focus:border-primary-500"
        />
        <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg bg-dark-800 px-3 py-1.5 text-xs text-dark-300 hover:bg-dark-700">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>
      {teams.length > 0 && (
        <p className="mb-2 text-[11px] text-dark-500">
          {t('botGroups.teams')}: {teams.map((team) => `${team} (${members.filter((m) => m.team === team).length})`).join(' · ')}
        </p>
      )}
      <div className="divide-y divide-dark-800">
        {shown.map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{nameOf(m)}</p>
              <p className="text-dark-500">{m.username ? `@${m.username} · ` : ''}{m.user_id}</p>
            </div>
            <div className="shrink-0 text-right text-dark-500">
              {m.team && <span className="mr-2 rounded bg-dark-800 px-1.5 py-0.5 text-dark-300">{m.team}</span>}
              {formatTimeAgo(m.created_at)}
            </div>
          </div>
        ))}
        {shown.length === 0 && <p className="py-6 text-center text-xs text-dark-500">—</p>}
      </div>
    </div>
  );
}

function MessagesPanel({ data, chatId }: { data: Data; chatId: number }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<string | null>(null);
  const members = data.members.filter((m) => m.chat_id === chatId);
  const lessons = data.lessons.filter((l) => l.chat_id === chatId).sort((a, b) => b.position - a.position);

  if (!lessons.length) return <p className={`${card} p-6 text-center text-xs text-dark-500`}>{t('botGroups.noMessages')}</p>;

  return (
    <div className="space-y-2">
      {lessons.map((lesson) => {
        const readers = new Set(data.reads.filter((r) => r.lesson_id === lesson.id).map((r) => Number(r.user_id)));
        const unread = members.filter((m) => !readers.has(Number(m.user_id)));
        const pct = members.length ? Math.round((readers.size / members.length) * 100) : 0;
        return (
          <div key={lesson.id} className={`${card} p-3`}>
            <button onClick={() => setOpen(open === lesson.id ? null : lesson.id)} className="w-full text-left">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-white">
                  #{lesson.position} {lesson.title}
                  <span className="ml-2 text-[10px] uppercase text-dark-500">{lesson.kind}</span>
                </p>
                <span className="shrink-0 text-xs text-dark-400">
                  {readers.size}/{members.length} · {formatTimeAgo(lesson.created_at)}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-dark-800">
                <div className="h-full rounded-full bg-success-500" style={{ width: `${pct}%` }} />
              </div>
            </button>
            {open === lesson.id && (
              <div className="mt-3 space-y-2 text-xs">
                {lesson.text && <p className="whitespace-pre-wrap text-dark-300">{lesson.text}</p>}
                <p className="text-dark-500">
                  {t('botGroups.notRead')} ({unread.length}): {unread.map(nameOf).join(', ') || '—'}
                </p>
                <p className="text-dark-600">{t('botGroups.tagHint').replace('{n}', String(lesson.position))}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AutoPanel({
  data,
  chatId,
  settings,
  onChanged,
}: {
  data: Data;
  chatId: number;
  settings?: GroupSettings;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const autos = data.autos.filter((a) => a.chat_id === chatId && a.active);

  const run = async (key: string, action: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key);
    setError('');
    const { error: actionError } = await action();
    if (actionError) setError(actionError.message);
    setBusy(null);
    onChanged();
  };

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-error-300">{error}</p>}
      {settings?.lesson_time && (
        <div className={`${card} flex items-center justify-between gap-2 p-3 text-xs`}>
          <div>
            <p className="font-medium text-white">📘 {t('botGroups.schedule')} {settings.lesson_time} · {settings.lesson_every_days}d</p>
            <p className="text-dark-500">
              {t('botGroups.nextLesson')} #{settings.lesson_next_pos}
              {settings.lesson_next_at ? ` · ${new Date(settings.lesson_next_at).toLocaleString()}` : ''}
            </p>
          </div>
          <StopButton
            busy={busy === 'schedule'}
            onClick={() =>
              run('schedule', () =>
                supabase.from('class_settings').update({ lesson_time: null, lesson_next_at: null }).eq('chat_id', chatId)
              )
            }
          />
        </div>
      )}
      {autos.map((a) => (
        <div key={a.id} className={`${card} flex items-center justify-between gap-2 p-3 text-xs`}>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">#{a.short_id} {a.text}</p>
            <p className="text-dark-500">
              {a.sent_count}/{a.times || '∞'} · {t('botGroups.every')} {a.every_minutes} min
              {a.tag ? ` · tag${a.team ? `:${a.team}` : ''}` : ''} · {t('botGroups.next')} {new Date(a.next_at).toLocaleString()}
            </p>
          </div>
          <StopButton
            busy={busy === a.id}
            onClick={() => run(a.id, () => supabase.from('class_autos').update({ active: false }).eq('id', a.id))}
          />
        </div>
      ))}
      {!autos.length && !settings?.lesson_time && (
        <p className={`${card} p-6 text-center text-xs text-dark-500`}>{t('botGroups.noAuto')}</p>
      )}
    </div>
  );
}

function StopButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex shrink-0 items-center gap-1 rounded-lg bg-error-500/15 px-2.5 py-1.5 text-error-300 hover:bg-error-500/25 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} {t('botGroups.stop')}
    </button>
  );
}

function QuizPanel({ data, chatId }: { data: Data; chatId: number }) {
  const { t } = useLanguage();
  const quizzes = data.quizzes.filter((q) => q.chat_id === chatId);
  const pollIds = new Set(quizzes.map((q) => q.poll_id));
  const score = new Map<number, { right: number; total: number }>();
  for (const a of data.answers) {
    if (!pollIds.has(a.poll_id)) continue;
    const s = score.get(Number(a.user_id)) ?? { right: 0, total: 0 };
    s.total += 1;
    if (a.correct) s.right += 1;
    score.set(Number(a.user_id), s);
  }
  const names = new Map(data.members.filter((m) => m.chat_id === chatId).map((m) => [Number(m.user_id), m]));
  const ranking = [...score].sort((a, b) => b[1].right - a[1].right || a[1].total - b[1].total);

  if (!quizzes.length) return <p className={`${card} p-6 text-center text-xs text-dark-500`}>{t('botGroups.noQuiz')}</p>;

  return (
    <div className={`${card} p-3`}>
      <p className="mb-2 text-xs text-dark-500">{quizzes.length} quiz</p>
      <div className="divide-y divide-dark-800">
        {ranking.map(([userId, s], i) => {
          const m = names.get(userId);
          return (
            <div key={userId} className="flex items-center justify-between py-2 text-xs">
              <span className="text-white">
                {i + 1}. {m ? nameOf(m) : userId}
              </span>
              <span className="text-dark-300">
                {s.right}/{s.total}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
