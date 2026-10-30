/**
 * Classroom tools for a teacher's Telegram group: a student roster, tagging
 * every student (or one team), a "✅ seen" check that can re-tag only the
 * students who have not tapped it, repeating auto messages (how many times,
 * every how many minutes), and a DM to every student who has started the bot.
 *
 * Everything is sent through the same bot as the rest of linkBot. Telegram
 * lets a bot post roughly 20 messages a minute into one group, so a run never
 * goes faster than MIN_GROUP_GAP_MS; when Telegram still answers 429 it is
 * waited out (withFloodRetry) and the run carries on, so a class of any size
 * is tagged in full instead of half-sent. The teacher picks how many names
 * go in each message and the gap between messages -- the only floor is the
 * pace Telegram itself enforces.
 *
 * Only group admins (the teacher) can send; any member can /join.
 */
import { config } from "./config.js";
import { db, fetchAll, nowIso, rows } from "./db.js";
import { withFloodRetry } from "./floodRetry.js";

// Telegram's per-group pace for bots (~20 messages/minute). Going faster only
// earns 429s, so a shorter gap the teacher asks for is raised to this.
const MIN_GROUP_GAP_MS = 3000;
// Private chats: Telegram allows ~30 bot messages a second across all chats.
const DM_GAP_MS = 50;
const MAX_PER_MESSAGE = 50;
const DEFAULT_PER_MESSAGE = 5;
const DEFAULT_GAP_SECONDS = 4;
const ADMIN_CACHE_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------- Bot API

/**
 * One Bot API call. A 429 is thrown as a flood-wait error (err.seconds) so
 * withFloodRetry waits exactly what Telegram asked and tries again.
 */
async function rawApi(method, body) {
  if (!config.telegramLoginBotToken) return null;
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error_code === 429) {
    const err = new Error(`FLOOD_WAIT_${data.parameters?.retry_after ?? 5}`);
    err.seconds = Number(data.parameters?.retry_after ?? 5);
    throw err;
  }
  return data;
}

async function api(method, body) {
  const data = await withFloodRetry(() => rawApi(method, body), { label: `classroom ${method}` });
  if (data && !data.ok) console.error(`Telegram ${method} failed:`, JSON.stringify(data));
  return data;
}

