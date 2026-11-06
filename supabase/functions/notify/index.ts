// Gearizo: send push notifications when something happens in the studio.
// Called by a database trigger (see supabase/push.sql) on every insert/update in public.docs.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  "mailto:" + (Deno.env.get("VAPID_CONTACT") || "admin@example.com"),
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

type Doc = { collection: string; id: string; data: Record<string, any>; updated_by: string | null };
type Msg = { body: string; url: string; tag: string; role?: "content" | "marketing"; user?: string };

const mmss = (s: number) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => { const [, m, day] = d.split("-").map(Number); return day + " " + MONTHS[m - 1]; };

async function nameOf(id?: string | null) {
  if (!id) return "Someone";
  const { data } = await sb.from("docs").select("data").eq("collection", "profiles").eq("id", id).maybeSingle();
  return (data?.data?.name as string) || "Someone";
}
async function itemTitle(id?: string) {
  if (!id) return "a video";
  const { data } = await sb.from("docs").select("data").eq("collection", "items").eq("id", id).maybeSingle();
  const d = data?.data || {};
  return (d.code ? d.code + " " : "") + (d.title || "a video");
}

async function describe(type: string, rec: Doc, old: Doc | null, roleOf: Record<string, string>): Promise<Msg | null> {
  const d = rec.data || {}, o = old?.data || {};
  const actor = rec.updated_by;
  switch (rec.collection) {
    case "tasks":
      if (type === "INSERT" && !d.done)
        return { role: d.for === "marketing" ? "marketing" : "content", body: `${await nameOf(d.by || actor)} gave you a task: ${d.text}` + (d.due ? ` (due ${shortDate(d.due)})` : ""), url: "./#tasks", tag: "task-" + rec.id };
      if (type === "UPDATE" && d.done && !o.done && d.by)
        return { user: d.by, body: `${await nameOf(d.doneBy || actor)} finished: ${d.text}`, url: "./#tasks", tag: "task-" + rec.id };
      return null;
    case "feedback":
      if (type !== "INSERT") return null;
      return { role: "content", body: `${await nameOf(d.by || actor)} left feedback on ${await itemTitle(d.item)}` + (d.version ? ` v${d.version}` : "") + (typeof d.t === "number" ? ` at ${mmss(d.t)}` : "") + (d.text ? `: ${d.text}` : ""), url: "./#review", tag: "fb-" + d.item };
    case "versions":
      if (type !== "INSERT") return null;
      return { role: "marketing", body: `${await nameOf(d.by || actor)} added v${d.n} of ${await itemTitle(d.item)}`, url: "./#review", tag: "v-" + d.item };
    case "inbox":
      if (type !== "INSERT") return null;
      return { role: "content", body: `New video in Checking: ${d.name}. Pick its content.`, url: "./#review", tag: "inbox" };
    case "items": {
      const title = (d.code ? d.code + " " : "") + (d.title || "a video");
      if (type === "INSERT" && d.createdBy) {
        const mk = roleOf[d.createdBy] === "marketing";
        return { role: mk ? "content" : "marketing", body: `${await nameOf(d.createdBy)} ${mk ? "assigned" : "planned"} ${title}` + (d.date ? ` for ${shortDate(d.date)}` : ""), url: "./#calendar", tag: "item-" + rec.id };
      }
      if (type !== "UPDATE" || d.status === o.status) return null;
      if (d.status === "review") return { role: "marketing", body: `${await nameOf(d.submittedBy || actor)} sent ${title}` + (d.submittedV ? ` v${d.submittedV}` : "") + " for review", url: "./#review", tag: "item-" + rec.id };
      if (d.status === "changes") return { role: "content", body: `${await nameOf(d.changesBy || actor)} asked for changes on ${title}`, url: "./#review", tag: "item-" + rec.id };
      if (d.status === "approved") return { role: "content", body: `${await nameOf(d.approvedBy || actor)} approved ${title}`, url: "./#review", tag: "item-" + rec.id };
      if (d.status === "posted") return { role: "content", body: `${await nameOf(d.postedBy || actor)} marked ${title} as posted`, url: "./#calendar", tag: "item-" + rec.id };
      return null;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-gz-secret") !== Deno.env.get("GZ_HOOK_SECRET")) return new Response("forbidden", { status: 401 });
  const { type, record, old_record } = await req.json();
  const { data: team } = await sb.from("docs").select("id,data").eq("collection", "team");
  const roleOf: Record<string, string> = Object.fromEntries((team || []).map((r: any) => [r.id, r.data?.role]));
  const msg = await describe(type, record, old_record, roleOf);
  if (!msg) return new Response("nothing to send");
  const actor = record.updated_by;
  const { data: subs } = await sb.from("push_subs").select("endpoint,user_id,sub");
  const targets = (subs || []).filter((s: any) =>
    s.user_id !== actor &&
    (msg.user ? s.user_id === msg.user : !msg.role || !roleOf[s.user_id] || roleOf[s.user_id] === msg.role));
  const payload = JSON.stringify({ title: "Gearizo", body: msg.body.slice(0, 240), url: msg.url, tag: msg.tag });
  let sent = 0;
  await Promise.all(targets.map(async (s: any) => {
    try { await webpush.sendNotification(s.sub, payload, { TTL: 86400, urgency: "high" }); sent++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
