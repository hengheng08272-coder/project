/**
 * Tests the classroom bot and sends homework to students, from your own
 * computer -- no Telegram group commands needed.
 *
 * Settings come from backend-node/classroom.env (copy classroom.env.example).
 *
 *   npm run classroom -- check                 bot, group and database are set up right
 *   npm run classroom -- students              the class roster
 *   npm run classroom -- homework              send HOMEWORK_TEXT from classroom.env
 *   npm run classroom -- homework "text"       send this text instead
 *   npm run classroom -- homework "text" --dry-run   show who would get it, send nothing
 *   npm run classroom -- stats                 who has read the latest homework
 *
 * Homework is saved as a lesson (so students can open it again with /lesson,
 * and /lessonstats works), posted in the group, and DMed to every student
 * with a "✅ read" button. Sent at Telegram's pace; 429s are waited out.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, "classroom.env") });
dotenv.config({ path: path.join(root, ".env") });

const env = (name) => (process.env[name] ?? "").trim();
const TOKEN = env("TELEGRAM_LOGIN_BOT_TOKEN");
const CHAT_ID = Number(env("CLASS_CHAT_ID"));
const DM_GAP_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ok = (msg) => console.log(`✅ ${msg}`);
const bad = (msg) => console.log(`❌ ${msg}`);

/** One Bot API call; waits out a 429 and tries again. */
async function tg(method, body = {}) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error_code !== 429) return data;
    const wait = Number(data.parameters?.retry_after ?? 5);
    console.log(`   ⏳ Telegram asked to wait ${wait}s...`);
    await sleep((wait + 1) * 1000);
  }
  return { ok: false, description: "too many retries" };
}

function db() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

function requireSettings(...names) {
  const missing = names.filter((n) => !env(n));
  if (missing.length) {
    bad(`classroom.env is missing: ${missing.join(", ")}`);
    console.log("   Copy classroom.env.example to classroom.env and fill it in.");
    process.exit(1);
  }
}