const send = (chatId, text, extra = {}) =>
  api("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A mention that notifies the student even without a @username. */
function mention(member) {
  const name = (member.first_name || member.username || String(member.user_id)).slice(0, 32);
  return `<a href="tg://user?id=${member.user_id}">${escapeHtml(name)}</a>`;
}

// ------------------------------------------------------------ teachers

const adminCache = new Map();

/** True when this user is an admin/owner of the group (the teacher). */
async function isTeacher(chatId, userId) {
  const key = `${chatId}:${userId}`;
  const hit = adminCache.get(key);
  if (hit && Date.now() - hit.at < ADMIN_CACHE_MS) return hit.ok;
  const data = await api("getChatMember", { chat_id: chatId, user_id: userId });
  const ok = ["creator", "administrator"].includes(data?.result?.status);
  adminCache.set(key, { ok, at: Date.now() });
  return ok;
}

// -------------------------------------------------------------- roster

async function addMember(chatId, from, team = null) {
  const values = {
    chat_id: chatId,
    user_id: from.id,
    first_name: from.first_name ?? null,
    username: from.username ?? null,
    updated_at: nowIso(),
  };
  if (team) values.team = team.slice(0, 32);
  rows(await db().from("class_members").upsert(values, { onConflict: "chat_id,user_id" }).select());
}

async function members(chatId, team = null) {
  return fetchAll(() => {
    let q = db().from("class_members").select("*").eq("chat_id", chatId).order("user_id");
    if (team) q = q.ilike("team", team);
    return q;
  });
}

async function settingsFor(chatId) {
  const row = rows(await db().from("class_settings").select("*").eq("chat_id", chatId).limit(1))[0];
  return {
    perMessage: row?.per_message ?? DEFAULT_PER_MESSAGE,
    gapSeconds: row?.gap_seconds ?? DEFAULT_GAP_SECONDS,
  };
}

// ---------------------------------------------------------- send queue

// One run at a time per group (tags, auto messages), in order; /stop bumps
// the generation so whatever is queued or running ends at its next message.
const queues = new Map();
const generations = new Map();

function enqueue(chatId, job) {
  const gen = generations.get(chatId) ?? 0;
  const next = (queues.get(chatId) ?? Promise.resolve())
    .then(() => job(() => (generations.get(chatId) ?? 0) !== gen))
    .catch((err) => console.error(`classroom run in ${chatId} failed:`, err?.message ?? err));
  queues.set(chatId, next);
  return next;
}

function stopRuns(chatId) {
  generations.set(chatId, (generations.get(chatId) ?? 0) + 1);
}

/**
 * Posts `text` and then mentions every listed student, `perMessage` names to
 * a message, `gapSeconds` apart (never under Telegram's group pace).
 */
async function tagRun(chatId, list, text, { perMessage, gapSeconds }, stopped) {
  const gap = Math.max(gapSeconds * 1000, MIN_GROUP_GAP_MS);
  if (text) await send(chatId, escapeHtml(text));
  let sent = 0;
  for (let i = 0; i < list.length; i += perMessage) {
    if (stopped()) return sent;
    if (text || i > 0) await sleep(gap);
    await send(chatId, list.slice(i, i + perMessage).map(mention).join(" "));
    sent += Math.min(perMessage, list.length - i);
  }
  return sent;
}

// ------------------------------------------------------------- checks

function checkKeyboard(checkId, seen) {
  return {
    inline_keyboard: [
      [{ text: `✅ បានឃើញ (${seen})`, callback_data: `cls:seen:${checkId}` }],
      [
        { text: "📊 លទ្ធផល", callback_data: `cls:result:${checkId}` },
        { text: "🔔 Tag អ្នកមិនទាន់ឃើញ", callback_data: `cls:unseen:${checkId}` },
      ],
    ],
  };
}

async function seenIds(checkId) {
  const marks = await fetchAll(() =>
    db().from("class_check_marks").select("user_id").eq("check_id", checkId).order("user_id")
  );
  return new Set(marks.map((m) => Number(m.user_id)));
}

// -------------------------------------------------------- auto messages

/**
 * Sends every auto message that is due. Called from the worker loop; the
 * conditional update on next_at claims a row, so two instances never send
 * the same message twice.
 */
export async function runDueAutoMessages() {
  if (!config.telegramLoginBotToken) return 0;
  const due = rows(
    await db().from("class_autos").select("*").eq("active", true).lte("next_at", nowIso()).limit(50)
  );
  let fired = 0;
  for (const auto of due) {
    const sentCount = auto.sent_count + 1;
    const done = auto.times > 0 && sentCount >= auto.times;
    const claimed = rows(
      await db()
        .from("class_autos")
        .update({
          sent_count: sentCount,
          active: !done,
          next_at: new Date(Date.now() + auto.every_minutes * 60 * 1000).toISOString(),
          updated_at: nowIso(),
        })
        .eq("id", auto.id)
        .eq("next_at", auto.next_at)
        .select("id")
    );
    if (!claimed.length) continue;
    fired += 1;
    const chatId = Number(auto.chat_id);
    const label = auto.times > 0 ? ` (${sentCount}/${auto.times})` : "";
    if (auto.tag) {
      const list = await members(chatId, auto.team);
      const settings = await settingsFor(chatId);
      enqueue(chatId, (stopped) => tagRun(chatId, list, `${auto.text}${label}`, settings, stopped));
    } else {
      enqueue(chatId, () => send(chatId, escapeHtml(`${auto.text}${label}`)));
    }
  }
  return fired;
}

// ------------------------------------------------------------- commands

const HELP = [
  "🎓 <b>ឧបករណ៍ថ្នាក់រៀន</b>",
  "",
  "<b>សិស្ស</b>",
  "/join [ក្រុម] — ចុះឈ្មោះក្នុងថ្នាក់ (ឧ. /join A)",
  "/leave — ដកឈ្មោះចេញ",
  "",
  "<b>គ្រូ (Admin ក្រុម)</b>",
  "/joinbutton — ផ្ញើប៊ូតុង ✋ ឲ្យសិស្សចុចចុះឈ្មោះ",
  "/students — បញ្ជីសិស្ស",
  "/settag &lt;ឈ្មោះក្នុង១សារ&gt; &lt;វិនាទី&gt; — ឧ. /settag 5 4",
  "/tagall [សារ] — Tag សិស្សទាំងអស់",
  "/tagteam &lt;ក្រុម&gt; [សារ] — Tag តែក្រុមមួយ",
  "/check &lt;សារ&gt; — សារមានប៊ូតុង ✅ បានឃើញ",
  "/auto &lt;ចំនួនដង&gt; &lt;នាទី&gt; [tag] &lt;សារ&gt; — ផ្ញើស្វ័យប្រវត្តិ (0 ដង = រហូត)",
  "   ឧ. /auto 5 30 tag កុំភ្លេចធ្វើកិច្ចការផ្ទះ",
  "/autolist — បញ្ជីសារស្វ័យប្រវត្តិ",
  "/autostop &lt;លេខ|all&gt; — បញ្ឈប់សារស្វ័យប្រវត្តិ",
  "/dm &lt;សារ&gt; — ផ្ញើសារផ្ទាល់ទៅសិស្សដែលបាន Start bot",
  "/stop — បញ្ឈប់ការ Tag ដែលកំពុងដំណើរការ",
  "",
  "<b>មេរៀន</b>",
  "/addlesson &lt;ចំណងជើង&gt; — Reply លើសារ/រូប/វីដេអូ/PDF ដើម្បីរក្សាទុកជាមេរៀន",
  "/lessons — បញ្ជីមេរៀន",
  "/sendlesson &lt;លេខ&gt; — ផ្ញើមេរៀនទៅសិស្សម្នាក់ៗតាម DM",
  "/lessonstats &lt;លេខ&gt; — អ្នកណាបានអាន / មិនទាន់អាន",
  "/autolesson &lt;ម៉ោង&gt; [ថ្ងៃ] — ផ្ញើមេរៀនបន្ទាប់ស្វ័យប្រវត្តិ (ឧ. /autolesson 19:00 1) · /autolesson off",
  "",
  "<b>តេស្ត</b>",
  "/quiz សំណួរ | ចម្លើយ1 | ចម្លើយ2 | ... | លេខចម្លើយត្រូវ",
  "/scores — តារាងពិន្ទុ",
  "",
  "<b>Group ត្រូវបិទ?</b>",
  "/move [link] — ក្នុង group ថ្មី៖ ផ្ទេរសិស្ស មេរៀន និងផ្ញើ link ថ្មីទៅសិស្សទាំងអស់",
  "",
  "សិស្ស៖ ចុច Start bot ហើយវាយ /lesson ក្នុង DM ដើម្បីអានមេរៀនពេលណាក៏បាន",
].join("\n");

/**
 * Handles a message in a group/supergroup. Returns true when it was a
 * classroom command; anything else in a group is ignored by the bot.
 */
export async function handleGroupMessage(message) {
  const chatId = message.chat.id;
  const from = message.from;
  const text = String(message.text ?? "").trim();
  const match = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (!match || !from?.id || from.is_bot) return false;
  const command = match[1].toLowerCase();
  const args = (match[2] ?? "").trim();

  if (command === "join") {
    await addMember(chatId, from, args.split(/\s+/)[0] || null);
    await send(chatId, `✅ ${mention({ user_id: from.id, first_name: from.first_name })} បានចុះឈ្មោះ${args ? ` (ក្រុម ${escapeHtml(args.split(/\s+/)[0])})` : ""}`);
    return true;
  }
  if (command === "leave") {
    await db().from("class_members").delete().eq("chat_id", chatId).eq("user_id", from.id);
    await send(chatId, "👋 បានដកឈ្មោះចេញ");
    return true;
  }

  const known = [
    "class", "help", "joinbutton", "students", "settag", "tagall", "tagteam", "check", "auto", "autolist", "autostop", "dm", "stop",
    "addlesson", "lessons", "sendlesson", "lessonstats", "autolesson", "move", "quiz", "scores",
  ];
  if (!known.includes(command)) return false;
  if (command === "class" || command === "help") {
    await send(chatId, HELP);
    return true;
  }
  if (!(await isTeacher(chatId, from.id))) {
    await send(chatId, "⚠️ មានតែគ្រូ (Admin ក្រុម) ទេដែលអាចប្រើពាក្យបញ្ជានេះ");
    return true;
  }
  // Whoever teaches is also on the roster, so a fresh group is never empty;
  // the teacher and the group's name are remembered for /move and /lesson.
  await addMember(chatId, from).catch(() => null);
  await db().from("class_teachers").upsert({ chat_id: chatId, user_id: from.id }, { onConflict: "chat_id,user_id" });
  await db()
    .from("class_settings")
    .upsert({ chat_id: chatId, title: message.chat.title ?? null, updated_at: nowIso() }, { onConflict: "chat_id" });

  const lessonReply = await handleLessonCommand(command, args, message);
  if (lessonReply !== null) return true;

  switch (command) {
    case "joinbutton":
      await send(chatId, "✋ សិស្សទាំងអស់ សូមចុចប៊ូតុងខាងក្រោម ដើម្បីចុះឈ្មោះក្នុងថ្នាក់", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✋ ចុះឈ្មោះ", callback_data: "cls:join" }],
            [{ text: "🤖 Start bot (ទទួលមេរៀនតាម DM)", url: `https://t.me/${await botUsername()}?start=class` }],
          ],
        },
      });
      return true;

    case "students": {
      const list = await members(chatId);
      const teams = new Map();
      for (const m of list) teams.set(m.team || "—", (teams.get(m.team || "—") ?? 0) + 1);
      const s = await settingsFor(chatId);
      const byTeam = [...teams].map(([team, n]) => `• ក្រុម ${escapeHtml(team)}: ${n}`).join("\n");
      await send(
        chatId,
        `👥 សិស្សសរុប: <b>${list.length}</b>\n${byTeam}\n\n🏷 Tag ${s.perMessage} ឈ្មោះ/សារ · រៀងរាល់ ${Math.max(s.gapSeconds, MIN_GROUP_GAP_MS / 1000)} វិនាទី`
      );
      return true;
    }

    case "settag": {
      const [perRaw, gapRaw] = args.split(/\s+/);
      const per = Number(perRaw);
      const gap = Number(gapRaw ?? DEFAULT_GAP_SECONDS);
      if (!Number.isInteger(per) || per < 1 || per > MAX_PER_MESSAGE || !Number.isFinite(gap) || gap < 0) {
        await send(chatId, `ប្រើ៖ /settag &lt;1-${MAX_PER_MESSAGE}&gt; &lt;វិនាទី&gt;\nឧ. /settag 5 4`);
        return true;
      }
      rows(
        await db()
          .from("class_settings")
          .upsert({ chat_id: chatId, per_message: per, gap_seconds: Math.round(gap), updated_at: nowIso() }, { onConflict: "chat_id" })
          .select()
      );
      const note = gap * 1000 < MIN_GROUP_GAP_MS ? `\nℹ️ Telegram អនុញ្ញាតប្រហែល 20 សារ/នាទី ក្នុងមួយក្រុម ដូច្នេះ bot នឹងផ្ញើរៀងរាល់ ${MIN_GROUP_GAP_MS / 1000} វិនាទី` : "";
      await send(chatId, `✅ កំណត់រួច៖ ${per} ឈ្មោះ/សារ · រៀងរាល់ ${Math.round(gap)} វិនាទី${note}`);
      return true;
    }

    case "tagall":
    case "tagteam": {
      let team = null;
      let body = args;
      if (command === "tagteam") {
        [team, ...body] = args.split(/\s+/);
        body = body.join(" ");
        if (!team) {
          await send(chatId, "ប្រើ៖ /tagteam &lt;ក្រុម&gt; [សារ]");
          return true;
        }
      }
      if (!body && message.reply_to_message?.text) body = message.reply_to_message.text;
      const list = (await members(chatId, team)).filter((m) => Number(m.user_id) !== from.id);
      if (!list.length) {
        await send(chatId, "⚠️ មិនទាន់មានសិស្សចុះឈ្មោះទេ — ប្រើ /joinbutton ឲ្យសិស្សចុច ✋");
        return true;
      }
      const s = await settingsFor(chatId);
      const messagesNeeded = Math.ceil(list.length / s.perMessage);
      const seconds = Math.round((messagesNeeded * Math.max(s.gapSeconds * 1000, MIN_GROUP_GAP_MS)) / 1000);
      await send(chatId, `🏷 កំពុង Tag ${list.length} នាក់ (${messagesNeeded} សារ · ប្រហែល ${seconds} វិនាទី) — /stop ដើម្បីបញ្ឈប់`);
      enqueue(chatId, (stopped) => tagRun(chatId, list, body, s, stopped));
      return true;
    }

    case "check": {
      if (!args) {
        await send(chatId, "ប្រើ៖ /check &lt;សារ&gt;\nឧ. /check សូមអានមេរៀនទី 3 ហើយចុច ✅");
        return true;
      }
      const check = rows(
        await db().from("class_checks").insert({ chat_id: chatId, text: args, created_by: from.id }).select("id")
      )[0];
      await send(chatId, `📢 ${escapeHtml(args)}`, { reply_markup: checkKeyboard(check.id, 0) });
      return true;
    }

    case "auto": {
      const parts = /^(\d+)\s+(\d+(?:\.\d+)?)\s+(?:(tag)(?::(\S+))?\s+)?([\s\S]+)$/i.exec(args);
      if (!parts || Number(parts[2]) <= 0) {
        await send(
          chatId,
          "ប្រើ៖ /auto &lt;ចំនួនដង&gt; &lt;នាទី&gt; [tag] &lt;សារ&gt;\n" +
            "ឧ. /auto 3 60 tag កុំភ្លេចធ្វើកិច្ចការផ្ទះ\n" +
            "ឧ. /auto 0 1440 ថ្ងៃនេះរៀនម៉ោង 7 យប់ (0 = រហូតដល់ /autostop)\n" +
            "ឧ. /auto 2 30 tag:A ក្រុម A ត្រៀមបង្ហាញ"
        );
        return true;
      }
      const auto = rows(
        await db()
          .from("class_autos")
          .insert({
            chat_id: chatId,
            times: Number(parts[1]),
            every_minutes: Number(parts[2]),
            tag: Boolean(parts[3]),
            team: parts[4] ?? null,
            text: parts[5],
            next_at: nowIso(),
            created_by: from.id,
          })
          .select("short_id")
      )[0];
      await send(
        chatId,
        `⏰ សារស្វ័យប្រវត្តិ #${auto.short_id}: ${Number(parts[1]) || "♾"} ដង · រៀងរាល់ ${parts[2]} នាទី${parts[3] ? " · Tag សិស្ស" : ""}\nចាប់ផ្តើមឥឡូវ · /autostop ${auto.short_id} ដើម្បីបញ្ឈប់`
      );
      return true;
    }

    case "autolist": {
      const list = rows(
        await db().from("class_autos").select("*").eq("chat_id", chatId).eq("active", true).order("short_id")
      );
      await send(
        chatId,
        list.length
          ? list
              .map((a) => `#${a.short_id} · ${a.sent_count}/${a.times || "♾"} · ${a.every_minutes} នាទី${a.tag ? " · tag" : ""}\n   ${escapeHtml(a.text.slice(0, 60))}`)
              .join("\n")
          : "មិនមានសារស្វ័យប្រវត្តិទេ"
      );
      return true;
    }

    case "autostop": {
      let q = db().from("class_autos").update({ active: false, updated_at: nowIso() }).eq("chat_id", chatId).eq("active", true);
      if (args !== "all") {
        if (!/^\d+$/.test(args)) {
          await send(chatId, "ប្រើ៖ /autostop &lt;លេខ&gt; ឬ /autostop all");
          return true;
        }
        q = q.eq("short_id", Number(args));
      }
      const stoppedRows = rows(await q.select("id"));
      await send(chatId, `⏹ បានបញ្ឈប់ ${stoppedRows.length} សារស្វ័យប្រវត្តិ`);
      return true;
    }

    case "dm": {
      if (!args) {
        await send(chatId, "ប្រើ៖ /dm &lt;សារ&gt;");
        return true;
      }
      const list = await members(chatId);
      const title = escapeHtml(message.chat.title ?? "");
      await send(chatId, `✉️ កំពុងផ្ញើសារផ្ទាល់ទៅសិស្ស ${list.length} នាក់...`);
      enqueue(chatId, async (stopped) => {
        let ok = 0;
        const missing = [];
        for (const m of list) {
          if (stopped()) break;
          const res = await rawApiSafe("sendMessage", {
            chat_id: m.user_id,
            text: `🎓 ${title}\n\n${escapeHtml(args)}`,
            parse_mode: "HTML",
          });
          if (res?.ok) ok += 1;
          else missing.push(m);
          await sleep(DM_GAP_MS);
        }
        const tail = missing.length
          ? `\n⚠️ ${missing.length} នាក់មិនទាន់ Start bot៖ ${missing.slice(0, 30).map(mention).join(" ")}`
          : "";
        await send(chatId, `✅ បានផ្ញើសារផ្ទាល់ ${ok}/${list.length}${tail}`);
      });
      return true;
    }

    case "stop":
      stopRuns(chatId);
      await send(chatId, "⏹ បានបញ្ឈប់ការ Tag");
      return true;

    default:
      return false;
  }
}

