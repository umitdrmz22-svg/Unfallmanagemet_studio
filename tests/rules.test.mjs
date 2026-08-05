import assert from "node:assert/strict";
import { classifyIncident, getActionState, validateWhyAnswer } from "../src/rules.js";

const reportable = classifyIncident({
  timeLimited: true,
  externalImpact: true,
  healthDamage: true,
  insuredActivity: true,
  auFullCalendarDays: 4,
  incidentDate: "2026-08-01",
  knowledgeDate: "2026-08-01"
});
assert.equal(reportable.preliminaryType, "Voraussichtlicher Arbeitsunfall");
assert.equal(reportable.reportable, true);
assert.equal(reportable.displayDeadline, "2026-08-04");

const nearMiss = classifyIncident({
  timeLimited: true,
  externalImpact: false,
  healthDamage: false,
  propertyDamage: false
});
assert.equal(nearMiss.preliminaryType, "Beinaheunfall");
assert.equal(nearMiss.reportable, false);

const commute = classifyIncident({
  timeLimited: true,
  externalImpact: true,
  healthDamage: true,
  directCommute: true,
  privateInterruption: false,
  auFullCalendarDays: 0
});
assert.equal(commute.preliminaryType, "Voraussichtlicher Wegeunfall");

const dDoctor = classifyIncident({
  timeLimited: true,
  externalImpact: true,
  healthDamage: true,
  insuredActivity: true,
  auFullCalendarDays: 1,
  auBeyondAccidentDay: true
});
assert.equal(dDoctor.dDoctorRequired, true);
assert.equal(dDoctor.reportable, false);

assert.equal(getActionState({ status: "erledigt", dueDate: "2020-01-01" }), "completed");
assert.equal(getActionState({ status: "offen", dueDate: "2020-01-01" }, new Date("2026-08-05T12:00:00")), "overdue");
assert.match(validateWhyAnswer("Der Mitarbeiter war unaufmerksam."), /Verhalten/);
assert.equal(validateWhyAnswer("Die Verriegelung war technisch unwirksam."), "");

console.log("Regeltests erfolgreich.");
