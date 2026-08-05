import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-job-token"
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string | null): string {
  if (!value) return "ohne Frist";
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(new Date(`${value}T12:00:00Z`));
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

  const jobToken = Deno.env.get("WEEKLY_JOB_TOKEN") || "";
  if (!jobToken || req.headers.get("x-job-token") !== jobToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY")!;
  const mailFrom = Deno.env.get("MAIL_FROM") || "Unfallmanagement <noreply@example.com>";
  const appUrl = Deno.env.get("APP_URL") || "";
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: rows, error } = await db.from("open_action_reminders").select("*").order("effective_due_date", { ascending: true });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const grouped = new Map<string, any[]>();
  for (const row of rows || []) {
    if (!row.responsible_email) continue;
    const list = grouped.get(row.responsible_email) || [];
    list.push(row);
    grouped.set(row.responsible_email, list);
  }

  const results: any[] = [];
  for (const [recipient, actions] of grouped.entries()) {
    const overdueCount = actions.filter((a) => a.is_overdue).length;
    const subject = overdueCount
      ? `[Unfallmanagement] ${overdueCount} überfällige und ${actions.length} offene Maßnahme(n)`
      : `[Unfallmanagement] ${actions.length} offene Maßnahme(n)`;

    const rowsHtml = actions.map((action) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #dde5e7"><strong>${escapeHtml(action.title)}</strong><br><small>${escapeHtml(action.case_number || "Allgemeine Maßnahme")} · ${escapeHtml(action.department || "")}</small></td>
        <td style="padding:10px;border-bottom:1px solid #dde5e7">${formatDate(action.effective_due_date)}</td>
        <td style="padding:10px;border-bottom:1px solid #dde5e7;color:${action.is_overdue ? "#b3261e" : "#245f9b"};font-weight:700">${action.is_overdue ? "Überfällig" : "Offen"}</td>
      </tr>`).join("");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#132b31;max-width:760px;margin:auto">
        <h2>Wöchentliche Maßnahmenübersicht</h2>
        <p>Hallo ${escapeHtml(actions[0]?.responsible_name || "")},</p>
        <p>die folgenden Maßnahmen sind weiterhin offen. Diese Erinnerung wird wöchentlich versandt, bis die jeweilige Maßnahme als erledigt dokumentiert wurde.</p>
        <table style="border-collapse:collapse;width:100%;margin:20px 0"><thead><tr style="background:#edf3f4"><th style="text-align:left;padding:10px">Maßnahme</th><th style="text-align:left;padding:10px">Frist</th><th style="text-align:left;padding:10px">Status</th></tr></thead><tbody>${rowsHtml}</tbody></table>
        ${overdueCount ? `<p style="background:#fde8e7;padding:12px;border-radius:8px"><strong>${overdueCount} Maßnahme(n) sind überfällig.</strong> Bitte erledigen, eine Fristverlängerung begründet beantragen oder die Führungskraft über die Anwendung informieren.</p>` : ""}
        ${appUrl ? `<p><a href="${escapeHtml(appUrl)}" style="background:#0b5968;color:white;padding:11px 16px;text-decoration:none;border-radius:8px;display:inline-block">Maßnahmenmanagement öffnen</a></p>` : ""}
        <p style="font-size:12px;color:#63777d">Automatische Nachricht aus dem Unfallmanagement Studio. Bitte nicht mit Gesundheitsdaten per E-Mail antworten.</p>
      </div>`;

    try {
      const sent = await sendMail(resendKey, mailFrom, { to: [recipient], subject, html });
      results.push({ recipient, status: "sent", id: sent.id, count: actions.length });
      await db.from("email_logs").insert({ message_type: "weekly_reminder", recipient, provider_message_id: sent.id || null, delivery_status: "sent" });
      await db.from("actions").update({ last_weekly_reminder_at: new Date().toISOString() }).in("id", actions.map((a) => a.id));
    } catch (mailError) {
      const message = mailError instanceof Error ? mailError.message : String(mailError);
      results.push({ recipient, status: "failed", error: message });
      await db.from("email_logs").insert({ message_type: "weekly_reminder", recipient, delivery_status: "failed", error_message: message });
    }
  }

  return new Response(JSON.stringify({ processedRecipients: grouped.size, processedActions: rows?.length || 0, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