/** A DM that may fail (student never started the bot) without logging noise. */
async function rawApiSafe(method, body) {
  try {
    return await withFloodRetry(() => rawApi(method, body), { label: `classroom ${method}` });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ callbacks

/** Handles a "cls:..." button tap. */
export async function handleCallback(cq) {
  const [, kind, checkId] = String(cq.data ?? "").split(":");
  const chatId = cq.message?.chat?.id;
  const from = cq.from;
  if (!chatId || !from?.id) return true;
  const answer = (text) => api("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: false });

  const lessonHandled = await handleLessonCallback(cq, kind, checkId, answer);
  if (lessonHandled) return true;

  if (kind === "join") {
    await addMember(chatId, from);
    await answer("✅ បានចុះឈ្មោះ");
    return true;
  }

  if (kind === "seen") {
    await addMember(chatId, from);
    await db().from("class_check_marks").upsert({ check_id: checkId, user_id: from.id }, { onConflict: "check_id,user_id" });
    const seen = await seenIds(checkId);
    await answer("✅ អរគុណ!");
    await api("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: cq.message.message_id,
      reply_markup: checkKeyboard(checkId, seen.size),
    });
    return true;
  }

  if (kind === "result" || kind === "unseen") {
    if (!(await isTeacher(chatId, from.id))) {
      await answer("មានតែគ្រូទេដែលអាចប្រើប៊ូតុងនេះ");
      return true;
    }
    const seen = await seenIds(checkId);
    const teacherIds = new Set([from.id]);
    const notSeen = (await members(chatId)).filter((m) => !seen.has(Number(m.user_id)) && !teacherIds.has(Number(m.user_id)));
    await answer(kind === "result" ? "📊" : "🔔");
    if (kind === "result") {
      await send(chatId, `📊 បានឃើញ: <b>${seen.size}</b> · មិនទាន់ឃើញ: <b>${notSeen.length}</b>`);
    } else if (!notSeen.length) {
      await send(chatId, "🎉 សិស្សទាំងអស់បានឃើញហើយ");
    } else {
      const s = await settingsFor(chatId);
      enqueue(chatId, (stopped) => tagRun(chatId, notSeen, "🔔 សូមចុច ✅ នៅលើសារខាងលើ", s, stopped));
    }
    return true;
  }

  await answer("");
  return true;
}

// -------------------------------------------------------------- lessons
//
// A lesson is a message the teacher replied to with /addlesson: its text or
// its file_id (photo, video, PDF, audio, voice), so it can be sent again
// to any student's DM even after the group itself is gone.

let cachedBotUsername = null;
async function botUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await api("getMe", {});
  cachedBotUsername = me?.result?.username ?? "";
  return cachedBotUsername;
}

const MEDIA = [
  ["photo", "sendPhoto"],
  ["video", "sendVideo"],
  ["document", "sendDocument"],
  ["audio", "sendAudio"],
  ["voice", "sendVoice"],
  ["animation", "sendAnimation"],
];

function lessonFromMessage(msg) {
  for (const [kind] of MEDIA) {
    const media = msg[kind];
    if (!media) continue;
    const fileId = Array.isArray(media) ? media[media.length - 1].file_id : media.file_id;
    return { kind, file_id: fileId, text: msg.caption ?? "" };
  }
  if (msg.text) return { kind: "text", file_id: null, text: msg.text };
  return null;
}

/** Sends one lesson to a chat (a student's DM), with a "✅ read" button. */
async function sendLesson(chatId, lesson, { safe = false } = {}) {
  const header = `📘 មេរៀនទី ${lesson.position}: ${lesson.title}`;
  const markup = { inline_keyboard: [[{ text: "✅ បានអានហើយ", callback_data: `cls:read:${lesson.id}` }]] };
  const call = safe ? rawApiSafe : api;
  if (lesson.kind === "text") {
    return call("sendMessage", {
      chat_id: chatId,
      text: escapeHtml(`${header}\n\n${lesson.text}`).slice(0, 4096),
      parse_mode: "HTML",
      reply_markup: markup,
    });
  }
  const method = MEDIA.find(([kind]) => kind === lesson.kind)?.[1] ?? "sendDocument";
  return call(method, {
    chat_id: chatId,
    [lesson.kind]: lesson.file_id,
    caption: escapeHtml(`${header}\n\n${lesson.text ?? ""}`).slice(0, 1024),
    parse_mode: "HTML",
    reply_markup: markup,
  });
}

async function lessonByPosition(chatId, position) {
  return rows(
    await db().from("class_lessons").select("*").eq("chat_id", chatId).eq("position", position).limit(1)
  )[0];
}

async function lessonById(id) {
  return rows(await db().from("class_lessons").select("*").eq("id", id).limit(1))[0];
}

async function readIds(lessonId) {
  const marks = await fetchAll(() =>
    db().from("class_lesson_reads").select("user_id").eq("lesson_id", lessonId).order("user_id")
  );
  return new Set(marks.map((m) => Number(m.user_id)));
}

/**
 * DMs a lesson to every student of the group, then reports in the group who
 * got it and tags whoever has not started the bot yet (Telegram does not let
 * a bot write first).
 */
function deliverLesson(chatId, lesson) {
  return enqueue(chatId, async (stopped) => {
    const list = await members(chatId);
    let ok = 0;
    const missing = [];
    for (const m of list) {
      if (stopped()) break;
      const res = await sendLesson(m.user_id, lesson, { safe: true });
      if (res?.ok) ok += 1;
      else missing.push(m);
      await sleep(DM_GAP_MS);
    }
    const tail = missing.length
      ? `\n⚠️ ${missing.length} នាក់មិនទាន់ Start bot — សូមចុចប៊ូតុងខាងក្រោម៖\n${missing.slice(0, 50).map(mention).join(" ")}`
      : "";
    await send(chatId, `📘 មេរៀនទី ${lesson.position} «${escapeHtml(lesson.title)}» បានផ្ញើតាម DM ${ok}/${list.length}${tail}`, {
      reply_markup: {
        inline_keyboard: [[{ text: "🤖 Start bot (ទទួលមេរៀន)", url: `https://t.me/${await botUsername()}?start=class` }]],
      },
    });
  });
}

/** Cambodia time (UTC+7, no DST): the next HH:MM at least `days` days out (0 = today if still ahead). */
function nextAt(time, days, fromNow = true) {
  const [h, m] = time.split(":").map(Number);
  const offset = 7 * 60 * 60 * 1000;
  const local = new Date(Date.now() + offset);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - offset);
  if (!fromNow) target.setUTCDate(target.getUTCDate() + days);
  while (target.getTime() <= Date.now()) target.setUTCDate(target.getUTCDate() + days);
  return target.toISOString();
}

