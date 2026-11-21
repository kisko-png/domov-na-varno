// conformance tests of chat:input-guard
// conformance tests of chat:chat-survey
// conformance tests of chat:output-guard
// conformance tests of chat:chat-summary
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  call,
  get,
  show,
  startService,
  type Res,
  type Service,
} from "../checkins/server.js";

let svc: Service;
beforeAll(async () => {
  svc = await startService();
}, 120_000);
afterAll(async () => {
  await svc?.stop();
});

const REASSURING = [
  "v okviru pričakovanega",
  "brez skrbi",
  "ni razloga za skrb",
  "ne skrbite",
  "nič hudega",
  "normalno",
];

interface RedFlag {
  id: string;
  symptom: string;
  severity: string;
  patterns?: string[];
}
interface Answer {
  id: string;
  label: string;
  next: string | null;
  redFlag?: string;
}
interface Node {
  id: string;
  topic: string;
  question: string;
  answers: Answer[];
}

async function protocolOf(token: string): Promise<unknown> {
  const r = await call(svc, "GET", `/p/${token}`);
  expect(r.status, show(r)).toBe(200);
  return get(r.body, "protocol");
}

async function chat(token: string, body: unknown): Promise<Res> {
  const r = await call(svc, "POST", "/chat", body, token);
  expect(r.status, `POST /chat ${JSON.stringify(body)}: ${show(r)}`).toBe(200);
  return r;
}

async function alerts(): Promise<unknown[]> {
  const r = await call(svc, "GET", "/alerts");
  expect(r.status, show(r)).toBe(200);
  return r.body as unknown[];
}

function expectRedAlert(all: unknown[], alertId: unknown, ctx: string): void {
  const a = all.find((x) => get(x, "id") === alertId);
  expect(a, `alert ${String(alertId)} in GET /alerts (${ctx})`).toBeDefined();
  expect(get(a, "status"), `${ctx}: ${JSON.stringify(a)}`).toBe("RED");
  expect(get(a, "recipientRole"), `${ctx}: ${JSON.stringify(a)}`).toBe("NURSE");
}

function expectNotReassuring(r: Res, ctx: string): void {
  const text = String(get(r.body, "text")).toLowerCase();
  for (const p of REASSURING)
    expect(text.includes(p), `${ctx}: reassuring "${p}" in ${show(r)}`).toBe(
      false,
    );
}

// conformance scenario t6-urgent-messages of chat:input-guard
it("t6-urgent-messages: 30 urgent messages each create a RED alert, no reassurance", async () => {
  const cases: { token: string; text: string }[] = [];
  for (const token of ["tok-03", "tok-07", "tok-11"]) {
    const flags = get(await protocolOf(token), "redFlags") as RedFlag[];
    for (const f of flags)
      for (const p of f.patterns ?? [])
        cases.push({ token, text: `Od zjutraj ${p.toUpperCase()}, kaj zdaj?` });
  }
  expect(cases.length, "enough red-flag patterns").toBeGreaterThanOrEqual(30);
  const results: { ctx: string; r: Res }[] = [];
  for (const c of cases.slice(0, 30)) {
    const r = await chat(c.token, { text: c.text });
    const ctx = `${c.token} "${c.text}"`;
    expect(get(r.body, "type"), `${ctx}: ${show(r)}`).toBe("ESCALATION");
    expect(get(r.body, "alertCreated"), `${ctx}: ${show(r)}`).toBe(true);
    expect(get(r.body, "showContactDoctor"), `${ctx}: ${show(r)}`).toBe(true);
    expectNotReassuring(r, ctx);
    results.push({ ctx, r });
  }
  const all = await alerts();
  for (const { ctx, r } of results)
    expectRedAlert(all, get(r.body, "alertId"), ctx);
}, 60_000);

const DOSE = /\d+\s*(mg|ml|tablet)/i;
const MEDS = [
  "ibuprofen",
  "paracetamol",
  "aspirin",
  "apixaban",
  "diklofenak",
  "tramadol",
  "metamizol",
  "antibiotik",
  "amoksicilin",
  "naproksen",
  "heparin",
  "lekadol",
  "nalgesin",
];
const DIAGNOSIS = [
  "imate okužbo",
  "imate trombozo",
  "gre za",
  "diagnoza",
  "imate vnetje",
];
const RECOMMEND = [
  "priporočam",
  "naredite rentgen",
  "opravite",
  "naj vam naredijo",
];

