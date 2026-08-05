const LOCAL_KEY = "unfallmanagement-studio-v1";

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (parsed && Array.isArray(parsed.incidents) && Array.isArray(parsed.actions)) return parsed;
  } catch (error) {
    console.warn("Lokale Daten konnten nicht gelesen werden", error);
  }
  return { incidents: [], actions: [], history: [], settings: {} };
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

function normalizeIncident(row) {
  if (!row) return row;
  if (row.data) {
    return {
      ...row.data,
      id: row.id,
      caseNumber: row.case_number,
      status: row.status,
      incidentDate: row.incident_date,
      department: row.department,
      affectedPerson: row.affected_person,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  return row;
}

function normalizeAction(row) {
  if (!row) return row;
  if (Object.prototype.hasOwnProperty.call(row, "incident_id")) {
    return {
      ...(row.data || {}),
      id: row.id,
      incidentId: row.incident_id,
      title: row.title,
      cause: row.cause,
      hierarchy: row.hierarchy,
      responsibleName: row.responsible_name,
      responsibleEmail: row.responsible_email,
      managerEmail: row.manager_email,
      dueDate: row.due_date,
      extendedDueDate: row.extended_due_date,
      extensionReason: row.extension_reason,
      extensionRequestedAt: row.extension_requested_at,
      escalationState: row.escalation_state,
      escalatedAt: row.escalated_at,
      status: row.status,
      completedAt: row.completed_at,
      effectivenessDueDate: row.effectiveness_due_date,
      effectivenessStatus: row.effectiveness_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  return row;
}

export class DataStore {
  constructor(config) {
    this.config = config;
    this.mode = config.mode === "supabase" && config.supabaseUrl && config.supabaseAnonKey ? "supabase" : "local";
    this.client = null;
    this.user = null;
    this.profile = null;
  }

  async init() {
    if (this.mode === "supabase") {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
      this.client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      const { data } = await this.client.auth.getSession();
      this.user = data.session?.user || null;
      if (this.user) await this.loadProfile();
    }
    return this;
  }

  async loadProfile() {
    if (!this.client || !this.user) return null;
    const { data, error } = await this.client.from("profiles").select("*").eq("id", this.user.id).maybeSingle();
    if (error) console.warn(error);
    this.profile = data || { id: this.user.id, full_name: this.user.email, role: "user" };
    return this.profile;
  }

  isAuthenticated() {
    return this.mode === "local" || Boolean(this.user);
  }

  async signIn(email, password) {
    if (this.mode !== "supabase") return { ok: true };
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    this.user = data.user;
    await this.loadProfile();
    return { ok: true };
  }

  async signOut() {
    if (this.client) await this.client.auth.signOut();
    this.user = null;
    this.profile = null;
  }

  async listIncidents() {
    if (this.mode === "local") {
      return readLocal().incidents.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    const { data, error } = await this.client.from("incidents").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(normalizeIncident);
  }

  async getIncident(id) {
    if (this.mode === "local") return readLocal().incidents.find((item) => item.id === id) || null;
    const { data, error } = await this.client.from("incidents").select("*").eq("id", id).single();
    if (error) throw error;
    return normalizeIncident(data);
  }

  async saveIncident(incident) {
    if (this.mode === "local") {
      const db = readLocal();
      const timestamp = nowIso();
      const record = {
        ...incident,
        id: incident.id || uuid(),
        createdAt: incident.createdAt || timestamp,
        updatedAt: timestamp
      };
      const index = db.incidents.findIndex((item) => item.id === record.id);
      if (index >= 0) db.incidents[index] = record;
      else db.incidents.unshift(record);
      db.history.unshift({ id: uuid(), incidentId: record.id, type: "incident_saved", at: timestamp, text: `Vorgang ${record.caseNumber} gespeichert.` });
      writeLocal(db);
      return record;
    }

    const payload = {
      id: incident.id,
      case_number: incident.caseNumber,
      status: incident.status || "offen",
      incident_date: incident.incidentDate || null,
      department: incident.department || null,
      affected_person: incident.affectedPerson || null,
      data: incident
    };
    const query = incident.createdAt
      ? this.client.from("incidents").update(payload).eq("id", incident.id)
      : this.client.from("incidents").insert({ ...payload, created_by: this.user.id });
    const { data, error } = await query.select("*").single();
    if (error) throw error;
    return normalizeIncident(data);
  }

  async deleteIncident(id) {
    if (this.mode === "local") {
      const db = readLocal();
      db.incidents = db.incidents.filter((item) => item.id !== id);
      db.actions = db.actions.filter((item) => item.incidentId !== id);
      writeLocal(db);
      return;
    }
    const { error } = await this.client.from("incidents").delete().eq("id", id);
    if (error) throw error;
  }

  async listActions() {
    if (this.mode === "local") {
      return readLocal().actions.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    }
    const { data, error } = await this.client.from("actions").select("*").order("due_date", { ascending: true });
    if (error) throw error;
    return data.map(normalizeAction);
  }

  async saveAction(action) {
    if (this.mode === "local") {
      const db = readLocal();
      const timestamp = nowIso();
      const record = {
        ...action,
        id: action.id || uuid(),
        createdAt: action.createdAt || timestamp,
        updatedAt: timestamp
      };
      const index = db.actions.findIndex((item) => item.id === record.id);
      if (index >= 0) db.actions[index] = record;
      else db.actions.unshift(record);
      db.history.unshift({ id: uuid(), incidentId: record.incidentId, actionId: record.id, type: "action_saved", at: timestamp, text: `Maßnahme „${record.title}“ gespeichert.` });
      writeLocal(db);
      return record;
    }

    const payload = {
      id: action.id,
      incident_id: action.incidentId || null,
      title: action.title,
      cause: action.cause || null,
      hierarchy: action.hierarchy || null,
      responsible_name: action.responsibleName || null,
      responsible_email: action.responsibleEmail,
      manager_email: action.managerEmail || null,
      due_date: action.dueDate || null,
      extended_due_date: action.extendedDueDate || null,
      extension_reason: action.extensionReason || null,
      extension_requested_at: action.extensionRequestedAt || null,
      escalation_state: action.escalationState || "none",
      escalated_at: action.escalatedAt || null,
      status: action.status || "offen",
      completed_at: action.completedAt || null,
      effectiveness_due_date: action.effectivenessDueDate || null,
      effectiveness_status: action.effectivenessStatus || "offen",
      data: action
    };
    const query = action.createdAt
      ? this.client.from("actions").update(payload).eq("id", action.id)
      : this.client.from("actions").insert({ ...payload, created_by: this.user.id });
    const { data, error } = await query.select("*").single();
    if (error) throw error;
    return normalizeAction(data);
  }

  async completeAction(id) {
    const actions = await this.listActions();
    const action = actions.find((item) => item.id === id);
    if (!action) throw new Error("Maßnahme nicht gefunden.");
    return this.saveAction({ ...action, status: "erledigt", completedAt: nowIso() });
  }

  async requestExtension(id, newDate, reason) {
    const actions = await this.listActions();
    const action = actions.find((item) => item.id === id);
    if (!action) throw new Error("Maßnahme nicht gefunden.");
    const updated = await this.saveAction({
      ...action,
      extendedDueDate: newDate,
      extensionReason: reason,
      extensionRequestedAt: nowIso(),
      escalationState: "extension_requested"
    });
    await this.triggerTaskNotification("extension", updated);
    return updated;
  }

  async escalateAction(id) {
    const actions = await this.listActions();
    const action = actions.find((item) => item.id === id);
    if (!action) throw new Error("Maßnahme nicht gefunden.");
    const updated = await this.saveAction({ ...action, escalationState: "manager_notified", escalatedAt: nowIso() });
    await this.triggerTaskNotification("escalation", updated);
    return updated;
  }

  async triggerTaskNotification(type, action) {
    if (this.mode !== "supabase" || !this.config.functionsBaseUrl) return { sent: false, reason: "local" };
    const { data } = await this.client.auth.getSession();
    const response = await fetch(`${this.config.functionsBaseUrl}/task-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token || this.config.supabaseAnonKey}`
      },
      body: JSON.stringify({ type, actionId: action.id })
    });
    if (!response.ok) throw new Error(`Benachrichtigung fehlgeschlagen (${response.status}).`);
    return response.json();
  }

  async historyForIncident(incidentId) {
    if (this.mode === "local") return readLocal().history.filter((item) => item.incidentId === incidentId);
    const { data, error } = await this.client.from("action_history").select("*").eq("incident_id", incidentId).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  exportLocalData() {
    return JSON.stringify(readLocal(), null, 2);
  }

  importLocalData(text) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.incidents) || !Array.isArray(parsed.actions)) throw new Error("Ungültiges Sicherungsformat.");
    writeLocal({ incidents: parsed.incidents, actions: parsed.actions, history: parsed.history || [], settings: parsed.settings || {} });
  }

  clearLocalData() {
    localStorage.removeItem(LOCAL_KEY);
  }
}