/** Lesson / quiz / move commands (teacher already checked). null when not one of them. */
async function handleLessonCommand(command, args, message) {
  const chatId = message.chat.id;
  const from = message.from;
  switch (command) {
    case "addlesson": {
      const reply = message.reply_to_message;
      const content = reply && lessonFromMessage(reply);
      if (!content) {
        return send(chatId, "ប្រើ៖ Reply លើសារ រូបភាព វីដេអូ ឬ PDF ហើយវាយ /addlesson &lt;ចំណងជើង&gt;");
      }
      const last = rows(
        await db().from("class_lessons").select("position").eq("chat_id", chatId).order("position", { ascending: false }).limit(1)
      )[0];
      const position = (last?.position ?? 0) + 1;
      const title = (args || content.text.split("\n")[0] || `មេរៀនទី ${position}`).slice(0, 100);
      rows(
        await db()
          .from("class_lessons")
          .insert({ chat_id: chatId, position, title, ...content, created_by: from.id })
          .select("id")
      );
      return send(chatId, `✅ រក្សាទុកមេរៀនទី ${position}: ${escapeHtml(title)}\n/sendlesson ${position} — ផ្ញើទៅសិស្សតាម DM`);
    }

    case "lessons": {
      const list = await fetchAll(() =>
        db().from("class_lessons").select("position, title").eq("chat_id", chatId).order("position")
      );
      const s = rows(await db().from("class_settings").select("*").eq("chat_id", chatId).limit(1))[0];
      const auto = s?.lesson_time
        ? `\n\n⏰ ផ្ញើស្វ័យប្រវត្តិ ម៉ោង ${s.lesson_time} រៀងរាល់ ${s.lesson_every_days} ថ្ងៃ · បន្ទាប់៖ មេរៀនទី ${s.lesson_next_pos}`
        : "";
      return send(
        chatId,
        list.length
          ? `📚 មេរៀន (${list.length})\n${list.map((l) => `${l.position}. ${escapeHtml(l.title)}`).join("\n")}${auto}`
          : "មិនទាន់មានមេរៀនទេ — Reply លើសារហើយវាយ /addlesson &lt;ចំណងជើង&gt;"
      );
    }

    case "sendlesson": {
      const lesson = /^\d+$/.test(args) && (await lessonByPosition(chatId, Number(args)));
      if (!lesson) return send(chatId, "ប្រើ៖ /sendlesson &lt;លេខមេរៀន&gt; (មើល /lessons)");
      await send(chatId, `✉️ កំពុងផ្ញើមេរៀនទី ${lesson.position} ទៅសិស្សម្នាក់ៗ...`);
      deliverLesson(chatId, lesson);
      return true;
    }

    case "lessonstats": {
      const lesson = /^\d+$/.test(args) && (await lessonByPosition(chatId, Number(args)));
      if (!lesson) return send(chatId, "ប្រើ៖ /lessonstats &lt;លេខមេរៀន&gt;");
      const read = await readIds(lesson.id);
      const notRead = (await members(chatId)).filter((m) => !read.has(Number(m.user_id)));
      return send(chatId, `📊 មេរៀនទី ${lesson.position}: បានអាន <b>${read.size}</b> · មិនទាន់អាន <b>${notRead.length}</b>`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🔔 Tag អ្នកមិនទាន់អាន", callback_data: `cls:unread:${lesson.id}` }]],
        },
      });
    }

    case "autolesson": {
      if (args === "off") {
        await db().from("class_settings").update({ lesson_time: null, lesson_next_at: null }).eq("chat_id", chatId);
        return send(chatId, "⏹ បានបិទការផ្ញើមេរៀនស្វ័យប្រវត្តិ");
      }
      const match = /^([01]?\d|2[0-3]):([0-5]\d)(?:\s+(\d+))?(?:\s+(\d+))?$/.exec(args);
      if (!match) {
        return send(
          chatId,
          "ប្រើ៖ /autolesson &lt;ម៉ោង&gt; [រៀងរាល់ប៉ុន្មានថ្ងៃ] [ចាប់ពីមេរៀនទី]\nឧ. /autolesson 19:00 1 — ផ្ញើមេរៀនបន្ទាប់រៀងរាល់ថ្ងៃ ម៉ោង 7 យប់\n/autolesson off — បិទ"
        );
      }
      const time = `${match[1].padStart(2, "0")}:${match[2]}`;
      const days = Math.max(Number(match[3] ?? 1), 1);
      const update = { lesson_time: time, lesson_every_days: days, lesson_next_at: nextAt(time, days), updated_at: nowIso() };
      if (match[4]) update.lesson_next_pos = Number(match[4]);
      const s = rows(await db().from("class_settings").update(update).eq("chat_id", chatId).select("lesson_next_pos"))[0];
      return send(chatId, `⏰ នឹងផ្ញើមេរៀនទី ${s?.lesson_next_pos ?? 1} តាម DM ម៉ោង ${time} (ម៉ោងកម្ពុជា) រៀងរាល់ ${days} ថ្ងៃ`);
    }

    case "quiz": {
      const parts = args.split("|").map((p) => p.trim()).filter(Boolean);
      const correct = Number(parts[parts.length - 1]);
      const options = parts.slice(1, -1);
      if (parts.length < 4 || !Number.isInteger(correct) || correct < 1 || correct > options.length || options.length > 10) {
        return send(chatId, "ប្រើ៖ /quiz សំណួរ | ចម្លើយ1 | ចម្លើយ2 | ... | លេខចម្លើយត្រូវ\nឧ. /quiz 2+3=? | 4 | 5 | 6 | 2");
      }
      const res = await api("sendPoll", {
        chat_id: chatId,
        question: parts[0].slice(0, 300),
        options: options.map((text) => ({ text: text.slice(0, 100) })),
        type: "quiz",
        is_anonymous: false,
        correct_option_id: correct - 1,
      });
      const pollId = res?.result?.poll?.id;
      if (pollId) {
        await db().from("class_quizzes").insert({ poll_id: pollId, chat_id: chatId, question: parts[0], correct_option: correct - 1 });
      }
      return true;
    }

    case "scores": {
      const quizzes = await fetchAll(() => db().from("class_quizzes").select("poll_id").eq("chat_id", chatId).order("poll_id"));
      if (!quizzes.length) return send(chatId, "មិនទាន់មានតេស្តទេ — /quiz");
      const answers = await fetchAll(() =>
        db().from("class_quiz_answers").select("user_id, correct").in("poll_id", quizzes.map((q) => q.poll_id)).order("user_id")
      );
      const score = new Map();
      for (const a of answers) {
        const s = score.get(Number(a.user_id)) ?? { right: 0, total: 0 };
        s.total += 1;
        if (a.correct) s.right += 1;
        score.set(Number(a.user_id), s);
      }
      const names = new Map((await members(chatId)).map((m) => [Number(m.user_id), m]));
      const top = [...score].sort((a, b) => b[1].right - a[1].right).slice(0, 30);
      const lines = top.map(([id, s], i) => {
        const m = names.get(id) ?? { user_id: id };
        const name = escapeHtml((m.first_name || m.username || String(id)).slice(0, 32));
        return `${i + 1}. ${name} — ${s.right}/${s.total}`;
      });
      return send(chatId, `🏆 ពិន្ទុ (${quizzes.length} តេស្ត)\n${lines.join("\n") || "មិនទាន់មានអ្នកឆ្លើយ"}`);
    }

    case "move": {
      const oldClasses = rows(
        await db().from("class_teachers").select("chat_id").eq("user_id", from.id).neq("chat_id", chatId)
      );
      if (!oldClasses.length) return send(chatId, "មិនមានថ្នាក់ចាស់ដែលអ្នកជាគ្រូទេ");
      const titles = new Map(
        rows(
          await db().from("class_settings").select("chat_id, title").in("chat_id", oldClasses.map((c) => c.chat_id))
        ).map((r) => [Number(r.chat_id), r.title])
      );
      if (args) pendingLinks.set(chatId, args.split(/\s+/)[0]);
      return send(chatId, "🚚 ផ្ទេរសិស្ស និងមេរៀនពីថ្នាក់ណាមក group នេះ?", {
        reply_markup: {
          inline_keyboard: oldClasses.slice(0, 20).map((c) => [
            { text: `📦 ${titles.get(Number(c.chat_id)) || c.chat_id}`, callback_data: `cls:mv:${c.chat_id}` },
          ]),
        },
      });
    }

    default:
      return null;
  }
}