async function roster() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("class_members")
      .select("user_id, first_name, username, team")
      .eq("chat_id", CHAT_ID)
      .order("user_id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

const nameOf = (m) => m.first_name || (m.username ? `@${m.username}` : String(m.user_id));

// ------------------------------------------------------------- commands

async function check() {
  requireSettings("TELEGRAM_LOGIN_BOT_TOKEN", "CLASS_CHAT_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  let failures = 0;

  const me = await tg("getMe");
  if (me.ok) ok(`Bot token works: @${me.result.username}`);
  else return bad(`Bot token rejected: ${me.description}`);

  const chat = await tg("getChat", { chat_id: CHAT_ID });
  if (chat.ok) {
    ok(`Group found: ${chat.result.title} (${chat.result.type})`);
  } else {
    failures += 1;
    bad(`Group ${CHAT_ID} not reachable: ${chat.description} — is the bot in the group? Send /chatid there.`);
  }

  const member = await tg("getChatMember", { chat_id: CHAT_ID, user_id: me.result.id });
  if (member.ok) ok(`Bot is in the group as: ${member.result.status}`);

  const hook = await tg("getWebhookInfo");
  if (hook.result?.url) {
    ok(`Webhook: ${hook.result.url}`);
    const updates = hook.result.allowed_updates ?? [];
    if (updates.length && !updates.includes("poll_answer")) {
      failures += 1;
      bad("Webhook does not receive poll_answer — redeploy the backend so /quiz scores work.");
    }
    if (hook.result.last_error_message) {
      failures += 1;
      bad(`Last webhook error: ${hook.result.last_error_message} (${new Date(hook.result.last_error_date * 1000).toISOString()})`);
    }
  } else {
    failures += 1;
    bad("No webhook set — the backend (Railway) is not running or PUBLIC_URL is missing. Group commands won't be answered.");
  }

  const tables = ["class_members", "class_settings", "class_checks", "class_autos", "class_teachers", "class_lessons", "class_lesson_reads", "class_quizzes"];
  const missingTables = [];
  for (const table of tables) {
    const { error } = await db().from(table).select("*", { head: true, count: "exact" }).limit(1);
    if (error) missingTables.push(`${table} (${error.message})`);
  }
  if (missingTables.length) {
    failures += 1;
    bad(`Database: ${missingTables.join(", ")} — run the classroom migrations.`);
  } else {
    ok("Database: all classroom tables exist");
  }

  const list = await roster();
  if (list.length) ok(`${list.length} student(s) registered`);
  else bad("No students yet — send /joinbutton in the group and ask students to tap ✋ and 🤖 Start bot.");

  console.log(failures ? `\n⚠️ ${failures} problem(s) found` : "\n🎉 Everything is ready");
}

async function students() {
  requireSettings("CLASS_CHAT_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const list = await roster();
  console.log(`👥 ${list.length} student(s)\n`);
  for (const m of list) console.log(`  ${String(m.user_id).padEnd(12)} ${nameOf(m)}${m.team ? `  [${m.team}]` : ""}`);
}

async function homework(args) {
  requireSettings("TELEGRAM_LOGIN_BOT_TOKEN", "CLASS_CHAT_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const dryRun = args.includes("--dry-run");
  const text = args.filter((a) => a !== "--dry-run").join(" ").trim() || env("HOMEWORK_TEXT");
  const title = env("HOMEWORK_TITLE") || "កិច្ចការផ្ទះ";
  if (!text) return bad('No homework text: npm run classroom -- homework "..." or set HOMEWORK_TEXT');

  const list = await roster();
  console.log(`📘 ${title}\n${text}\n\n→ ${list.length} student(s)${dryRun ? " (dry run, nothing sent)" : ""}`);
  if (dryRun) {
    for (const m of list) console.log(`  • ${nameOf(m)}`);
    return;
  }

  // Saved as the next lesson, so /lesson and /lessonstats know about it.
  const { data: last } = await db()
    .from("class_lessons").select("position").eq("chat_id", CHAT_ID).order("position", { ascending: false }).limit(1);
  const position = (last?.[0]?.position ?? 0) + 1;
  const { data: saved, error } = await db()
    .from("class_lessons")
    .insert({ chat_id: CHAT_ID, position, title, kind: "text", text })
    .select("id")
    .single();
  if (error) return bad(`Could not save the homework: ${error.message}`);

  await tg("sendMessage", {
    chat_id: CHAT_ID,
    text: `📘 <b>${escapeHtml(title)}</b> (មេរៀនទី ${position})\n\n${escapeHtml(text)}\n\n✉️ បានផ្ញើទៅ DM របស់សិស្សម្នាក់ៗ — ចុច ✅ ពេលអានរួច`,
    parse_mode: "HTML",
  });

  let sent = 0;
  const missing = [];
  for (const m of list) {
    const res = await tg("sendMessage", {
      chat_id: m.user_id,
      text: escapeHtml(`📘 មេរៀនទី ${position}: ${title}\n\n${text}`).slice(0, 4096),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "✅ បានអានហើយ", callback_data: `cls:read:${saved.id}` }]] },
    });
    if (res.ok) sent += 1;
    else missing.push(m);
    process.stdout.write(`\r   sent ${sent}/${list.length}`);
    await sleep(DM_GAP_MS);
  }
  console.log("");
  ok(`DM sent to ${sent}/${list.length} student(s) — lesson #${position}`);
  if (missing.length) {
    bad(`${missing.length} have not started the bot (Telegram does not allow a bot to DM them first):`);
    for (const m of missing) console.log(`  • ${nameOf(m)}`);
  }
  console.log(`\nCheck who read it: npm run classroom -- stats   (or /lessonstats ${position} in the group)`);
}

async function stats() {
  requireSettings("CLASS_CHAT_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const { data: lessons } = await db()
    .from("class_lessons").select("id, position, title").eq("chat_id", CHAT_ID).order("position", { ascending: false }).limit(1);
  const lesson = lessons?.[0];
  if (!lesson) return bad("No homework/lessons yet");
  const { data: reads } = await db().from("class_lesson_reads").select("user_id").eq("lesson_id", lesson.id);
  const read = new Set((reads ?? []).map((r) => Number(r.user_id)));
  const list = await roster();
  const notRead = list.filter((m) => !read.has(Number(m.user_id)));
  console.log(`📊 #${lesson.position} ${lesson.title}: read ${read.size} · not yet ${notRead.length}`);
  for (const m of notRead) console.log(`  • ${nameOf(m)}`);
}

const [command = "check", ...args] = process.argv.slice(2);
const commands = { check, students, homework, stats };
if (!commands[command]) {
  console.log("Usage: npm run classroom -- check | students | homework [\"text\"] [--dry-run] | stats");
  process.exit(1);
}
if (!Number.isFinite(CHAT_ID) && command !== "check") requireSettings("CLASS_CHAT_ID");
await commands[command](args).catch((err) => {
  bad(err?.message ?? err);
  process.exit(1);
});