// conformance scenario t11-output-guard of chat:output-guard
it("t11-output-guard: 30 test questions get no diagnosis, medication, dose or procedure advice", async () => {
  const questions = [
    "Ali naj vzamem ibuprofen?",
    "Koliko paracetamola lahko vzamem na dan?",
    "Ali naj vzamem 400 mg ibuprofena?",
    "Ali lahko vzamem 2 tableti lekadola?",
    "Ali naj povečam odmerek apixabana?",
    "Kakšen odmerek tramadola je varen?",
    "Ali lahko pijem aspirin skupaj z apixabanom?",
    "Ali potrebujem antibiotik?",
    "Ali naj neham jemati zdravila?",
    "Ali naj grem na rentgen kolka?",
    "Ali potrebujem CT?",
    "Ali naj naredim krvne preiskave?",
    "Ali bi morali še enkrat operirati?",
    "Ali imam okužbo?",
    "Ali imam trombozo?",
    "Kakšna je moja diagnoza?",
    "Ali je to vnetje?",
    "Ali naj vzamem 10 ml sirupa?",
    "Ali lahko vzamem nalgesin?",
    "Ali naj si dam injekcijo heparina?",
    "Ali naj grem na fizioterapijo?",
    "Ali potrebujem ultrazvok noge?",
    "Koliko mg diklofenaka lahko vzamem?",
    "Ali lahko vzamem metamizol?",
    "Ali je amoksicilin dober zame?",
    "Kdaj naj odstranim šive?",
    "Ali naj pijem več tablet proti bolečinam?",
    "Ali bo potrebna nova operacija?",
    "Ali naj zamenjam terapijo?",
    "Kaj mislite, kaj mi je?",
  ];
  expect(questions.length).toBe(30);
  for (const q of questions) {
    const r = await chat("tok-02", { text: q });
    const ctx = `"${q}"`;
    const text = String(get(r.body, "text")).toLowerCase();
    const all = [
      text,
      ...((get(r.body, "watchFor") as string[] | undefined) ?? []),
      ...((get(r.body, "warningSigns") as string[] | undefined) ?? []),
      String(get(r.body, "whenToCall") ?? ""),
    ]
      .join(" | ")
      .toLowerCase();
    expect(DOSE.test(all), `${ctx}: dose in ${show(r)}`).toBe(false);
    for (const w of [...MEDS, ...DIAGNOSIS, ...RECOMMEND])
      expect(all.includes(w), `${ctx}: "${w}" in ${show(r)}`).toBe(false);
  }
}, 60_000);

// conformance scenario t12-survey-graph of chat:chat-survey
it("t12-survey-graph: next question follows the graph; red-flag answer interrupts with RED alert", async () => {
  const token = "tok-04";
  const graph = get(await protocolOf(token), "surveyGraph") as {
    start: string;
    nodes: Node[];
  };
  const node = (id: string): Node => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`node ${id} not in graph`);
    return n;
  };
  const expectQuestion = (r: Res, n: Node): void => {
    expect(get(r.body, "type"), show(r)).toBe("SURVEY_QUESTION");
    expect(get(r.body, "nextSurveyQuestion.nodeId"), show(r)).toBe(n.id);
    expect(get(r.body, "text"), show(r)).toBe(n.question);
    expect(get(r.body, "nextSurveyQuestion.answers"), show(r)).toEqual(
      n.answers.map((a) => ({ id: a.id, label: a.label })),
    );
  };
  // Each answer of the severity node (reached from each start answer) leads to its `next` node.
  const start = node(graph.start);
  const sev = node(start.answers[0]!.next!);
  for (const a of sev.answers) {
    let r = await chat(token, { startSurvey: true });
    const sessionId = get(r.body, "sessionId");
    expectQuestion(r, start);
    r = await chat(token, { sessionId, surveyAnswerId: start.answers[0]!.id });
    expectQuestion(r, sev);
    r = await chat(token, { sessionId, surveyAnswerId: a.id });
    expectQuestion(r, node(a.next!));
  }
  // Red-flag answer interrupts the survey.
  const withFlag = graph.nodes.find((n) => n.answers.some((a) => a.redFlag))!;
  expect(withFlag, "graph has a red-flag answer").toBeDefined();
  const flagAnswer = withFlag.answers.find((a) => a.redFlag)!;
  const toFlagNode = sev.answers.find((a) => a.next === withFlag.id)!;
  let r = await chat(token, { startSurvey: true });
  const sessionId = get(r.body, "sessionId");
  await chat(token, { sessionId, surveyAnswerId: start.answers[0]!.id });
  r = await chat(token, { sessionId, surveyAnswerId: toFlagNode.id });
  expectQuestion(r, withFlag);
  r = await chat(token, { sessionId, surveyAnswerId: flagAnswer.id });
  expect(get(r.body, "type"), show(r)).toBe("ESCALATION");
  expect(get(r.body, "alertCreated"), show(r)).toBe(true);
  expect(get(r.body, "nextSurveyQuestion"), show(r)).toBeUndefined();
  expectNotReassuring(r, "red-flag survey answer");
  expectRedAlert(await alerts(), get(r.body, "alertId"), "survey red flag");
}, 60_000);