// The invite link a teacher typed after /move, kept until they pick the old class.
const pendingLinks = new Map();

/**
 * Moves a class into the group /move was sent in: roster, lessons, auto
 * messages and settings follow, and every student who started the bot gets
 * the new group's invite link in a DM.
 */
async function moveClass(oldChatId, newChatId) {
  let link = pendingLinks.get(newChatId);
  pendingLinks.delete(newChatId);
  if (!link) link = (await api("createChatInviteLink", { chat_id: newChatId, name: "class move" }))?.result?.invite_link;
  if (!link) {
    await send(newChatId, "⚠️ Bot មិនអាចបង្កើត invite link បានទេ (ត្រូវជា admin)។ សូមវាយ /move &lt;invite link&gt;");
    return;
  }

  const roster = await members(oldChatId);
  for (let i = 0; i < roster.length; i += 500) {
    const batch = roster.slice(i, i + 500).map(({ user_id, first_name, username, team }) => ({
      chat_id: newChatId, user_id, first_name, username, team, updated_at: nowIso(),
    }));
    await db().from("class_members").upsert(batch, { onConflict: "chat_id,user_id" });
  }
  // New lessons go after any the new group already has.
  const last = rows(
    await db().from("class_lessons").select("position").eq("chat_id", newChatId).order("position", { ascending: false }).limit(1)
  )[0];
  const shift = last?.position ?? 0;
  const lessons = await fetchAll(() => db().from("class_lessons").select("id, position").eq("chat_id", oldChatId).order("position"));
  for (const l of lessons) {
    await db().from("class_lessons").update({ chat_id: newChatId, position: l.position + shift }).eq("id", l.id);
  }
  await db().from("class_autos").update({ chat_id: newChatId }).eq("chat_id", oldChatId).eq("active", true);
  const teachers = rows(await db().from("class_teachers").select("user_id").eq("chat_id", oldChatId));
  if (teachers.length) {
    await db().from("class_teachers").upsert(teachers.map((t) => ({ chat_id: newChatId, user_id: t.user_id })), { onConflict: "chat_id,user_id" });
  }
  const old = rows(await db().from("class_settings").select("*").eq("chat_id", oldChatId).limit(1))[0];
  if (old) {
    await db().from("class_settings").upsert(
      {
        chat_id: newChatId,
        per_message: old.per_message,
        gap_seconds: old.gap_seconds,
        lesson_time: old.lesson_time,
        lesson_every_days: old.lesson_every_days,
        lesson_next_pos: (old.lesson_next_pos ?? 1) + shift,
        lesson_next_at: old.lesson_next_at,
        updated_at: nowIso(),
      },
      { onConflict: "chat_id" }
    );
    await db().from("class_settings").update({ moved_to: newChatId, lesson_time: null, lesson_next_at: null }).eq("chat_id", oldChatId);
  }

  await send(newChatId, `🚚 បានផ្ទេរសិស្ស ${roster.length} នាក់ និងមេរៀន ${lessons.length}។ កំពុងផ្ញើ link ថ្មីទៅសិស្ស...`);
  enqueue(newChatId, async () => {
    let ok = 0;
    for (const m of roster) {
      const res = await rawApiSafe("sendMessage", {
        chat_id: m.user_id,
        text: `🎓 ថ្នាក់របស់អ្នកបានផ្លាស់ទៅ group ថ្មី។ សូមចុចចូល៖\n${link}`,
      });
      if (res?.ok) ok += 1;
      await sleep(DM_GAP_MS);
    }
    await send(newChatId, `✅ បានផ្ញើ link ថ្មីតាម DM ${ok}/${roster.length} នាក់`);
  });
}

