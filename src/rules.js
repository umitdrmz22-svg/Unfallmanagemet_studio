const LEGAL_SOURCES = [
  {
    id: "sgb7-8",
    label: "§ 8 SGB VII – Arbeitsunfall",
    url: "https://www.gesetze-im-internet.de/sgb_7/__8.html",
    note: "Definition des Unfalls und versicherte Wege."
  },
  {
    id: "sgb7-193",
    label: "§ 193 SGB VII – Unfallanzeige",
    url: "https://www.gesetze-im-internet.de/sgb_7/__193.html",
    note: "Anzeigepflicht, Drei-Tage-Frist, Beteiligung von Betriebsrat, Sifa und Betriebsarzt."
  },
  {
    id: "dguv-unfallanzeige",
    label: "DGUV – Unfallanzeige",
    url: "https://www.dguv.de/de/ihr_partner/unternehmen/unfallanzeige/index.jsp",
    note: "Praxishinweise zur Anzeige von Arbeits- und Wegeunfällen."
  },
  {
    id: "dguv-darzt",
    label: "DGUV – Durchgangsarzt nach Arbeitsunfall",
    url: "https://www.dguv.de/de/ihr_partner/arbeitnehmer/arbeitsunfall/index.jsp",
    note: "Kriterien für die Vorstellung bei einem Durchgangsarzt."
  },
  {
    id: "betrsichv-19",
    label: "§ 19 BetrSichV – Mitteilungspflichten",
    url: "https://www.gesetze-im-internet.de/betrsichv_2015/__19.html",
    note: "Unfälle und Schadensfälle an Arbeitsmitteln nach den Anhängen 2 und 3."
  },
  {
    id: "gefstoffv-18",
    label: "§ 18 GefStoffV – Unterrichtung der Behörde",
    url: "https://www.gesetze-im-internet.de/gefstoffv_2010/__18.html",
    note: "Unverzügliche Anzeige schwerer Gefahrstoffereignisse."
  },
  {
    id: "arbschg-5",
    label: "§ 5 ArbSchG – Gefährdungsbeurteilung",
    url: "https://www.gesetze-im-internet.de/arbschg/__5.html",
    note: "Ermittlung und Beurteilung der Gefährdungen."
  },
  {
    id: "arbschg-6",
    label: "§ 6 ArbSchG – Dokumentation",
    url: "https://www.gesetze-im-internet.de/arbschg/__6.html",
    note: "Dokumentation von Gefährdungsbeurteilung und meldepflichtigen Unfällen."
  }
];

export { LEGAL_SOURCES };