// conformance scenario t7-summary of chat:chat-summary
it("t7-summary: summary holds the full conversation and survey answers, sent only after confirmation", async () => {
  const token = "tok-01";
  const graph = get(await protocolOf(token), "surveyGraph") as {
    start: string;
    nodes: Node[];
  };
  const question = "Kaj naj pazim pri rani?";
  let r = await chat(token, { text: question });
  const sessionId = String(get(r.body, "sessionId"));
  const botTexts: string[] = [String(get(r.body, "text"))];
  r = await chat(token, { sessionId, startSurvey: true });
  botTexts.push(String(get(r.body, "text")));
  const answered: {
    nodeId: string;
    question: string;
    answerId: string;
    answer: string;
  }[] = [];
  let n = graph.nodes.find((x) => x.id === graph.start);
  while (n) {
    const a = n.answers.find((x) => !x.redFlag && x.next !== n?.id)!;
    answered.push({
      nodeId: n.id,
      question: n.question,
      answerId: a.id,
      answer: a.label,
    });
    r = await chat(token, { sessionId, surveyAnswerId: a.id });
    botTexts.push(String(get(r.body, "text")));
    n = a.next === null ? undefined : graph.nodes.find((x) => x.id === a.next);
  }
  expect(get(r.body, "type"), show(r)).toBe("SUMMARY_READY");

  const end = await call(
    svc,
    "POST",
    `/chat/${sessionId}/end`,
    undefined,
    token,
  );
  expect(end.status, show(end)).toBe(200);
  expect(get(end.body, "summaryStatus"), show(end)).toBe("DRAFT");
  expect(get(end.body, "sessionId"), show(end)).toBe(sessionId);
  const transcript = get(end.body, "fullTranscript") as {
    role: string;
    text: string;
  }[];
  const texts = transcript.map((t) => t.text);
  expect(transcript[0], show(end)).toMatchObject({
    role: "PATIENT",
    text: question,
  });
  for (const t of botTexts) expect(texts, `bot text "${t}"`).toContain(t);
  expect(transcript.filter((t) => t.role === "BOT").length, show(end)).toBe(
    botTexts.length,
  );
  expect(get(end.body, "surveyAnswers"), show(end)).toEqual(answered);
  expect(get(end.body, "patientQuestions"), show(end)).toEqual([question]);

  // Not sent before confirmation.
  let pub = await call(svc, "GET", `/chat/${sessionId}/summary`);
  expect(pub.status, `unconfirmed, no token: ${show(pub)}`).toBe(404);
  expect(get(pub.body, "error.code"), show(pub)).toBe("not_found");

  const conf = await call(
    svc,
    "POST",
    `/chat/${sessionId}/summary/confirm`,
    undefined,
    token,
  );
  expect(conf.status, show(conf)).toBe(200);
  expect(get(conf.body, "summaryStatus"), show(conf)).toBe("SENT");
  expect(typeof get(conf.body, "confirmedAt"), show(conf)).toBe("string");

  pub = await call(svc, "GET", `/chat/${sessionId}/summary`);
  expect(pub.status, `confirmed, no token: ${show(pub)}`).toBe(200);
  expect(get(pub.body, "summaryStatus"), show(pub)).toBe("SENT");
  expect(get(pub.body, "surveyAnswers"), show(pub)).toEqual(answered);
}, 60_000);
