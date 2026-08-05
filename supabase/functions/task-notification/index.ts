import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function sendMail(apiKey: string, from: string, payload: Record<string, unknown>) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...payload })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { type, actionId } = await req.json();
  if (!["extension", "escalation"].includes(type) || !actionId) return new Response(JSON.stringify({ error: "Ungültige Anfrage" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: action, error } = await db.from("actions").select("*, incidents(case_number, department)").eq("id", actionId).single();
  if (error || !action) return new Response(JSON.stringify({ error: "Maßnahme nicht gefunden" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!action.manager_email) return new Response(JSON.stringify({ error: "Keine E-Mail-Adresse der Führungskraft hinterlegt" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const resendKey = Deno.env.get("RESEND_API_KEY")!;
  const mailFrom = Deno.env.get("MAIL_FROM") || "Unfallmanagement <noreply@example.com>";
  const appUrl = Deno.env.get("APP_URL") || "";
  const isEscalation = type === "escalation";
  const subject = isEscalation ? `[Unfallmanagement] Überfällige Maßnahme eskaliert` : `[Unfallmanagement] Fristverlängerung beantragt`;
  const html = `<div style="font-family:Arial,sans-serif;color:#132b31;max-width:700px;margin:auto">
    <h2>${isEscalation ? "Überfällige Maßnahme" : "Antrag auf Fristverlängerung"}</h2>
    <p><strong>Maßnahme:</strong> ${escapeHtml(action.title)}</p>
    <p><strong>Vorgang:</strong> ${escapeHtml(action.incidents?.case_number || "Allgemeine Maßnahme")} · ${escapeHtml(action.incidents?.department || "")}</p>
    <p><strong>Verantwortlich:</strong> ${escapeHtml(action.responsible_name || "")} (${escapeHtml(action.responsible_email)})</p>
    <p><strong>Ursprüngliche Frist:</strong> ${escapeHtml(action.due_date || "–")}</p>
    ${isEscalation ? `<p style="background:#fde8e7;padding:12px;border-radius:8px">Die Maßnahme ist überfällig und wurde über die Schaltfläche „Führungskraft informieren“ eskaliert.</p>` : `<p><strong>Beantragte neue Frist:</strong> ${escapeHtml(action.extended_due_date || "–")}</p><p><strong>Begründung:</strong> ${escapeHtml(action.extension_reason || "–")}</p>`}
    ${appUrl ? `<p><a href="${escapeHtml(appUrl)}" style="background:#0b5968;color:white;padding:11px 16px;text-decoration:none;border-radius:8px;display:inline-block">Maßnahmenmanagement öffnen</a></p>` : ""}
    <p style="font-size:12px;color:#63777d">Bitte keine Gesundheitsdaten per E-Mail übermitteln.</p>
  </div>`;

  try {
    const sent = await sendMail(resendKey, mailFrom, { to: [action.manager_email], cc: [action.responsible_email], subject, html });
    await db.from("email_logs").insert({ message_type: type, recipient: action.manager_email, cc: action.responsible_email, action_id: action.id, provider_message_id: sent.id || null, delivery_status: "sent" });
    return new Response(JSON.stringify({ sent: true, id: sent.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (mailError) {
    const message = mailError instanceof Error ? mailError.message : String(mailError);
    await db.from("email_logs").insert({ message_type: type, recipient: action.manager_email, cc: action.responsible_email, action_id: action.id, delivery_status: "failed", error_message: message });
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
