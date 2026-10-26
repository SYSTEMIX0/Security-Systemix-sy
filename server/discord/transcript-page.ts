import type { Express, Request, Response } from "express";
import type { TicketRow } from "../../drizzle/schema";
import { asyncRoute } from "./api/common";
import { getDiscordClient } from "./bot";
import { getGuildConfig } from "./core/context";
import { getActiveDiscordSession, requireManagedDiscordGuild } from "./oauth";
import { getTicketById, type TicketTranscript } from "./store/tickets";
import { TRANSCRIPT_ROUTE_PREFIX } from "./transcript-url";

const MAX_MESSAGES = 500;
const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function isTicketTranscriptParticipant(
  ticket: Pick<TicketRow, "openerId" | "claimedById" | "closedById">,
  userId: string,
): boolean {
  return [ticket.openerId, ticket.claimedById, ticket.closedById].some((id) => id === userId);
}

async function canViewTicketTranscript(ticket: TicketRow, session: NonNullable<Awaited<ReturnType<typeof getActiveDiscordSession>>>): Promise<boolean> {
  const userId = session.user.id;
  if (isTicketTranscriptParticipant(ticket, userId)) return true;

  try {
    await requireManagedDiscordGuild(session, ticket.guildId);
    return true;
  } catch {
    // A support role may view a transcript without receiving broad Manage Server access.
  }

  const guild = getDiscordClient()?.guilds.cache.get(ticket.guildId);
  if (!guild) return false;
  const [member, config] = await Promise.all([
    guild.members.fetch(userId).catch(() => null),
    getGuildConfig(ticket.guildId).catch(() => null),
  ]);
  if (!member || !config) return false;
  const staffRoleIds = new Set([...config.tickets.staffRoleIds, ...config.general.staffRoleIds]);
  return member.roles.cache.some((role) => staffRoleIds.has(role.id));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function boundedString(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reads only the bounded JSON shape produced by Security Systemix, never arbitrary HTML. */
export function parseTicketTranscript(value: string): TicketTranscript | null {
  try {
    const raw = JSON.parse(value) as unknown;
    if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.messages)) return null;
    return {
      version: 1,
      channelName: boundedString(raw.channelName, 100, "ticket"),
      exportedAt: boundedString(raw.exportedAt, 64),
      truncated: raw.truncated === true,
      messages: raw.messages.slice(0, MAX_MESSAGES).filter(isRecord).map((message) => ({
        authorId: boundedString(message.authorId, 24, "غير معروف"),
        authorName: boundedString(message.authorName, 100, "مستخدم Discord"),
        bot: message.bot === true,
        content: boundedString(message.content, 4_000),
        // Attachment names are retained for context, never their private CDN URLs.
        attachments: Array.isArray(message.attachments) ? message.attachments.filter((item): item is string => typeof item === "string").slice(0, 10).map((item) => item.slice(0, 160)) : [],
        createdAt: boundedString(message.createdAt, 64),
      })),
    };
  } catch {
    return null;
  }
}

function formatDate(value: Date | string | null): string {
  if (!value) return "غير متاح";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير متاح";
  return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(date);
}

function transcriptMessagesHtml(transcript: TicketTranscript): string {
  if (!transcript.messages.length) return '<div class="empty">لم تُرسل رسائل قابلة للتصدير داخل هذه التذكرة.</div>';
  return transcript.messages.map((message) => {
    const attachments = message.attachments.map((name) => `<span class="attachment">${escapeHtml(name)}</span>`).join("");
    const content = escapeHtml(message.content || "—").replace(/\r?\n/g, "<br>");
    return `<article class="message">
      <div class="avatar">${escapeHtml((message.authorName || "?").slice(0, 1).toUpperCase())}</div>
      <div class="message-body">
        <div class="message-meta"><strong>${escapeHtml(message.authorName || "مستخدم Discord")}</strong>${message.bot ? '<span class="bot-tag">BOT</span>' : ""}<time>${escapeHtml(formatDate(message.createdAt))}</time></div>
        <div class="message-content">${content}</div>
        ${attachments ? `<div class="attachments">${attachments}</div>` : ""}
      </div>
    </article>`;
  }).join("\n");
}

