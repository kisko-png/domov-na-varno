# Domov na varno – UI guide

What the frontend has to build against the API. The contract is `openapi.yaml`, and its field names and types are the source of truth. This guide says what each screen needs and how the server behaves behind it.

- **Base URL:** `http://localhost:3000` on this PC, or the public tunnel URL. Keep it in one setting.
- **Format:** JSON only, UTF-8. All user-facing text is Slovenian.
- **Staff calls:** no authentication.
- **Patient calls:** the header `X-Patient-Token: <token>`. The token comes from the magic link `/p/{token}`.
- **Time:** every moment is ISO 8601 with an offset. Show times in Europe/Ljubljana.
- **Demo clock:** the server runs on a simulated clock. Show its time from `GET /sim/now`; never take "today" from the browser.

---

## 1. Rules the UI must keep (from SYSTEM.md)

1. **Demo values.** Every screen that shows a clinical number (curves, tolerances, thresholds, comparisons, the brief) shows the `demoNotice` text: "Vse klinične vrednosti so demonstracijske in niso klinično preverjene." It comes in `PatientView`, `CheckInResult`, `Protocol` and `Brief`.
2. **Fictional patients only.**
3. **Patient side:**
   - Mobile first.
   - Large touch targets.
   - No login: the magic link is the only entry.
4. **Check-in:**
   - It has five steps.
   - The required steps (wellbeing, pain, symptoms) have no "skip" button.
   - The flow always goes to the end.
5. **Red flag in a check-in:**
   - The warning shows the moment it is ticked (see 3.3).
   - The check-in still continues to the end.
6. **Reassurance:**
   - The only reassuring sentence allowed is `reassuranceText`: "v okviru pričakovanega za ta dan".
   - Show it only when `reassuranceAllowed` is `true`.
   - Never write any other "all is well" text.
7. **History is append-only.**
   - There is no edit or delete button for a check-in or an assessment; the server answers 405.
   - A correction is a new check-in.
8. **Chat safety:** the bot never diagnoses and never advises on medication. The server enforces this. The UI shows the bot's `text` as given and must never add text of its own.
9. **Simulated delivery:** reminders and escalations are simulated. Show them as UI indicators and logs; no SMS is sent.

---

## 2. Statuses, rules and where they come from

**Statuses:** `GREEN` < `YELLOW` < `RED`. A patient's status is the status of their latest assessment, or `GREEN` when they have none.

**An assessment** has these fields:
- `patientId`, always present.
- `checkInId`, absent for a silence assessment.
- `status`.
- `reasons[]`: at least one, each `{ text, ruleId }`.
- `createdAt`.

Show the `text` of every reason, and optionally a badge per rule:

| ruleId | Meaning | Result |
|---|---|---|
| R0 | Nothing triggered | GREEN, one reason: within expectations |
| R1 | A red-flag symptom was ticked, or named in chat | RED, plus a nurse alert |
| R2 | Temperature 38.0–38.49 °C | YELLOW |
| R2 | Temperature ≥ 38.5 °C | RED |
| R3 | Pain above expected + tolerance | YELLOW |
| R3 | Pain above expected + 2 × tolerance | RED |
| R3 | Same pain deviation on the previous day too | RED |
| R3 | Wellbeing 2 or more below expected | YELLOW; RED if the previous day too |
| R4 | Pain rose by 3 or more within 24 h | YELLOW |
| R5 | Silence: a due check-in is late beyond the risk tier's threshold | YELLOW or RED |

**Alerts:**
- Only a `RED` assessment creates an alert, for the `NURSE`.
- YELLOW appears only on the dashboard and in the brief.

**Risk tiers** (demo values). `GET /protocols` gives each tier's `checkInSchedule`, `durationDays`, `painTolerance` and `silence` thresholds.

| Tier | Check-ins | Duration | Pain tolerance | Silence YELLOW / RED |
|---|---|---|---|---|
| HIGH (cardiac) | 2 per day on days 1–3, then 1 per day | 30 days | 1 | 12 h / 24 h |
| MEDIUM (hip) | 1 per day | 14 days | 2 | 24 h / 48 h |
| LOW (abdominal) | 1 per day on days 1–7, then days 8, 10, 12 | 14 days | 3 | 48 h / 72 h |

- The first check-in of a day is due at the patient's `preferredCheckInTime`. A second one is due 12 hours later.
- `dayAfterDischarge` is 0 on the discharge day.

**Silence and escalation are worked out on reads.** Every `GET /patients`, `GET /alerts` and `GET /brief` first records new silence assessments, then escalates. Nothing runs on a timer. **Staff screens should poll**, about every 30–60 s, to see new RED patients and escalations.

---

## 3. Patient side (magic link)