/** Lesson and move buttons. True when it handled the tap. */
async function handleLessonCallback(cq, kind, value, answer) {
  const from = cq.from;
  const chatId = cq.message.chat.id;

  if (kind === "l") {
    const lesson = await lessonById(value);
    const isMember = lesson && rows(
      await db().from("class_members").select("user_id").eq("chat_id", lesson.chat_id).eq("user_id", from.id).limit(1)
    ).length;
    if (!isMember) {
      await answer("រកមិនឃើញមេរៀននេះទេ");
      return true;
    }
    await answer("📘");
    await sendLesson(from.id, lesson);
    return true;
  }

  if (kind === "read") {
    await db().from("class_lesson_reads").upsert({ lesson_id: value, user_id: from.id }, { onConflict: "lesson_id,user_id" });
    await answer("✅ ល្អណាស់!");
    await api("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: cq.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: "✅ បានអានរួច", callback_data: "cls:noop" }]] },
    });
    return true;
  }

  if (kind === "unread") {
    const lesson = await lessonById(value);
    if (!lesson || !(await isTeacher(lesson.chat_id, from.id))) {
      await answer("មានតែគ្រូទេដែលអាចប្រើប៊ូតុងនេះ");
      return true;
    }
    const read = await readIds(lesson.id);
    const notRead = (await members(lesson.chat_id)).filter((m) => !read.has(Number(m.user_id)) && Number(m.user_id) !== from.id);
    await answer("🔔");
    if (!notRead.length) {
      await send(lesson.chat_id, "🎉 សិស្សទាំងអស់បានអានហើយ");
    } else {
      const s = await settingsFor(lesson.chat_id);
      enqueue(lesson.chat_id, (stopped) =>
        tagRun(lesson.chat_id, notRead, `🔔 សូមអានមេរៀនទី ${lesson.position} «${lesson.title}» ក្នុង DM របស់ bot ហើយចុច ✅`, s, stopped)
      );
    }
    return true;
  }

  if (kind === "mv") {
    const oldChatId = Number(value);
    const ownsOld = rows(
      await db().from("class_teachers").select("user_id").eq("chat_id", oldChatId).eq("user_id", from.id).limit(1)
    ).length;
    if (!ownsOld || !(await isTeacher(chatId, from.id))) {
      await answer("មានតែគ្រូទេដែលអាចផ្ទេរថ្នាក់");
      return true;
    }
    await answer("🚚");
    await api("deleteMessage", { chat_id: chatId, message_id: cq.message.message_id });
    await moveClass(oldChatId, chatId);
    return true;
  }

  if (kind === "noop") {
    await answer("");
    return true;
  }
  return false;
}