function addCalendarDays(dateValue, days) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekend(dateValue) {
  if (!dateValue) return false;
  const day = new Date(`${dateValue}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

function bool(value) {
  return value === true || value === "true" || value === "yes" || value === "ja" || value === 1 || value === "1";
}

function number(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyIncident(data) {
  const timeLimited = bool(data.timeLimited);
  const externalImpact = bool(data.externalImpact);
  const healthDamage = bool(data.healthDamage);
  const death = bool(data.death);
  const insuredActivity = bool(data.insuredActivity);
  const directCommute = bool(data.directCommute);
  const privateInterruption = bool(data.privateInterruption);
  const auDays = number(data.auFullCalendarDays);
  const auUnknown = data.auFullCalendarDays === "" || data.auFullCalendarDays == null;

  const accidentDefinitionMet = timeLimited && externalImpact && (healthDamage || death);
  let preliminaryType = "Einstufung unklar";
  let typeLevel = "warning";

  if (!healthDamage && !death) {
    preliminaryType = data.propertyDamage ? "Sachschadenereignis / Beinaheereignis" : "Beinaheunfall";
    typeLevel = "info";
  } else if (!accidentDefinitionMet) {
    preliminaryType = "Voraussichtlich kein Unfall im Sinne des § 8 SGB VII";
    typeLevel = "warning";
  } else if (directCommute) {
    preliminaryType = privateInterruption
      ? "Wegeunfall nicht eindeutig – private Unterbrechung prüfen"
      : "Voraussichtlicher Wegeunfall";
    typeLevel = privateInterruption ? "warning" : "success";
  } else if (insuredActivity) {
    preliminaryType = "Voraussichtlicher Arbeitsunfall";
    typeLevel = "success";
  } else {
    preliminaryType = "Unfallbegriff erfüllt, Zusammenhang mit versicherter Tätigkeit unklar";
    typeLevel = "warning";
  }

  const reportable = death || (auDays !== null && auDays > 3);
  const reportabilityOpen = !death && auUnknown && healthDamage;
  const severe = bool(data.severeInjury);
  const massAccident = bool(data.massAccident);
  const immediateNotification = death || severe || massAccident;
  const knowledgeDate = data.knowledgeDate || data.incidentDate || null;
  const displayDeadline = reportable ? addCalendarDays(knowledgeDate, 3) : null;

  const dDoctorRequired = bool(data.auBeyondAccidentDay)
    || bool(data.treatmentLongerThanWeek)
    || bool(data.remediesOrAids)
    || bool(data.recurrenceTreatment);

  const hazardousSubstanceNotice = bool(data.hazardousSubstanceInvolved)
    && bool(data.seriousHealthDamage);

  const equipmentNotice = bool(data.annexEquipment)
    && (death || severe || bool(data.safetyComponentFailure));

  const reasons = [];
  if (accidentDefinitionMet) reasons.push("Zeitlich begrenztes, von außen einwirkendes Ereignis mit Gesundheitsschaden oder Tod angegeben.");
  if (!timeLimited) reasons.push("Ein zeitlich begrenztes Ereignis wurde nicht bestätigt.");
  if (!externalImpact) reasons.push("Eine äußere Einwirkung auf den Körper wurde nicht bestätigt.");
  if (!healthDamage && !death) reasons.push("Kein Gesundheitsschaden und kein Todesfall angegeben.");
  if (directCommute) reasons.push("Das Ereignis ereignete sich auf einem Weg mit möglichem Zusammenhang zur versicherten Tätigkeit.");
  if (insuredActivity) reasons.push("Ein Zusammenhang mit einer versicherten Tätigkeit wurde angegeben.");

  const obligations = [];
  if (reportable) {
    obligations.push("Unfallanzeige an den Unfallversicherungsträger vorbereiten und fristgerecht übermitteln.");
    obligations.push("Betriebsrat/Personalrat einbeziehen; Sifa und Betriebsarzt über die Anzeige informieren.");
    obligations.push("Durchschrift an die zuständige Arbeitsschutzbehörde prüfen.");
  }
  if (reportabilityOpen) obligations.push("Arbeitsunfähigkeitsdauer nachverfolgen; Meldepflicht bleibt bis zur Klärung offen.");
  if (immediateNotification) obligations.push("Sofortige Kontaktaufnahme mit Unfallversicherungsträger und zuständiger Behörde prüfen.");
  if (dDoctorRequired) obligations.push("Vorstellung bei einem Durchgangsarzt veranlassen beziehungsweise medizinisch prüfen lassen.");
  if (hazardousSubstanceNotice) obligations.push("Unverzügliche Behördenanzeige nach § 18 GefStoffV prüfen.");
  if (equipmentNotice) obligations.push("Unverzügliche Mitteilung nach § 19 BetrSichV prüfen.");
  obligations.push("Gefährdungsbeurteilung, Betriebsanweisung, Unterweisung und übertragbare Risiken für andere Bereiche prüfen.");

  return {
    accidentDefinitionMet,
    preliminaryType,
    typeLevel,
    reportable,
    reportabilityOpen,
    immediateNotification,
    dDoctorRequired,
    hazardousSubstanceNotice,
    equipmentNotice,
    displayDeadline,
    deadlineWeekendWarning: isWeekend(displayDeadline),
    reasons,
    obligations,
    legalDisclaimer: "Regelbasierte betriebliche Vorprüfung. Die verbindliche Anerkennung eines Arbeits- oder Wegeunfalls erfolgt durch den zuständigen Unfallversicherungsträger."
  };
}

export function getActionState(action, today = new Date()) {
  if (action.status === "erledigt") return "completed";
  const due = action.extendedDueDate || action.dueDate;
  if (!due) return "open";
  const dueDate = new Date(`${due}T23:59:59`);
  const now = new Date(today);
  const diff = Math.ceil((dueDate - now) / 86400000);
  if (diff < 0) return "overdue";
  if (diff <= 7) return "dueSoon";
  return "open";
}

export function validateWhyAnswer(answer) {
  const text = String(answer || "").trim().toLowerCase();
  if (!text) return "";
  const weakPatterns = [
    "unaufmerksam", "nicht aufgepasst", "menschliches versagen", "eigenverschulden",
    "war schuld", "hat nicht nachgedacht", "fahrlässig", "vergessen"
  ];
  if (weakPatterns.some((pattern) => text.includes(pattern))) {
    return "Die Antwort beschreibt überwiegend ein Verhalten. Prüfen Sie zusätzlich, welche technischen, organisatorischen oder arbeitsbedingten Bedingungen dieses Verhalten ermöglicht haben.";
  }
  return "";
}

export function suggestedFollowUp(category) {
  const questions = {
    Technik: "Welche technische Barriere oder Schutzfunktion hätte das Ereignis verhindern müssen?",
    Organisation: "Welche Regelung, Zuständigkeit oder Kontrolle war nicht ausreichend wirksam?",
    Arbeitsverfahren: "Warum war das vorgesehene sichere Verfahren nicht anwendbar oder wurde abweichend gearbeitet?",
    Qualifikation: "Welche Einweisung, Übung oder Kompetenz fehlte konkret?",
    Kommunikation: "Welche Information erreichte die betroffene Person nicht rechtzeitig oder nicht verständlich?",
    Arbeitsumgebung: "Welche Umgebungsbedingung hat das Ereignis begünstigt?",
    Führung: "Welche Führungs- oder Kontrollentscheidung ließ die Abweichung bestehen?",
    Instandhaltung: "Warum wurde der technische Zustand nicht rechtzeitig erkannt oder behoben?",
    Prüfung: "Warum hat die vorgesehene Prüfung den Mangel nicht erkannt?",
    MenschlicherFaktor: "Warum konnte ein vorhersehbarer menschlicher Fehler unmittelbar zu einer Verletzung führen?"
  };
  return questions[category] || "Welche beeinflussbare Systemursache liegt hinter dieser Antwort?";
}

export function makeCaseNumber(existing = []) {
  const year = new Date().getFullYear();
  const prefix = `UM-${year}-`;
  const max = existing
    .map((item) => item.caseNumber || "")
    .filter((value) => value.startsWith(prefix))
    .map((value) => Number(value.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