Every patient call except `GET /p/{token}` needs the header `X-Patient-Token`. A missing or unknown token answers `401 unauthenticated`: show "Povezava ni veljavna."

Demo tokens: `tok-01` to `tok-12`.

| Token | Patient | Protocol | Situation |
|---|---|---|---|
| tok-01 | Marija Novak | hip | slowly getting worse |
| tok-02 | Janez Horvat | hip | on apixaban, which adds a bleeding red flag |
| tok-05 | Ivan Kovačič | cardiac | stopped checking in after day 4: RED for silence |
| tok-09 | Matej Golob | abdominal | stable |

### 3.1 Landing – `GET /p/{token}`

It returns a `PatientView`:

| Field | Show |
|---|---|
| `patientName` | The greeting |
| `dayAfterDischarge` | "Dan N po odpustu" |
| `doctorPhone` | A call button, always visible |
| `patientInstructions[]` | The instructions list: warnings, then restrictions, then recommendations |
| `currentSlot { day, index, dueAt }` | The check-in this is for. `index` 2 is the second check-in of a day; HIGH tier, days 1–3 only |
| `draft` (optional) | An unfinished check-in: open the flow pre-filled at the first empty step |
| `pendingReminder` (optional) | A banner: "Opomnik: izpolnite današnji vprašalnik" (its `text`) |
| `protocol` | Holds `questions` (the symptom checklist), `expectedCurve`, `guidanceTopics` and `name` |
| `demoNotice` | Always shown |

Unknown token: `404 not_found`.

Actions: **Start or continue the check-in**, **Chat with the assistant**, **Call the doctor**.

### 3.2 The check-in flow (5 steps)

| Step | Field | Control | Required |
|---|---|---|---|
| 1 | `wellbeing` | 1–5 (big buttons or smileys) | yes |
| 2 | `pain` | 0–10 scale | yes |
| 3 | `symptoms` | checklist of `protocol.questions[]` (`id`, `label`); none ticked is allowed as `[]`, with a "Nič od tega" button | yes |
| 4 | `temperatureC` (34–43, one decimal) and `photoRef` | number input; photo picker | no |
| 5 | `note` (≤ 2000 characters) | text area | no |

- **Who fills it in:** `filledBy` is `PATIENT` (the default) or `CAREGIVER`. Offer a toggle when the patient has a `caregiverName`.
- **Saving a draft:** after every step, call `POST /checkins` with `{ final: false, ...fields so far }`.
  - It answers `200` with the draft.
  - A later draft replaces the earlier one.
  - The draft is for the current slot, so the reminder and the landing page bring the patient back to it.
- **Submitting:** call `POST /checkins` with `{ final: true, wellbeing, pain, symptoms, ... }`.
  - Disable the submit button until the three required fields are set.
  - If the server still answers `422 validation_error`, `error.details[]` lists the missing fields as `{ field, message }`. Return to that step.
- **Photo:** there is no upload endpoint. `photoRef` is only a string, such as a file name or reference.

### 3.3 Red-flag warning while ticking symptoms – `POST /checkins/preview`

Send `{ symptoms: [...ticked so far] }` each time a symptom is ticked or unticked. It answers a `RedFlagWarning`:

| Field | UI |
|---|---|
| `showContactDoctor` | Show a prominent banner at once with `message`: "Kontaktirajte zdravnika: <phone>" |
| `showEmergency112` | Also show a big red "Pokličite 112" button (EMERGENCY flag) |
| `doctorPhone` | A tap-to-call link |
| `redFlags[]` | Which flags fired (`action` text per flag) |

The flow then **continues to the end**. Do not block it.

### 3.4 Result after submission – `CheckInResult` (`201`)

| Field | UI |
|---|---|
| `checkIn` | The stored answers (read only) |
| `assessment.status` | A colour badge |
| `assessment.reasons[]` | The reason texts |
| `comparison.pain { actual, expected, tolerance }` | A chart or bar: actual against expected, with a band from expected to expected + tolerance |
| `comparison.wellbeing { actual, expected, tolerance }` | The same; a value 2 or more below expected is out of range |
| `protocol.expectedCurve` (from the landing page) | Optional: the whole expected curve, with today marked |
| `showContactDoctor`, `showEmergency112`, `doctorPhone` | The same banner as 3.3 |
| `alertCreated` | "Medicinska sestra je obveščena." when `true` |
| `reassuranceAllowed` and `reassuranceText` | Show "v okviru pričakovanega za ta dan" only when `true` |
| `demoNotice` | Always shown |

Submitting deletes the slot's draft on the server.

### 3.5 Chat – `POST /chat`

The body has an optional `sessionId` and **exactly one** of:
- `text`: a free question, ≤ 2000 characters;
- `startSurvey: true`: start the guided survey;
- `surveyAnswerId`: an answer id of the question last asked.