// ---------------------------------------------------- scheduled lessons

/** Sends the next lesson of every class whose /autolesson time has come. */
export async function runDueLessons() {
  if (!config.telegramLoginBotToken) return 0;
  const due = rows(
    await db().from("class_settings").select("*").not("lesson_time", "is", null).lte("lesson_next_at", nowIso()).limit(50)
  );
  let fired = 0;
  for (const s of due) {
    const chatId = Number(s.chat_id);
    const lesson = await lessonByPosition(chatId, s.lesson_next_pos ?? 1);
    const claimed = rows(
      await db()
        .from("class_settings")
        .update({
          lesson_next_pos: lesson ? (s.lesson_next_pos ?? 1) + 1 : s.lesson_next_pos,
          lesson_next_at: nextAt(s.lesson_time, s.lesson_every_days ?? 1, false),
          updated_at: nowIso(),
        })
        .eq("chat_id", chatId)
        .eq("lesson_next_at", s.lesson_next_at)
        .select("chat_id")
    );
    if (!claimed.length) continue;
    if (!lesson) {
      // Out of lessons: say so once a cycle, and the next /addlesson is picked up on time.
      await send(chatId, `ℹ️ មិនមានមេរៀនទី ${s.lesson_next_pos ?? 1} ទេ — Reply លើសារហើយវាយ /addlesson`);
      continue;
    }
    fired += 1;
    deliverLesson(chatId, lesson);
  }
  return fired;
}