export function renderTranscriptPage(ticket: TicketRow, transcript: TicketTranscript): string {
  const exportedCount = transcript.messages.length;
  const truncated = transcript.truncated ? '<div class="notice">تم الوصول إلى الحد الأقصى: يعرض هذا السجل أول 500 رسالة فقط.</div>' : "";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>سجل التذكرة #${ticket.ticketNumber} · Security Systemix</title>
  <style>
    :root{color-scheme:dark;--ink:#111318;--panel:#1c2028;--line:#343b48;--soft:#aeb6c6;--accent:#86d9ff;--success:#93e2ad;--text:#f4f7fb}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#252b37 0,#111318 42rem);color:var(--text);font-family:Tahoma,Arial,sans-serif;line-height:1.65}.wrap{width:min(980px,calc(100% - 32px));margin:32px auto 56px}.brand{display:flex;align-items:center;gap:11px;color:var(--soft);font-size:13px}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,#86d9ff,#6076f4);color:#10141e;font-weight:900}.hero,.meta,.messages{border:1px solid var(--line);background:rgba(28,32,40,.94);box-shadow:0 18px 50px rgba(0,0,0,.22)}.hero{margin-top:18px;padding:26px;border-radius:18px}.eyebrow{margin:0;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.04em}.hero h1{margin:7px 0 6px;font-size:clamp(24px,5vw,38px);line-height:1.25}.hero p{margin:0;color:var(--soft)}.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:14px;border-radius:14px;overflow:hidden}.meta div{min-height:83px;padding:14px;background:#171b22}.meta span{display:block;color:var(--soft);font-size:12px}.meta strong{display:block;margin-top:5px;font-size:14px;overflow-wrap:anywhere}.status{color:var(--success)}.notice{margin-top:14px;border:1px solid #765d34;background:#2c251a;color:#f1d69e;border-radius:11px;padding:10px 13px;font-size:13px}.messages{margin-top:14px;border-radius:18px;padding:8px 22px}.messages-header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px 0;border-bottom:1px solid var(--line);color:var(--soft);font-size:13px}.messages-header strong{color:var(--text);font-size:15px}.message{display:flex;gap:12px;padding:18px 0;border-bottom:1px solid rgba(52,59,72,.72)}.message:last-child{border-bottom:0}.avatar{flex:0 0 38px;width:38px;height:38px;display:grid;place-items:center;border-radius:50%;background:#303a4d;color:#d8ebff;font-weight:800}.message-body{min-width:0;flex:1}.message-meta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.message-meta strong{font-size:14px}.message-meta time{color:#8993a7;font-size:11px}.bot-tag{padding:1px 5px;border-radius:4px;background:#5865f2;color:#fff;font-size:9px;font-weight:700}.message-content{margin-top:4px;overflow-wrap:anywhere;color:#e9edf4;font-size:14px}.attachments{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.attachment{border:1px solid #3c6e8e;background:#1b2d3c;color:#bde6ff;border-radius:7px;padding:4px 9px;font-size:12px}.empty{padding:30px 0;text-align:center;color:var(--soft)}.foot{margin-top:14px;color:#7f8999;text-align:center;font-size:11px}@media(max-width:620px){.wrap{width:min(100% - 20px,980px);margin-top:16px}.hero{padding:20px}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.messages{padding:7px 14px}.message{gap:9px}.avatar{flex-basis:34px;width:34px;height:34px}}
  </style>
</head>
<body><main class="wrap">
  <div class="brand"><span class="brand-mark">S</span><span>Security Systemix · Ticket Archive</span></div>
  <section class="hero"><p class="eyebrow">سجل تذكرة محمي</p><h1>التذكرة #${ticket.ticketNumber}</h1><p>القناة السابقة: ${escapeHtml(transcript.channelName)} · القسم: ${escapeHtml(ticket.topic)}</p></section>
  <section class="meta"><div><span>صاحب التذكرة</span><strong>${escapeHtml(ticket.openerId)}</strong></div><div><span>أُغلقت بواسطة</span><strong>${escapeHtml(ticket.closedById ?? "غير متاح")}</strong></div><div><span>الحالة</span><strong class="status">مغلقة</strong></div><div><span>وقت الفتح</span><strong>${escapeHtml(formatDate(ticket.createdAt))}</strong></div><div><span>وقت الإغلاق</span><strong>${escapeHtml(formatDate(ticket.closedAt))}</strong></div><div><span>عدد الرسائل المصدّرة</span><strong>${exportedCount}</strong></div></section>
  ${truncated}
  <section class="messages"><header class="messages-header"><strong>المحادثة</strong><span>صُدِّرت ${escapeHtml(formatDate(transcript.exportedAt))}</span></header>${transcriptMessagesHtml(transcript)}</section>
  <p class="foot">هذا الرابط لا يعرض السجل إلا بعد التحقق من صلاحية حساب Discord. لا تنشره خارج فريق الدعم.</p>
</main></body></html>`;
}

function renderAccessPage(title: string, message: string, loginUrl?: string): string {
  const action = loginUrl ? `<a href="${escapeHtml(loginUrl)}">ربط حساب Discord</a>` : "";
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Security Systemix</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111318;color:#f4f7fb;font-family:Tahoma,Arial,sans-serif}.box{max-width:460px;margin:20px;padding:28px;border:1px solid #343b48;border-radius:16px;background:#1c2028;text-align:center}.box h1{font-size:22px}.box p{color:#aeb6c6;line-height:1.8}.box a{display:inline-block;margin-top:7px;padding:9px 15px;border-radius:8px;background:#86d9ff;color:#111318;text-decoration:none;font-weight:700}</style><main class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${action}</main></html>`;
}

function transcriptId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function registerTicketTranscriptRoutes(app: Express): void {
  app.get(`${TRANSCRIPT_ROUTE_PREFIX}:ticketId`, asyncRoute(async (req: Request, res: Response) => {
    res.set({ "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; media-src https:; base-uri 'none'; form-action 'none'" });
    const id = transcriptId(req.params.ticketId);
    if (!id) return void res.status(404).send(renderAccessPage("السجل غير موجود", "لم نعثر على سجل التذكرة المطلوب."));

    const session = await getActiveDiscordSession(req, res);
    if (!session) {
      const loginUrl = `/api/discord/login?returnTo=${encodeURIComponent(`${TRANSCRIPT_ROUTE_PREFIX}${id}`)}`;
      return void res.status(401).send(renderAccessPage("سجل التذكرة محمي", "اربط حساب Discord الذي فتح التذكرة أو يدير السيرفر، ثم ستعود إلى هذا السجل.", loginUrl));
    }

    const ticket = await getTicketById(id);
    if (!ticket || ticket.status !== "closed" || !ticket.transcript) return void res.status(404).send(renderAccessPage("السجل غير موجود", "لا يوجد سجل محفوظ لهذه التذكرة."));
    if (!await canViewTicketTranscript(ticket, session)) return void res.status(404).send(renderAccessPage("السجل غير موجود", "لا يوجد سجل متاح لهذا الحساب."));

    const transcript = parseTicketTranscript(ticket.transcript);
    if (!transcript) return void res.status(410).send(renderAccessPage("تعذر قراءة السجل", "سجل هذه التذكرة غير صالح أو لم يكتمل تصديره."));
    res.status(200).type("html").send(renderTranscriptPage(ticket, transcript));
  }));
}
