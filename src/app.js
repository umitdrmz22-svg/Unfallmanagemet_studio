import { DataStore } from "./storage.js";
import {
  LEGAL_SOURCES,
  classifyIncident,
  getActionState,
  makeCaseNumber,
  suggestedFollowUp,
  validateWhyAnswer
} from "./rules.js";

const config = window.UNFALL_CONFIG || {};
const store = await new DataStore(config).init();
const app = document.getElementById("app");

const state = {
  view: "dashboard",
  incidents: [],
  actions: [],
  modal: null,
  step: 0,
  draft: null,
  actionDraft: null,
  sidebarOpen: false,
  loading: false
};

const steps = ["Ereignis", "Sofortmaßnahmen", "Einstufung", "Untersuchung", "5-Why", "Maßnahmen", "Abschluss"];
const whyCategories = ["Technik", "Organisation", "Arbeitsverfahren", "Qualifikation", "Kommunikation", "Arbeitsumgebung", "Führung", "Instandhaltung", "Prüfung", "MenschlicherFaktor"];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function checked(value) { return value ? "checked" : ""; }
function selected(value, expected) { return value === expected ? "selected" : ""; }
function fmtDate(value) {
  if (!value) return "–";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat("de-DE").format(date);
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

function statusBadge(status) {
  const map = {
    offen: ["Offen", "badge-warning"],
    in_bearbeitung: ["In Bearbeitung", "badge-info"],
    abgeschlossen: ["Abgeschlossen", "badge-success"],
    erledigt: ["Erledigt", "badge-success"]
  };
  const [label, cls] = map[status] || [status || "Offen", "badge-neutral"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function actionStateBadge(action) {
  const current = getActionState(action);
  if (current === "completed") return `<span class="badge badge-success">Erledigt</span>`;
  if (current === "overdue") return `<span class="badge badge-danger">Überfällig</span>`;
  if (current === "dueSoon") return `<span class="badge badge-warning">Bald fällig</span>`;
  return `<span class="badge badge-info">Offen</span>`;
}

function notify(message, type = "success") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

async function reload() {
  state.loading = true;
  try {
    [state.incidents, state.actions] = await Promise.all([store.listIncidents(), store.listActions()]);
  } catch (error) {
    notify(error.message || "Daten konnten nicht geladen werden.", "error");
  } finally {
    state.loading = false;
    render();
  }
}

function navButton(view, icon, label) {
  return `<button class="nav-button ${state.view === view ? "active" : ""}" data-view="${view}"><span class="nav-icon">${icon}</span>${label}</button>`;
}

function layout(content, title, subtitle) {
  return `
    <div class="layout">
      <aside class="sidebar ${state.sidebarOpen ? "open" : ""}">
        <div class="brand">
          <div class="brand-mark">UM</div>
          <div><h1>${esc(config.appName || "Unfallmanagement Studio")}</h1><small>${esc(config.siteName || "Betrieb")}</small></div>
        </div>
        <nav class="nav">
          ${navButton("dashboard", "▦", "Dashboard")}
          ${navButton("incidents", "✚", "Ereignisse")}
          ${navButton("actions", "✓", "Maßnahmen")}
          ${navButton("reports", "▤", "Auswertungen")}
          ${navButton("legal", "§", "Rechtsgrundlagen")}
          ${navButton("settings", "⚙", "Einstellungen")}
        </nav>
        <div class="sidebar-footer">
          <div class="mode-pill"><span class="mode-dot"></span>${store.mode === "supabase" ? "Online-Betrieb" : "Lokaler Demo-Betrieb"}</div>
          <div>Regelbasierte Vorprüfung ohne KI.</div>
          ${store.mode === "supabase" ? `<button class="btn btn-ghost btn-sm" style="color:#dcebed;padding-left:0" data-action="logout">Abmelden</button>` : ""}
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div style="display:flex;align-items:center;gap:12px">
            <button class="btn btn-secondary mobile-menu" data-action="toggle-menu">☰</button>
            <div><h2>${esc(title)}</h2><p>${esc(subtitle || "")}</p></div>
          </div>
          <div class="topbar-actions">
            <button class="btn btn-secondary" data-action="new-action">＋ Maßnahme</button>
            <button class="btn btn-primary" data-action="new-incident">＋ Ereignis melden</button>
          </div>
        </header>
        <div class="content">${content}</div>
      </main>
    </div>
    ${renderModal()}
  `;
}

function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <form class="login-card" id="login-form">
        <div class="brand-mark" style="margin-bottom:18px">UM</div>
        <h1>Unfallmanagement Studio</h1>
        <p>Anmeldung für berechtigte Beschäftigte. Gesundheits- und Unfalldaten dürfen nur in einer freigegebenen, geschützten Umgebung verarbeitet werden.</p>
        <div class="field" style="margin-top:20px"><label class="required">E-Mail-Adresse</label><input type="email" name="email" required autocomplete="username"></div>
        <div class="field" style="margin-top:13px"><label class="required">Passwort</label><input type="password" name="password" required autocomplete="current-password"></div>
        <button class="btn btn-primary btn-block" style="margin-top:18px">Anmelden</button>
        <div id="login-error" class="help" style="color:var(--danger);margin-top:12px"></div>
      </form>
    </div>`;
}

function renderDashboard() {
  const openIncidents = state.incidents.filter((i) => i.status !== "abgeschlossen").length;
  const reportable = state.incidents.filter((i) => classifyIncident(i).reportable).length;
  const overdue = state.actions.filter((a) => getActionState(a) === "overdue").length;
  const openActions = state.actions.filter((a) => a.status !== "erledigt").length;
  const recent = state.incidents.slice(0, 6);
  const urgent = state.actions.filter((a) => ["overdue", "dueSoon"].includes(getActionState(a))).slice(0, 8);

  const localBanner = store.mode === "local" ? `
    <div class="banner banner-warning"><div>⚠</div><div><strong>Lokaler Demo-Betrieb</strong><p>Daten werden nur in diesem Browser gespeichert. Keine realen Gesundheitsdaten eingeben. Für Mehrbenutzerbetrieb, Zugriffsschutz und automatische E-Mails ist die Supabase-Konfiguration erforderlich.</p></div></div>` : "";

  return layout(`
    ${localBanner}
    <div class="grid grid-4">
      <div class="card metric"><div class="metric-label">Offene Ereignisse</div><div class="metric-value">${openIncidents}</div><div class="metric-note">Noch nicht abgeschlossen</div></div>
      <div class="card metric"><div class="metric-label">Voraussichtlich meldepflichtig</div><div class="metric-value">${reportable}</div><div class="metric-note">Regelbasierte Vorprüfung</div></div>
      <div class="card metric"><div class="metric-label">Offene Maßnahmen</div><div class="metric-value">${openActions}</div><div class="metric-note">Bis zur Erledigung im Wochenlauf</div></div>
      <div class="card metric"><div class="metric-label">Überfällige Maßnahmen</div><div class="metric-value">${overdue}</div><div class="metric-note">Eskalation oder Fristverlängerung</div></div>
    </div>

    <section class="section">
      <div class="section-head"><div><h3>Aktuelle Ereignisse</h3><p>Zuletzt angelegte oder bearbeitete Vorgänge.</p></div><button class="btn btn-secondary btn-sm" data-view="incidents">Alle anzeigen</button></div>
      <div class="card table-wrap">${incidentTable(recent)}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><h3>Fällige Maßnahmen</h3><p>Überfällige und in den nächsten sieben Tagen fällige Aufgaben.</p></div><button class="btn btn-secondary btn-sm" data-view="actions">Maßnahmenmanagement öffnen</button></div>
      <div class="card table-wrap">${actionTable(urgent)}</div>
    </section>
  `, "Dashboard", "Unfalluntersuchung, rechtliche Vorprüfung und Maßnahmenverfolgung");
}

function incidentTable(items) {
  if (!items.length) return `<div class="empty"><strong>Noch keine Ereignisse vorhanden</strong>Starten Sie mit „Ereignis melden“.</div>`;
  return `<table><thead><tr><th>Vorgang</th><th>Ereignis</th><th>Einstufung</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>${items.map((incident) => {
    const result = classifyIncident(incident);
    return `<tr>
      <td><div class="cell-title">${esc(incident.caseNumber)}</div><div class="cell-sub">${esc(incident.department || "Ohne Bereich")}</div></td>
      <td><div class="cell-title">${fmtDate(incident.incidentDate)}</div><div class="cell-sub">${esc(incident.eventDescription || "Keine Beschreibung")}</div></td>
      <td><span class="badge badge-${result.typeLevel}">${esc(result.preliminaryType)}</span>${result.reportable ? `<div class="cell-sub" style="color:var(--danger)">Unfallanzeige prüfen</div>` : ""}</td>
      <td>${statusBadge(incident.status)}</td>
      <td><div class="actions"><button class="btn btn-secondary btn-sm" data-action="view-incident" data-id="${incident.id}">Öffnen</button><button class="btn btn-ghost btn-sm" data-action="edit-incident" data-id="${incident.id}">Bearbeiten</button></div></td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

function actionTable(items) {
  if (!items.length) return `<div class="empty"><strong>Keine offenen Fälligkeiten</strong>Aktuell besteht kein Handlungsbedarf.</div>`;
  return `<table><thead><tr><th>Maßnahme</th><th>Verantwortlich</th><th>Frist</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>${items.map((action) => {
    const actionState = getActionState(action);
    const due = action.extendedDueDate || action.dueDate;
    return `<tr>
      <td><div class="cell-title">${esc(action.title)}</div><div class="cell-sub">${esc(action.hierarchy || "Ohne Maßnahmenart")} · ${esc(action.cause || "Keine Ursache zugeordnet")}</div></td>
      <td><div class="cell-title">${esc(action.responsibleName || "–")}</div><div class="cell-sub">${esc(action.responsibleEmail || "–")}</div></td>
      <td><div class="cell-title">${fmtDate(due)}</div>${action.extendedDueDate ? `<div class="cell-sub">Frist verlängert</div>` : ""}</td>
      <td>${actionStateBadge(action)}</td>
      <td><div class="actions">
        ${action.status !== "erledigt" ? `<button class="btn btn-success btn-sm" data-action="complete-action" data-id="${action.id}">Erledigt</button>` : ""}
        <button class="btn btn-secondary btn-sm" data-action="edit-action" data-id="${action.id}">Bearbeiten</button>
        ${actionState === "overdue" ? `<button class="btn btn-warning btn-sm" data-action="extend-action" data-id="${action.id}">Frist verlängern</button><button class="btn btn-danger btn-sm" data-action="escalate-action" data-id="${action.id}">Führungskraft informieren</button>` : ""}
      </div></td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

function renderIncidents() {
  return layout(`
    <div class="banner banner-info"><div>i</div><div><strong>Betriebliche Vorprüfung</strong><p>Die Anwendung unterstützt die Dokumentation und Vorprüfung. Die verbindliche Anerkennung eines Versicherungsfalls erfolgt durch den zuständigen Unfallversicherungsträger.</p></div></div>
    <div class="card table-wrap">${incidentTable(state.incidents)}</div>
  `, "Ereignisse", `${state.incidents.length} Vorgänge im System`);
}

function renderActions() {
  const open = state.actions.filter((a) => a.status !== "erledigt");
  const done = state.actions.filter((a) => a.status === "erledigt");
  return layout(`
    <div class="banner banner-info"><div>✉</div><div><strong>Wöchentliche Erinnerung</strong><p>Offene Maßnahmen werden wöchentlich nach verantwortlicher E-Mail-Adresse gebündelt. Erinnerungen enden erst mit dem Status „Erledigt“. Bei Fristüberschreitung stehen Eskalation und Fristverlängerung zur Verfügung.</p></div></div>
    <section><div class="section-head"><div><h3>Offene Maßnahmen</h3><p>${open.length} Aufgaben in Bearbeitung</p></div></div><div class="card table-wrap">${actionTable(open)}</div></section>
    <section class="section"><div class="section-head"><div><h3>Erledigte Maßnahmen</h3><p>${done.length} abgeschlossene Aufgaben</p></div></div><div class="card table-wrap">${actionTable(done)}</div></section>
  `, "Maßnahmenmanagement", "Verantwortung, Fristen, Erinnerungen und Wirksamkeitskontrolle");
}

function renderReports() {
  const total = state.incidents.length;
  const work = state.incidents.filter((i) => classifyIncident(i).preliminaryType.includes("Arbeitsunfall")).length;
  const commute = state.incidents.filter((i) => classifyIncident(i).preliminaryType.includes("Wegeunfall")).length;
  const near = state.incidents.filter((i) => classifyIncident(i).preliminaryType.includes("Beinahe")).length;
  const completion = state.actions.length ? Math.round(state.actions.filter((a) => a.status === "erledigt").length / state.actions.length * 100) : 0;
  return layout(`
    <div class="grid grid-4">
      <div class="card metric"><div class="metric-label">Ereignisse gesamt</div><div class="metric-value">${total}</div></div>
      <div class="card metric"><div class="metric-label">Voraussichtliche Arbeitsunfälle</div><div class="metric-value">${work}</div></div>
      <div class="card metric"><div class="metric-label">Voraussichtliche Wegeunfälle</div><div class="metric-value">${commute}</div></div>
      <div class="card metric"><div class="metric-label">Beinaheereignisse</div><div class="metric-value">${near}</div></div>
    </div>
    <section class="section"><div class="card card-pad"><h3 style="margin-top:0">Maßnahmenerledigung</h3><div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>${completion} % erledigt</span><span>${state.actions.filter(a=>a.status === "erledigt").length} / ${state.actions.length}</span></div><div class="kpi-bar"><div class="kpi-fill" style="width:${completion}%"></div></div></div></section>
    <section class="section"><div class="section-head"><div><h3>Datenexport</h3><p>Browseransicht drucken oder lokale Daten als JSON sichern.</p></div></div><div class="card card-pad"><div class="actions"><button class="btn btn-secondary" data-action="print">Drucken / PDF</button>${store.mode === "local" ? `<button class="btn btn-secondary" data-action="export-data">Lokale Sicherung exportieren</button>` : ""}</div></div></section>
  `, "Auswertungen", "Kennzahlen und Nachweise");
}

function renderLegal() {
  return layout(`
    <div class="banner banner-warning"><div>⚖</div><div><strong>Hinweis zur Rechtsanwendung</strong><p>Die verlinkten Vorschriften müssen bei Änderungen des Rechtsstands geprüft werden. Stand der hinterlegten Regelprüfung: ${esc(config.legalReviewDate || "nicht angegeben")}.</p></div></div>
    <div class="grid grid-2">${LEGAL_SOURCES.map((source) => `<div class="card card-pad"><h3 style="margin-top:0">${esc(source.label)}</h3><p style="color:var(--muted);font-size:13px;line-height:1.6">${esc(source.note)}</p><a href="${source.url}" target="_blank" rel="noreferrer">Amtliche Quelle öffnen ↗</a></div>`).join("")}</div>
    <section class="section"><div class="card card-pad"><h3 style="margin-top:0">Entscheidungsgrenzen</h3><ul style="line-height:1.8;font-size:13px"><li>Keine automatische Anerkennung oder Ablehnung eines Arbeits- oder Wegeunfalls.</li><li>Keine medizinische Diagnose und keine abschließende Bewertung der Behandlungsbedürftigkeit.</li><li>Sonderpflichten aus Genehmigungen, Störfallrecht, Wasserrecht oder betrieblichen Alarmplänen sind standortspezifisch zu ergänzen.</li><li>Fristen und Adressaten sind vor Versand durch eine beauftragte Person zu kontrollieren.</li></ul></div></section>
  `, "Rechtsgrundlagen", "Amtliche Quellen und Systemgrenzen");
}

function renderSettings() {
  return layout(`
    <div class="grid grid-2">
      <div class="card card-pad"><h3 style="margin-top:0">Betriebsmodus</h3><dl class="detail-list"><dt>Modus</dt><dd>${store.mode === "supabase" ? "Supabase / Mehrbenutzer" : "Lokaler Browser"}</dd><dt>Standort</dt><dd>${esc(config.siteName || "–")}</dd><dt>KI-Dienste</dt><dd>Nicht verwendet</dd><dt>Wochenlauf</dt><dd>Montag, über GitHub Actions</dd></dl></div>
      <div class="card card-pad"><h3 style="margin-top:0">Datenschutz</h3><p style="font-size:13px;line-height:1.6;color:var(--muted)">Erfassen Sie nur erforderliche Angaben. Medizinische Diagnosen und ausführliche Behandlungsdaten gehören nicht in die allgemeine Unfallakte. Produktivbetrieb nur mit Supabase Auth, RLS, abgestimmtem Berechtigungskonzept und Löschkonzept.</p></div>
    </div>
    ${store.mode === "local" ? `<section class="section"><div class="card card-pad"><h3 style="margin-top:0">Lokale Datenverwaltung</h3><div class="actions"><button class="btn btn-secondary" data-action="export-data">Sicherung exportieren</button><label class="btn btn-secondary" for="import-file">Sicherung importieren</label><input id="import-file" type="file" accept="application/json" hidden><button class="btn btn-danger" data-action="clear-data">Lokale Daten löschen</button></div></div></section>` : ""}
  `, "Einstellungen", "Betrieb, Datenschutz und Datensicherung");
}

function render() {
  if (!store.isAuthenticated()) return renderLogin();
  const views = { dashboard: renderDashboard, incidents: renderIncidents, actions: renderActions, reports: renderReports, legal: renderLegal, settings: renderSettings };
  app.innerHTML = (views[state.view] || renderDashboard)();
}

function baseIncident() {
  return {
    id: uid(),
    caseNumber: makeCaseNumber(state.incidents),
    status: "offen",
    incidentDate: todayIso(),
    knowledgeDate: todayIso(),
    incidentTime: "",
    department: "",
    affectedPerson: "",
    personType: "Eigene Beschäftigte",
    eventDescription: "",
    activity: "",
    injuryDescription: "",
    firstAid: false,
    doctor: false,
    hospital: false,
    witnesses: "",
    equipment: "",
    hazardousSubstance: "",
    timeLimited: false,
    externalImpact: false,
    healthDamage: false,
    death: false,
    insuredActivity: false,
    directCommute: false,
    privateInterruption: false,
    propertyDamage: false,
    severeInjury: false,
    massAccident: false,
    auFullCalendarDays: "",
    auBeyondAccidentDay: false,
    treatmentLongerThanWeek: false,
    remediesOrAids: false,
    recurrenceTreatment: false,
    hazardousSubstanceInvolved: false,
    seriousHealthDamage: false,
    annexEquipment: false,
    safetyComponentFailure: false,
    immediateMeasures: [],
    investigation: {},
    whyProblem: "",
    whys: Array.from({ length: 5 }, () => ({ answer: "", category: "Organisation" })),
    closure: {},
    actions: []
  };
}

async function openIncident(id = null, readOnly = false) {
  const incident = id ? state.incidents.find((item) => item.id === id) : null;
  state.draft = incident ? structuredClone(incident) : baseIncident();
  state.draft.actions = id ? state.actions.filter((action) => action.incidentId === id).map((a) => structuredClone(a)) : [];
  state.step = 0;
  state.modal = readOnly ? "incident-detail" : "incident-wizard";
  render();
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal === "incident-wizard") return renderIncidentWizard();
  if (state.modal === "incident-detail") return renderIncidentDetail();
  if (state.modal === "action") return renderActionModal();
  if (state.modal === "extension") return renderExtensionModal();
  if (state.modal === "confirm-escalation") return renderEscalationModal();
  return "";
}

function renderIncidentWizard() {
  return `<div class="modal-backdrop"><div class="modal">
    <div class="modal-head"><div><h3>${esc(state.draft.caseNumber)}</h3><div class="cell-sub">Unfallmanagement-Vorgang</div></div><button class="close" data-action="close-modal">×</button></div>
    <div class="modal-body">
      <div class="stepper">${steps.map((label, index) => `<button class="step ${index === state.step ? "active" : index < state.step ? "done" : ""}" data-action="goto-step" data-step="${index}">${index + 1}. ${label}</button>`).join("")}</div>
      <form id="incident-step-form">${renderStep(state.step)}</form>
    </div>
    <div class="modal-foot"><button class="btn btn-secondary" data-action="wizard-back" ${state.step === 0 ? "disabled" : ""}>Zurück</button><div class="actions"><button class="btn btn-secondary" data-action="save-draft">Zwischenspeichern</button>${state.step < steps.length - 1 ? `<button class="btn btn-primary" data-action="wizard-next">Weiter</button>` : `<button class="btn btn-success" data-action="finish-incident">Vorgang speichern</button>`}</div></div>
  </div></div>`;
}

function checkField(name, title, help = "") {
  return `<label class="check-row"><input type="checkbox" name="${name}" ${checked(state.draft[name])}><span><strong>${title}</strong>${help ? `<div class="help">${help}</div>` : ""}</span></label>`;
}

function renderStep(step) {
  const d = state.draft;
  if (step === 0) return `
    <div class="form-section"><h4>Ereignisdaten</h4><p>Nur erforderliche Angaben erfassen. Keine medizinischen Diagnosen dokumentieren.</p><div class="form-grid form-grid-3">
      <div class="field"><label class="required">Ereignisdatum</label><input type="date" name="incidentDate" value="${esc(d.incidentDate)}" required></div>
      <div class="field"><label>Uhrzeit</label><input type="time" name="incidentTime" value="${esc(d.incidentTime)}"></div>
      <div class="field"><label class="required">Kenntnisdatum des Unternehmens</label><input type="date" name="knowledgeDate" value="${esc(d.knowledgeDate)}" required></div>
      <div class="field"><label class="required">Bereich / Abteilung</label><input name="department" value="${esc(d.department)}" required placeholder="z. B. Produktion"></div>
      <div class="field"><label>Betroffene Person</label><input name="affectedPerson" value="${esc(d.affectedPerson)}" placeholder="Name oder Personalnummer"></div>
      <div class="field"><label>Personengruppe</label><select name="personType">${["Eigene Beschäftigte","Leiharbeitnehmer","Fremdfirma","Besucher","Sonstige versicherte Person"].map(v=>`<option ${selected(d.personType,v)}>${v}</option>`).join("")}</select></div>
      <div class="field full"><label class="required">Was ist passiert?</label><textarea name="eventDescription" required placeholder="Sachlich, zeitlich geordnet und ohne Schuldzuweisung.">${esc(d.eventDescription)}</textarea></div>
      <div class="field full"><label>Tätigkeit zum Ereigniszeitpunkt</label><textarea name="activity">${esc(d.activity)}</textarea></div>
    </div></div>
    <div class="form-section"><h4>Folgen und Beteiligte</h4><div class="form-grid">
      <div class="field"><label>Verletzung / Beschwerden</label><textarea name="injuryDescription" placeholder="Nur erforderliche Beschreibung, keine Diagnose.">${esc(d.injuryDescription)}</textarea></div>
      <div class="field"><label>Zeugen</label><textarea name="witnesses">${esc(d.witnesses)}</textarea></div>
      <div class="field"><label>Beteiligtes Arbeitsmittel</label><input name="equipment" value="${esc(d.equipment)}"></div>
      <div class="field"><label>Beteiligter Gefahrstoff</label><input name="hazardousSubstance" value="${esc(d.hazardousSubstance)}"></div>
      <div class="checkbox-grid full">${checkField("firstAid","Erste Hilfe durchgeführt")}${checkField("doctor","Ärztliche Behandlung")}${checkField("hospital","Krankenhaus / Rettungsdienst")}${checkField("propertyDamage","Sachschaden entstanden")}</div>
    </div></div>`;

  if (step === 1) {
    const measures = ["Erste Hilfe sichergestellt","Rettungsdienst verständigt","Gefahrenbereich abgesperrt","Arbeitsmittel außer Betrieb genommen","Energiequellen gesichert","Freisetzung gestoppt","Unfallstelle fotografisch dokumentiert","Beweismittel gesichert","Zeugen identifiziert","Führungskraft informiert","EHS / Sifa informiert","Werksleitung informiert"];
    return `<div class="banner banner-danger"><div>!</div><div><strong>Bei schweren Ereignissen</strong><p>Unfallstelle nicht verändern, soweit dies nicht zur Rettung oder unmittelbaren Gefahrenabwehr erforderlich ist. Behördliche und unfallversicherungsrechtliche Sofortmeldungen gesondert prüfen.</p></div></div>
      <div class="form-section"><h4>Sofortmaßnahmen und Beweissicherung</h4><p>Durchgeführte Schritte markieren.</p><div class="checkbox-grid">${measures.map((m,i)=>`<label class="check-row"><input type="checkbox" name="immediate_${i}" ${checked((d.immediateMeasures||[]).includes(m))}><span>${m}</span></label>`).join("")}</div><div class="field" style="margin-top:14px"><label>Ergänzende Sofortmaßnahmen</label><textarea name="immediateNotes">${esc(d.immediateNotes || "")}</textarea></div></div>`;
  }

  if (step === 2) {
    const result = classifyIncident(d);
    return `<div class="form-section"><h4>Unfallbegriff und versicherte Tätigkeit</h4><p>Die Antworten erzeugen eine regelbasierte Vorprüfung nach § 8 und § 193 SGB VII.</p><div class="checkbox-grid">
      ${checkField("timeLimited","Zeitlich begrenztes Ereignis","Ein einzelnes Ereignis oder eine zeitlich bestimmbare Einwirkung.")}
      ${checkField("externalImpact","Äußere Einwirkung auf den Körper")}
      ${checkField("healthDamage","Gesundheitsschaden eingetreten")}
      ${checkField("death","Todesfall infolge des Ereignisses")}
      ${checkField("insuredActivity","Zusammenhang mit versicherter Tätigkeit")}
      ${checkField("directCommute","Unmittelbarer Weg zur oder von der Arbeit")}
      ${checkField("privateInterruption","Private Unterbrechung / eigenwirtschaftliche Tätigkeit")}
      ${checkField("massAccident","Mehrere Personen betroffen / Massenunfall")}
    </div></div>
    <div class="form-section"><h4>Meldepflicht und medizinische Weiterleitung</h4><div class="form-grid">
      <div class="field"><label>Volle Kalendertage arbeitsunfähig nach dem Unfalltag</label><input type="number" min="0" name="auFullCalendarDays" value="${esc(d.auFullCalendarDays)}" placeholder="Leer lassen, solange unbekannt"><div class="help">Meldepflicht nach § 193 SGB VII bei mehr als drei Tagen Arbeitsunfähigkeit oder Tod.</div></div>
      <div class="checkbox-grid full">${checkField("severeInjury","Schwerwiegender Gesundheitsschaden")}${checkField("auBeyondAccidentDay","Arbeitsunfähigkeit über den Unfalltag hinaus")}${checkField("treatmentLongerThanWeek","Behandlung voraussichtlich länger als eine Woche")}${checkField("remediesOrAids","Heil- oder Hilfsmittel erforderlich")}${checkField("recurrenceTreatment","Wiedererkrankung / erneute Behandlung einer Unfallfolge")}</div>
    </div></div>
    <div class="form-section"><h4>Sondermitteilungen</h4><div class="checkbox-grid">${checkField("hazardousSubstanceInvolved","Tätigkeit mit Gefahrstoffen betroffen")}${checkField("seriousHealthDamage","Ernste Gesundheitsschädigung durch Gefahrstoffereignis")}${checkField("annexEquipment","Arbeitsmittel nach BetrSichV Anhang 2 oder 3 betroffen")}${checkField("safetyComponentFailure","Bauteil oder sicherheitstechnische Einrichtung versagt")}</div></div>
    ${renderRuleResult(result)}`;
  }

  if (step === 3) {
    const inv = d.investigation || {};
    return `<div class="form-section"><h4>Unfallhergang</h4><p>Fakten, Feststellungen und noch offene Annahmen trennen.</p><div class="form-grid">
      ${textArea("plannedTask","Geplante Tätigkeit",inv.plannedTask)}${textArea("actualTask","Tatsächlicher Ablauf",inv.actualTask)}${textArea("deviations","Abweichungen / Störungen",inv.deviations)}${textArea("evidence","Beweismittel und gesicherte Fakten",inv.evidence)}
    </div></div>
    <div class="form-section"><h4>Systematische Untersuchung</h4><div class="form-grid">
      ${textArea("technical","Technik und Schutzeinrichtungen",inv.technical)}${textArea("organization","Organisation und Verantwortlichkeiten",inv.organization)}${textArea("environment","Arbeitsumgebung",inv.environment)}${textArea("qualification","Qualifikation und Unterweisung",inv.qualification)}${textArea("maintenance","Prüfung und Instandhaltung",inv.maintenance)}${textArea("interfaces","Schnittstellen / Fremdfirmen",inv.interfaces)}
    </div></div>`;
  }

  if (step === 4) return `<div class="form-section"><h4>Problemdefinition</h4><p>Eine konkrete, beobachtbare Ereignisfolge formulieren. Keine Schuldzuweisung.</p><div class="field"><label>Problem</label><textarea name="whyProblem" placeholder="Beispiel: Beim Beseitigen einer Störung griff die Person in den Gefahrenbereich und verletzte sich am Unterarm.">${esc(d.whyProblem)}</textarea></div></div>
    <div class="form-section"><h4>5-Why-Analyse</h4><p>Die Analyse darf früher enden oder über fünf Fragen hinaus ergänzt werden. Entscheidend ist eine belegbare und beeinflussbare Systemursache.</p><div class="why-list">${(d.whys || []).map((why,index)=>{
      const warning = validateWhyAnswer(why.answer);
      return `<div class="why-item"><div class="why-number">${index+1}</div><div class="field"><label>Warum ${index+1}?</label><textarea name="why_${index}" data-why-index="${index}" placeholder="${esc(suggestedFollowUp(why.category))}">${esc(why.answer)}</textarea>${warning ? `<div class="why-warning">${esc(warning)}</div>` : ""}</div><div class="field"><label>Ursachenkategorie</label><select name="why_category_${index}">${whyCategories.map(cat=>`<option value="${cat}" ${selected(why.category,cat)}>${cat === "MenschlicherFaktor" ? "Menschlicher Faktor" : cat}</option>`).join("")}</select></div></div>`;
    }).join("")}</div><button class="btn btn-secondary btn-sm" type="button" data-action="add-why">＋ Weitere Warum-Frage</button></div>`;

  if (step === 5) return `<div class="form-section"><div class="section-head"><div><h4>Maßnahmenplan</h4><p>Jede wesentliche Ursache muss einer wirksamen Maßnahme zugeordnet werden.</p></div><button class="btn btn-primary btn-sm" type="button" data-action="add-draft-action">＋ Maßnahme hinzufügen</button></div>${draftActionTable()}</div>
    <div class="banner banner-info"><div>STOP</div><div><strong>Maßnahmenhierarchie beachten</strong><p>Substitution und technische Lösungen sind vor organisatorischen und personenbezogenen Maßnahmen zu prüfen. Reine Unterweisung ist regelmäßig nicht ausreichend, wenn eine technische oder organisatorische Ursache besteht.</p></div></div>`;

  const result = classifyIncident(d);
  return `<div class="grid grid-2"><div class="card card-pad"><h3 style="margin-top:0">Abschlussprüfung</h3><div class="checkbox-grid">
    ${closureCheck("legalCompleted","Rechtliche Vorprüfung abgeschlossen")}${closureCheck("investigationCompleted","Unfallhergang geklärt")}${closureCheck("causesCompleted","Ursachenanalyse abgeschlossen")}${closureCheck("actionsAssigned","Maßnahmen, Verantwortliche und Termine festgelegt")}${closureCheck("riskAssessmentChecked","Gefährdungsbeurteilung geprüft / aktualisiert")}${closureCheck("instructionsChecked","Betriebsanweisung und Unterweisung geprüft")}${closureCheck("notificationsSent","Erforderliche Meldungen versandt")}${closureCheck("effectivenessPlanned","Wirksamkeitskontrolle terminiert")}
    </div><div class="field" style="margin-top:14px"><label>Status</label><select name="status"><option value="offen" ${selected(d.status,"offen")}>Offen</option><option value="in_bearbeitung" ${selected(d.status,"in_bearbeitung")}>In Bearbeitung</option><option value="abgeschlossen" ${selected(d.status,"abgeschlossen")}>Abgeschlossen</option></select></div><div class="field" style="margin-top:14px"><label>Abschlussvermerk / Freigabe</label><textarea name="closureNote">${esc(d.closure?.closureNote || "")}</textarea></div></div><div>${renderRuleResult(result)}<div class="card card-pad" style="margin-top:16px"><h3 style="margin-top:0">Maßnahmen</h3><p>${d.actions.length} Maßnahmen im Vorgang; ${d.actions.filter(a=>a.status === "erledigt").length} erledigt.</p></div></div></div>`;
}

function textArea(name, label, value) { return `<div class="field"><label>${label}</label><textarea name="inv_${name}">${esc(value || "")}</textarea></div>`; }
function closureCheck(name, title) { return `<label class="check-row"><input type="checkbox" name="closure_${name}" ${checked(state.draft.closure?.[name])}><span>${title}</span></label>`; }

function renderRuleResult(result) {
  const cls = result.reportable || result.immediateNotification ? "result-danger" : result.typeLevel === "success" ? "result-success" : result.typeLevel === "warning" ? "result-warning" : "result-info";
  return `<div class="rule-result ${cls}"><h4>${esc(result.preliminaryType)}</h4><div class="actions" style="margin-bottom:8px">${result.reportable ? `<span class="badge badge-danger">Meldepflicht wahrscheinlich</span>` : result.reportabilityOpen ? `<span class="badge badge-warning">Meldepflicht offen</span>` : `<span class="badge badge-neutral">Derzeit nicht meldepflichtig</span>`}${result.immediateNotification ? `<span class="badge badge-danger">Sofortmeldung prüfen</span>` : ""}${result.dDoctorRequired ? `<span class="badge badge-warning">D-Arzt prüfen</span>` : ""}</div>${result.displayDeadline ? `<p><strong>Orientierendes Fristdatum:</strong> ${fmtDate(result.displayDeadline)}${result.deadlineWeekendWarning ? " – Fristende fällt auf ein Wochenende; Berechnung vor Versand rechtlich prüfen." : ""}</p>` : ""}<ul>${result.obligations.map(item=>`<li>${esc(item)}</li>`).join("")}</ul><p class="help">${esc(result.legalDisclaimer)}</p></div>`;
}

function draftActionTable() {
  const items = state.draft.actions || [];
  if (!items.length) return `<div class="empty"><strong>Noch keine Maßnahme zugeordnet</strong>Mindestens Ursachenbezug, Verantwortlichkeit und Frist festlegen.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Maßnahme</th><th>Verantwortlich</th><th>Frist</th><th>Art</th><th></th></tr></thead><tbody>${items.map(a=>`<tr><td><div class="cell-title">${esc(a.title)}</div><div class="cell-sub">${esc(a.cause || "–")}</div></td><td>${esc(a.responsibleName || "–")}<div class="cell-sub">${esc(a.responsibleEmail)}</div></td><td>${fmtDate(a.dueDate)}</td><td>${esc(a.hierarchy || "–")}</td><td><button class="btn btn-secondary btn-sm" type="button" data-action="edit-draft-action" data-id="${a.id}">Bearbeiten</button></td></tr>`).join("")}</tbody></table></div>`;
}

function renderIncidentDetail() {
  const d = state.draft;
  const result = classifyIncident(d);
  const actions = state.actions.filter((a) => a.incidentId === d.id);
  return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><h3>${esc(d.caseNumber)}</h3><div class="cell-sub">${fmtDate(d.incidentDate)} · ${esc(d.department || "–")}</div></div><button class="close" data-action="close-modal">×</button></div><div class="modal-body">
    <div class="detail-grid"><div class="card card-pad"><h3 style="margin-top:0">Ereignis</h3><dl class="detail-list"><dt>Betroffene Person</dt><dd>${esc(d.affectedPerson || "–")}</dd><dt>Personengruppe</dt><dd>${esc(d.personType || "–")}</dd><dt>Beschreibung</dt><dd>${esc(d.eventDescription || "–")}</dd><dt>Tätigkeit</dt><dd>${esc(d.activity || "–")}</dd><dt>Folge</dt><dd>${esc(d.injuryDescription || "–")}</dd><dt>Status</dt><dd>${statusBadge(d.status)}</dd></dl></div><div>${renderRuleResult(result)}</div></div>
    <section class="section"><div class="section-head"><div><h3>5-Why-Analyse</h3><p>${esc(d.whyProblem || "Keine Problemdefinition")}</p></div></div><div class="card card-pad"><div class="timeline">${(d.whys||[]).filter(w=>w.answer).map((w,i)=>`<div class="timeline-item"><strong>Warum ${i+1}: ${esc(w.answer)}</strong><p>${esc(w.category)}</p></div>`).join("") || `<div class="empty">Keine Warum-Analyse dokumentiert.</div>`}</div></div></section>
    <section class="section"><div class="section-head"><div><h3>Maßnahmen</h3><p>${actions.length} zugeordnete Aufgaben</p></div></div><div class="card table-wrap">${actionTable(actions)}</div></section>
  </div><div class="modal-foot"><button class="btn btn-secondary" data-action="close-modal">Schließen</button><button class="btn btn-primary" data-action="edit-incident" data-id="${d.id}">Bearbeiten</button></div></div></div>`;
}

function baseAction(incidentId = null) {
  return { id: uid(), incidentId, title: "", cause: "", hierarchy: "Technisch", responsibleName: "", responsibleEmail: "", managerEmail: "", dueDate: todayIso(), extendedDueDate: "", extensionReason: "", escalationState: "none", status: "offen", completedAt: null, effectivenessDueDate: "", effectivenessStatus: "offen" };
}

function renderActionModal() {
  const a = state.actionDraft;
  return `<div class="modal-backdrop"><div class="modal modal-sm"><div class="modal-head"><h3>Maßnahme</h3><button class="close" data-action="close-action-modal">×</button></div><form id="action-form"><div class="modal-body"><div class="form-grid">
    <div class="field full"><label>Vorgang</label><select name="incidentId"><option value="">Allgemeine Maßnahme</option>${state.incidents.map(i=>`<option value="${i.id}" ${selected(a.incidentId,i.id)}>${esc(i.caseNumber)} – ${esc(i.department || "")}</option>`).join("")}</select></div>
    <div class="field full"><label class="required">Maßnahme</label><textarea name="title" required>${esc(a.title)}</textarea></div>
    <div class="field full"><label>Zugeordnete Ursache</label><textarea name="cause">${esc(a.cause)}</textarea></div>
    <div class="field"><label>Maßnahmenart</label><select name="hierarchy">${["Substitution","Technisch","Organisatorisch","Personenbezogen"].map(v=>`<option ${selected(a.hierarchy,v)}>${v}</option>`).join("")}</select></div>
    <div class="field"><label class="required">Frist</label><input type="date" name="dueDate" value="${esc(a.dueDate)}" required></div>
    <div class="field"><label class="required">Verantwortliche Person</label><input name="responsibleName" value="${esc(a.responsibleName)}" required></div>
    <div class="field"><label class="required">E-Mail der verantwortlichen Person</label><input type="email" name="responsibleEmail" value="${esc(a.responsibleEmail)}" required></div>
    <div class="field full"><label>E-Mail der Führungskraft</label><input type="email" name="managerEmail" value="${esc(a.managerEmail)}"><div class="help">Wird für die manuelle Eskalation und Fristverlängerungsanfrage benötigt.</div></div>
    <div class="field"><label>Wirksamkeitsprüfung am</label><input type="date" name="effectivenessDueDate" value="${esc(a.effectivenessDueDate || "")}"></div>
    <div class="field"><label>Status</label><select name="status"><option value="offen" ${selected(a.status,"offen")}>Offen</option><option value="erledigt" ${selected(a.status,"erledigt")}>Erledigt</option></select></div>
  </div></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-action="close-action-modal">Abbrechen</button><button class="btn btn-primary">Maßnahme speichern</button></div></form></div></div>`;
}

function renderExtensionModal() {
  const a = state.actionDraft;
  return `<div class="modal-backdrop"><div class="modal modal-sm"><div class="modal-head"><h3>Fristverlängerung beantragen</h3><button class="close" data-action="close-modal">×</button></div><form id="extension-form"><div class="modal-body"><div class="banner banner-warning"><div>!</div><div><strong>${esc(a.title)}</strong><p>Die ursprüngliche Frist war ${fmtDate(a.extendedDueDate || a.dueDate)}. Die Begründung wird protokolliert und an die Führungskraft gesendet, sofern der Online-Betrieb eingerichtet ist.</p></div></div><div class="field"><label class="required">Neue Frist</label><input type="date" name="newDate" min="${todayIso()}" required></div><div class="field" style="margin-top:13px"><label class="required">Begründung</label><textarea name="reason" required></textarea></div></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-action="close-modal">Abbrechen</button><button class="btn btn-warning">Fristverlängerung senden</button></div></form></div></div>`;
}

function renderEscalationModal() {
  const a = state.actionDraft;
  return `<div class="modal-backdrop"><div class="modal modal-sm"><div class="modal-head"><h3>Führungskraft informieren</h3><button class="close" data-action="close-modal">×</button></div><div class="modal-body"><div class="banner banner-danger"><div>!</div><div><strong>Überfällige Maßnahme eskalieren?</strong><p>„${esc(a.title)}“ ist seit ${fmtDate(a.extendedDueDate || a.dueDate)} fällig. Empfänger: ${esc(a.managerEmail || "keine Führungskraft hinterlegt")}.</p></div></div>${!a.managerEmail ? `<p style="color:var(--danger)">Vor der Eskalation muss eine E-Mail-Adresse der Führungskraft hinterlegt werden.</p>` : ""}</div><div class="modal-foot"><button class="btn btn-secondary" data-action="close-modal">Abbrechen</button><button class="btn btn-danger" data-action="confirm-escalation" ${!a.managerEmail ? "disabled" : ""}>Jetzt informieren</button></div></div></div>`;
}

function syncDraftFromForm() {
  const form = document.getElementById("incident-step-form");
  if (!form) return true;
  if (!form.reportValidity()) return false;
  const fd = new FormData(form);
  const d = state.draft;
  const set = (name) => { if (form.elements[name]) d[name] = fd.get(name) ?? ""; };

  if (state.step === 0) {
    ["incidentDate","incidentTime","knowledgeDate","department","affectedPerson","personType","eventDescription","activity","injuryDescription","witnesses","equipment","hazardousSubstance"].forEach(set);
    ["firstAid","doctor","hospital","propertyDamage"].forEach(name => d[name] = Boolean(form.elements[name]?.checked));
  } else if (state.step === 1) {
    const names = ["Erste Hilfe sichergestellt","Rettungsdienst verständigt","Gefahrenbereich abgesperrt","Arbeitsmittel außer Betrieb genommen","Energiequellen gesichert","Freisetzung gestoppt","Unfallstelle fotografisch dokumentiert","Beweismittel gesichert","Zeugen identifiziert","Führungskraft informiert","EHS / Sifa informiert","Werksleitung informiert"];
    d.immediateMeasures = names.filter((_,i)=>form.elements[`immediate_${i}`]?.checked);
    d.immediateNotes = fd.get("immediateNotes") || "";
  } else if (state.step === 2) {
    ["timeLimited","externalImpact","healthDamage","death","insuredActivity","directCommute","privateInterruption","massAccident","severeInjury","auBeyondAccidentDay","treatmentLongerThanWeek","remediesOrAids","recurrenceTreatment","hazardousSubstanceInvolved","seriousHealthDamage","annexEquipment","safetyComponentFailure"].forEach(name=>d[name]=Boolean(form.elements[name]?.checked));
    d.auFullCalendarDays = fd.get("auFullCalendarDays") ?? "";
  } else if (state.step === 3) {
    d.investigation = d.investigation || {};
    ["plannedTask","actualTask","deviations","evidence","technical","organization","environment","qualification","maintenance","interfaces"].forEach(name=>d.investigation[name]=fd.get(`inv_${name}`)||"");
  } else if (state.step === 4) {
    d.whyProblem = fd.get("whyProblem") || "";
    d.whys = d.whys.map((why,i)=>({ answer: fd.get(`why_${i}`)||"", category: fd.get(`why_category_${i}`)||"Organisation" }));
  } else if (state.step === 6) {
    d.closure = d.closure || {};
    ["legalCompleted","investigationCompleted","causesCompleted","actionsAssigned","riskAssessmentChecked","instructionsChecked","notificationsSent","effectivenessPlanned"].forEach(name=>d.closure[name]=Boolean(form.elements[`closure_${name}`]?.checked));
    d.status = fd.get("status") || "offen";
    d.closure.closureNote = fd.get("closureNote") || "";
  }
  return true;
}

async function saveIncident(includeActions = true) {
  if (!syncDraftFromForm()) return false;
  const actions = state.draft.actions || [];
  const payload = { ...state.draft };
  delete payload.actions;
  const saved = await store.saveIncident(payload);
  state.draft = { ...state.draft, ...saved, actions };
  if (includeActions) {
    for (const action of actions) await store.saveAction({ ...action, incidentId: saved.id });
  }
  await reload();
  return true;
}

function formToAction(form, base) {
  const fd = new FormData(form);
  return { ...base, incidentId: fd.get("incidentId") || null, title: fd.get("title"), cause: fd.get("cause"), hierarchy: fd.get("hierarchy"), dueDate: fd.get("dueDate"), responsibleName: fd.get("responsibleName"), responsibleEmail: fd.get("responsibleEmail"), managerEmail: fd.get("managerEmail"), effectivenessDueDate: fd.get("effectivenessDueDate"), status: fd.get("status"), completedAt: fd.get("status") === "erledigt" ? (base.completedAt || new Date().toISOString()) : null };
}

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action], [data-view]");
  if (!button) return;
  if (button.dataset.view) {
    state.view = button.dataset.view;
    state.sidebarOpen = false;
    render();
    return;
  }
  const action = button.dataset.action;
  try {
    if (action === "toggle-menu") { state.sidebarOpen = !state.sidebarOpen; render(); }
    if (action === "new-incident") await openIncident();
    if (action === "edit-incident") await openIncident(button.dataset.id, false);
    if (action === "view-incident") await openIncident(button.dataset.id, true);
    if (action === "close-modal") { state.modal = null; state.actionDraft = null; render(); }
    if (action === "close-action-modal") {
      state.modal = state.actionDraft?._draft ? "incident-wizard" : null;
      state.actionDraft = null;
      render();
    }
    if (action === "wizard-next") { if (syncDraftFromForm()) { state.step++; render(); } }
    if (action === "wizard-back") { syncDraftFromForm(); state.step = Math.max(0, state.step - 1); render(); }
    if (action === "goto-step") { if (syncDraftFromForm()) { state.step = Number(button.dataset.step); render(); } }
    if (action === "save-draft") { if (await saveIncident(false)) notify("Vorgang zwischengespeichert."); }
    if (action === "finish-incident") { if (await saveIncident(true)) { state.modal = null; notify("Vorgang und Maßnahmen wurden gespeichert."); render(); } }
    if (action === "add-why") { syncDraftFromForm(); state.draft.whys.push({ answer: "", category: "Organisation" }); render(); }
    if (action === "new-action") { state.actionDraft = baseAction(); state.modal = "action"; render(); }
    if (action === "edit-action") { state.actionDraft = structuredClone(state.actions.find(a=>a.id===button.dataset.id)); state.modal="action"; render(); }
    if (action === "add-draft-action") { syncDraftFromForm(); state.actionDraft = baseAction(state.draft.id); state.actionDraft._draft = true; state.modal = "action"; render(); }
    if (action === "edit-draft-action") { syncDraftFromForm(); state.actionDraft = structuredClone(state.draft.actions.find(a=>a.id===button.dataset.id)); state.actionDraft._draft = true; state.modal="action"; render(); }
    if (action === "complete-action") { await store.completeAction(button.dataset.id); notify("Maßnahme als erledigt markiert."); await reload(); }
    if (action === "extend-action") { state.actionDraft = structuredClone(state.actions.find(a=>a.id===button.dataset.id)); state.modal="extension"; render(); }
    if (action === "escalate-action") { state.actionDraft = structuredClone(state.actions.find(a=>a.id===button.dataset.id)); state.modal="confirm-escalation"; render(); }
    if (action === "confirm-escalation") { await store.escalateAction(state.actionDraft.id); state.modal=null; notify(store.mode === "supabase" ? "Führungskraft wurde informiert." : "Eskalation wurde lokal protokolliert. Im Demo-Betrieb wird keine E-Mail versandt."); await reload(); }
    if (action === "print") window.print();
    if (action === "export-data") {
      const blob = new Blob([store.exportLocalData()], { type: "application/json" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href=url; link.download=`unfallmanagement-sicherung-${todayIso()}.json`; link.click(); URL.revokeObjectURL(url);
    }
    if (action === "clear-data") { if (confirm("Alle lokalen Daten endgültig löschen?")) { store.clearLocalData(); await reload(); notify("Lokale Daten wurden gelöscht."); } }
    if (action === "logout") { await store.signOut(); render(); }
  } catch (error) {
    console.error(error); notify(error.message || "Aktion fehlgeschlagen.", "error");
  }
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (event.target.id === "login-form") {
      const fd = new FormData(event.target); const result = await store.signIn(fd.get("email"), fd.get("password"));
      if (!result.ok) document.getElementById("login-error").textContent = result.error;
      else await reload();
    }
    if (event.target.id === "action-form") {
      if (!event.target.reportValidity()) return;
      const action = formToAction(event.target, state.actionDraft);
      if (state.actionDraft._draft) {
        delete action._draft;
        const index = state.draft.actions.findIndex(a=>a.id===action.id);
        if (index>=0) state.draft.actions[index]=action; else state.draft.actions.push(action);
        state.modal="incident-wizard"; render(); notify("Maßnahme dem Vorgang zugeordnet.");
      } else {
        await store.saveAction(action); state.modal=null; notify("Maßnahme gespeichert."); await reload();
      }
    }
    if (event.target.id === "extension-form") {
      const fd = new FormData(event.target); await store.requestExtension(state.actionDraft.id, fd.get("newDate"), fd.get("reason")); state.modal=null; notify(store.mode === "supabase" ? "Fristverlängerung wurde protokolliert und versandt." : "Fristverlängerung wurde lokal protokolliert."); await reload();
    }
  } catch (error) { console.error(error); notify(error.message || "Speichern fehlgeschlagen.", "error"); }
});

app.addEventListener("change", async (event) => {
  if (event.target.id === "import-file" && event.target.files?.[0]) {
    try { store.importLocalData(await event.target.files[0].text()); await reload(); notify("Sicherung wurde importiert."); }
    catch (error) { notify(error.message || "Import fehlgeschlagen.", "error"); }
  }
  if (state.modal === "incident-wizard" && state.step === 2 && event.target.closest("#incident-step-form")) {
    syncDraftFromForm(); render();
  }
  if (state.modal === "incident-wizard" && state.step === 4 && event.target.name?.startsWith("why_category_")) {
    syncDraftFromForm(); render();
  }
});

await reload();