// ------------------------------------------------------- student DMs

/** "/lesson" in a student's DM (or /start class): every lesson of every class they are in. */
export async function showStudentLessons(chatId, userId) {
  const classes = rows(await db().from("class_members").select("chat_id").eq("user_id", userId));
  if (!classes.length) {
    await send(chatId, "អ្នកមិនទាន់ចុះឈ្មោះក្នុងថ្នាក់ណាទេ — ចុច ✋ ចុះឈ្មោះ ក្នុង group ថ្នាក់រៀន");
    return;
  }
  const chatIds = classes.map((c) => c.chat_id);
  const titles = new Map(
    rows(await db().from("class_settings").select("chat_id, title").in("chat_id", chatIds)).map((r) => [Number(r.chat_id), r.title])
  );
  const lessons = rows(
    await db().from("class_lessons").select("id, chat_id, position, title").in("chat_id", chatIds).order("position", { ascending: false }).limit(60)
  );
  if (!lessons.length) {
    await send(chatId, "📚 មិនទាន់មានមេរៀនទេ");
    return;
  }
  const many = new Set(lessons.map((l) => l.chat_id)).size > 1;
  await send(chatId, "📚 ចុចលើមេរៀនដើម្បីអាន៖", {
    reply_markup: {
      inline_keyboard: lessons.map((l) => [
        {
          text: `${many ? `${(titles.get(Number(l.chat_id)) || "").slice(0, 20)} · ` : ""}${l.position}. ${l.title}`.slice(0, 64),
          callback_data: `cls:l:${l.id}`,
        },
      ]),
    },
  });
}

// ---------------------------------------------------------------- quiz

/** A student's answer to a /quiz (Telegram's poll_answer update). */
export async function handlePollAnswer(pollAnswer) {
  const user = pollAnswer?.user;
  if (!user?.id || !pollAnswer.poll_id) return;
  const quiz = rows(await db().from("class_quizzes").select("*").eq("poll_id", pollAnswer.poll_id).limit(1))[0];
  if (!quiz) return;
  if (!pollAnswer.option_ids?.length) {
    await db().from("class_quiz_answers").delete().eq("poll_id", quiz.poll_id).eq("user_id", user.id);
    return;
  }
  await addMember(Number(quiz.chat_id), user);
  await db().from("class_quiz_answers").upsert(
    { poll_id: quiz.poll_id, user_id: user.id, correct: pollAnswer.option_ids[0] === quiz.correct_option },
    { onConflict: "poll_id,user_id" }
  );
}