Omit `sessionId` to start a session. Store the `sessionId` from the reply and send it on every later message. An unknown session, or another patient's, answers `404`.

Every `ChatReply` has `sessionId`, `type`, `text`, `watchFor[]`, `alertCreated`, `showContactDoctor`, `showEmergency112` and `doctorPhone`, plus optional fields per type:

| `type` | Meaning | UI |
|---|---|---|
| `GUIDANCE` | A protocol topic matched | `text` (the title), then `watchFor[]` ("Opazujte"), `warningSigns[]` ("Opozorilni znaki") and `whenToCall` ("Kdaj pokličite"), as sections |
| `SURVEY_QUESTION` | The next survey question | `nextSurveyQuestion.question`, with `answers[]` as buttons that send `surveyAnswerId` |
| `ESCALATION` | A red flag in the message or a survey answer | Contact-doctor and 112 banner (`showEmergency112`), "Medicinska sestra je obveščena" (`alertCreated`, `alertId`), no advice |
| `NOT_COVERED` | The protocol doesn't cover it | `text`, plus a "Začni vprašalnik" button that sends `startSurvey: true` |
| `REFUSAL` | A medication, dose, procedure or test question, or a reply the safety guard replaced | `text` (refers to the doctor or pharmacist), plus the doctor's phone |
| `SUMMARY_READY` | The survey is finished | `text`, plus a "Poglej povzetek" button that calls `POST /chat/{id}/end` |

- **Survey:** it follows the protocol's graph (onset, severity, accompanying, modifiers), and the next question depends on the answer. A red-flag answer returns `ESCALATION` and ends the survey. An answer id that isn't among the last question's answers gives `422`.
- **Matching:**
  - Red flags in free text are matched by phrases ("težko diham", "ne morem dihati" and similar).
  - Topics are matched by keywords; for hip, for example "rana", "boli", "oteklina" and "hoja".
- **End anytime:** offer an "Končaj pogovor" button.

### 3.6 Chat summary: review and confirm

1. `POST /chat/{id}/end` returns a `ChatSummary` with `summaryStatus` `DRAFT`. Show:
   - `patientQuestions[]`;
   - `surveyAnswers[]` (question, then answer);
   - `botGuidanceGiven[]`;
   - optionally `fullTranscript[]` (`role` PATIENT or BOT, `text`, `at`).
2. Show the button **"Potrdi in pošlji zdravniku"**. It calls `POST /chat/{id}/summary/confirm` and returns the summary with `summaryStatus` `SENT` and `confirmedAt`.
   - Confirming before ending answers `409 conflict`.
3. Only after this confirmation can staff see the summary.

---

## 4. Staff side (no login)

### 4.1 Dashboard – `GET /patients`

One `PatientSummary` per patient, **already sorted** RED, then YELLOW, then GREEN, most recent assessment first. Keep the server's order.

| Field | Column |
|---|---|
| `status` | A colour badge |
| `patient.name`, `patient.phone` | The name, and a call link |
| `protocolName`, `riskTier` | The protocol and its tier |
| `dayAfterDischarge` | The day |
| `latestAssessment.reasons[]` | The main reason(s) |
| `latestAssessment.createdAt`, `lastCheckInAt` | Last assessment; last check-in (missing means none yet) |
| `openAlerts` | An unacknowledged alert count badge |

Poll it. Clicking a row opens the patient detail.

### 4.2 Patient detail – `GET /patients/{id}`

It returns a `PatientDetail`: everything in the `PatientSummary`, plus:
- `report`: procedure, `procedureDate`, `medications[]`, `specialWarnings[]`, `restrictions[]`, `recommendations`, `doctorContactPhone`.
- `protocol`: the patient's **personalised** protocol. An anticoagulant adds the red flag `anticoagulant-bleeding` and, where missing, the symptom "Močna krvavitev".
- `patientInstructions[]`.
- `sentSummaries[] { sessionId, confirmedAt }`: open each with `GET /chat/{sessionId}/summary` (no token).
- `patient.accessToken`: show or copy the magic link, `<UI URL>/p/<token>`.

Plus:
- **Timeline and charts:** `GET /patients/{id}/checkins` gives every check-in, oldest first. Chart pain and wellbeing against `protocol.expectedCurve`, with the tolerance band and temperature.
- **Assessments:** `GET /assessments?patientId={id}`, oldest first. Silence assessments have no `checkInId`.
- **Export:** there is no export endpoint. Build CSV or print from those two lists in the browser.

Unknown id: `404`.

### 4.3 Alerts inbox – `GET /alerts` (`?role=NURSE` or `?role=COORDINATOR`)

Each `AlertView` has `id`, `assessmentId`, `recipientRole`, `createdAt`, `acknowledgedAt?`, `escalatedAt?`, `patientId`, `patientName`, `status` and `reasons[]`. Newest first.

- **Tabs:** "Sestra" and "Koordinator".
- **Acknowledge:** the button "Potrdi prejem" calls `POST /alerts/{id}/ack`. Acknowledging again keeps the first time.
- **Escalation:** a NURSE alert unacknowledged for 15 minutes gets `escalatedAt`, and a separate COORDINATOR alert is created. Show "Eskalirano koordinatorju" on the nurse alert.
- **Highlight:** alerts without `acknowledgedAt`.
- **Poll it.**

### 4.4 Morning brief – `GET /brief`

It returns `forDay` (yesterday by the demo clock), `generatedAt`, `demoNotice`, and `entries[]` (RED first). Each entry has `patientName`, `status`, `reasons[]` and `callScript`.

- For RED and YELLOW, the call script is "Pokličite <name> (<phone>): reasons…".
- For GREEN, it is "Klic ni potreben."

It's one printable page.

### 4.5 New discharge report – `POST /reports`

A form for `ReportCreate`:

| Field | Required | Notes |
|---|---|---|
| `patient.name` | yes | |
| `patient.phone` | yes | |
| `patient.dischargeDate` | yes | YYYY-MM-DD |
| `patient.preferredCheckInTime` | yes | HH:MM, 00:00–23:59 |
| `patient.caregiverName` | no | |
| `procedure` | yes | Free text; it selects the protocol |
| `procedureDate` | yes | YYYY-MM-DD |
| `medications[]` | yes | Can be empty; use a repeatable input |
| `specialWarnings[]` | yes | Can be empty; use a repeatable input |
| `restrictions[]` | yes | Can be empty; use a repeatable input |
| `recommendations` | yes | |
| `doctorContactPhone` | yes | |

- **Protocol selection:** the first protocol, in list order (hip, cardiac, abdominal), whose keyword appears in `procedure`. Keywords are words such as "kolk", "endoproteza kolka", "hip replacement", "srca" and the like; see `procedureKeywords` in `GET /protocols`.
- **Success:** `201` with the new `PatientDetail`. Show the magic link (`patient.accessToken`) to hand to the patient.
- **No matching protocol:** `422 no_matching_protocol`. Show "Za ta poseg ni protokola" and keep the form.
- **Invalid input:** `422 validation_error`, with `details[]` per field.

### 4.6 Protocols – `GET /protocols`

A read-only reference of the three base protocols:
- name, tier, schedule, duration, tolerance, silence thresholds;
- the expected curves as charts;
- red flags with their severity;
- symptoms, guidance topics;
- `sources[]` (title and link), with the demo notice.

### 4.7 Reminder log – `GET /reminders` (`?patientId=`)

A simulated SMS log, newest first. Each entry: `kind` (`FIRST` at the due time, `FOLLOW_UP` 3 hours later), `sentAt`, `slotDay`, `slotIndex`, `text`, and `draftPending` (the patient has an unfinished draft). Show it as a log and as a badge on the patient.

### 4.8 Demo controls (sim)

- `GET /sim/now` returns `{ now, offsetMinutes }`. Show it as a "Demo čas" clock in the header.
- `POST /sim/advance { minutes }` takes minutes ≥ 1. Offer buttons: +15 min (shows escalation), +3 h (reminder follow-up), +1 day (1440).
- The clock only moves forward, and there is no reset.
- After advancing, refetch the dashboard, alerts and brief: silence and escalation happen on that read.

---

## 5. Errors

Every error is `{ "error": { "code", "message", "details"? } }`. Branch on `code`; you may show `message` (Slovenian).

| HTTP | code | When |
|---|---|---|
| 401 | `unauthenticated` | A patient call without a token, or with an unknown one |
| 404 | `not_found` | Unknown patient, alert, session or token; staff opening a summary that isn't SENT |
| 405 | `method_not_allowed` | Any PUT, PATCH or DELETE on check-ins or assessments |
| 409 | `conflict` | Confirming a summary before ending the chat |
| 422 | `validation_error` | Missing or invalid fields; `details[] { field, message }` |
| 422 | `no_matching_protocol` | `POST /reports` with an unknown procedure |
| 500 | `internal_error` | A server fault: show a generic error |

---

## 6. Not in the API (do not build against it)

- Staff login or roles. The NURSE/COORDINATOR choice is only a filter.
- Photo upload. Only `photoRef` text is stored.
- An export endpoint. Export in the browser.
- Appointments and transport (a SYSTEM.md stretch goal).
- Resetting the demo clock or data.
- Real SMS, or push or websockets. Poll instead.
- An LLM-polished brief. It's template-based only.
