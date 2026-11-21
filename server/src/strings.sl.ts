/** User-facing Slovenian strings. */
export const SL = {
  procedures: {
    "hip-replacement": [
      "Totalna endoproteza kolka, desno",
      "Totalna endoproteza kolka, levo",
      "Zamenjava kolka (endoproteza kolka)",
      "Endoproteza kolka po zlomu",
    ],
    "cardiac-surgery": [
      "Aortokoronarni obvod (bypass)",
      "Zamenjava aortne zaklopke",
      "Operacija srca - obvod treh žil",
      "Popravilo mitralne zaklopke",
    ],
    "minor-abdominal-surgery": [
      "Laparoskopska apendektomija (slepič)",
      "Laparoskopska holecistektomija (žolčnik)",
      "Laparoskopska operacija dimeljske kile",
      "Laparoskopska operacija popkovne kile",
    ],
  },
  medications: {
    paracetamol: "paracetamol 1 g do trikrat na dan po potrebi",
    apixaban: "apixaban 2,5 mg dvakrat na dan",
    enoxaparin: "enoksaparin 40 mg enkrat na dan pod kožo",
    aspirin: "acetilsalicilna kislina 100 mg enkrat na dan",
    bisoprolol: "bisoprolol 2,5 mg enkrat na dan",
    ibuprofen: "ibuprofen 400 mg do trikrat na dan po potrebi",
  },
  warnings: {
    anticoagulant:
      "Jemljete zdravilo proti strjevanju krvi: bodite pozorni na krvavitve.",
    wound: "Rano imejte suho in čisto.",
    sternum: "Prsnica se celi: ne dvigujte bremen, težjih od 2 kg.",
  },
  restrictions: {
    hip: "Ne prekrižajte nog in ne sklanjajte se globoko.",
    crutches: "Prvih šest tednov hodite z berglami.",
    cardiacDriving: "Šest tednov ne vozite avtomobila.",
    lifting: "Dva tedna ne dvigujte težjih bremen.",
  },
  recommendations: {
    hip: "Vsak dan izvajajte vaje, ki ste se jih naučili s fizioterapevtom.",
    cardiac: "Vsak dan se sprehodite in postopno podaljšujte hojo.",
    abdominal: "Jejte lahko hrano in pijte dovolj tekočine.",
  },
  triage: {
    withinExpected: "Vrednosti so v mejah pričakovanega za ta dan.",
    redFlag: (label: string): string => `Opozorilni znak: ${label}.`,
    feverModerate: (t: number): string =>
      `Povišana telesna temperatura: ${String(t)} °C.`,
    feverHigh: (t: number): string =>
      `Visoka telesna temperatura: ${String(t)} °C.`,
    painAboveCurve: (pain: number): string =>
      `Bolečina (${pain}) je večja od pričakovane za ta dan.`,
    painAboveCurvePersisting: (pain: number): string =>
      `Bolečina (${pain}) je že drugi dan zapored večja od pričakovane.`,
    wellbeingBelowCurve: (w: number): string =>
      `Počutje (${w}) je slabše od pričakovanega za ta dan.`,
    wellbeingBelowCurvePersisting: (w: number): string =>
      `Počutje (${w}) je že drugi dan zapored slabše od pričakovanega.`,
    painJump: (from: number, to: number): string =>
      `Bolečina se je v 24 urah povečala z ${from} na ${to}.`,
    silence: (hours: number): string => `Dnevna prijava zamuja ${hours} ur.`,
    trendWorse: (what: "pain" | "wellbeing"): string =>
      what === "pain"
        ? "Bolečina se po navedbah bolnika slabša že drugič zapored."
        : "Počutje se po navedbah bolnika slabša že drugič zapored.",
    trendMuchWorse: (what: "pain" | "wellbeing"): string =>
      what === "pain"
        ? "Bolečina je po navedbah bolnika veliko hujša."
        : "Počutje je po navedbah bolnika veliko slabše.",
    weightGain: (kg: string): string =>
      `Telesna teža se je povečala za ${kg} kg.`,
  },
  patient: {
    callScript: (name: string, phone: string, reasons: string[]): string =>
      `Pokličite ${name} (${phone}): ${reasons.join("; ")}`,
    noCallNeeded: "Klic ni potreben.",
    demoNotice:
      "Vse klinične vrednosti so demonstracijske in niso klinično preverjene.",
    contactDoctor: (phone: string, emergency: boolean): string =>
      emergency
        ? `Kontaktirajte zdravnika: ${phone}. Ob nujnem stanju pokličite 112.`
        : `Kontaktirajte zdravnika: ${phone}.`,
    reassurance: "v okviru pričakovanega za ta dan",
    reminderFirst:
      "Pozdravljeni, čas je za današnji kratek vprašalnik o vašem počutju.",
    reminderFollowUp:
      "Pozdravljeni, še vedno čakamo na vaš današnji vprašalnik. Izpolnite ga, prosim.",
    reminderDraft: " Nadaljujte, kjer ste ostali.",
  },
  personal: {
    bleedingLabel: "Močna krvavitev",
    bleedingAction:
      "Jemljete zdravilo proti strjevanju krvi: ob močni krvavitvi pritisnite na mesto krvavitve in še danes pokličite zdravnika.",
  },
  chat: {
    refusal:
      "O zdravilih, odmerkih, posegih, preiskavah in zdravljenju vam ne morem svetovati. Vprašajte svojega zdravnika ali farmacevta; vaše vprašanje sem zabeležil za povzetek.",
    guidance: (title: string, day: number): string =>
      `${title} (${day}. dan po odpustu): na kaj bodite pozorni.`,
    notCovered:
      "Tega vaš protokol ne pokriva. Lahko odgovorite na nekaj kratkih vprašanj, da bomo vašo težavo bolje razumeli.",
    startSurveyEntry: "Začni vprašalnik",
    surveyAnswerUnknown: "Ta odgovor ne spada k zadnjemu vprašanju.",
    summaryReady:
      "Hvala za odgovore. Končajte pogovor, da si ogledate povzetek.",
    safeFallback:
      "Tega ne morem presoditi. Vprašanje bom zapisal za zdravnika.",
    /** Lowercase phrases that state a diagnosis. */
    diagnosisPhrases: [
      "diagnoza",
      "imate okužbo",
      "gre za okužbo",
      "imate trombozo",
      "gre za trombozo",
      "imate embolijo",
      "imate pljučnico",
      "imate infarkt",
      "gre za infarkt",
      "to je vnetje",
    ],
    /** Lowercase medication names the bot never names. */
    medicationNames: [
      "ibuprofen",
      "paracetamol",
      "aspirin",
      "antibiotik",
      "metamizol",
      "tramadol",
      "diklofenak",
      "naproksen",
    ],
    /** Lowercase phrases recommending a procedure or a test. */
    procedurePhrases: [
      "priporočam",
      "opravite preiskavo",
      "naredite preiskavo",
      "potrebujete operacijo",
      "rentgen",
      "ultrazvok",
      "krvne preiskave",
      "slikanje",
    ],
    /** Lowercase phrases that reassure. */
    reassuringPhrases: [
      "v okviru pričakovanega",
      "ni razloga za skrb",
      "vse je v redu",
      "ne skrbite",
      "normalno",
    ],
    exactlyOne:
      "Podajte natanko eno od polj text, surveyAnswerId, startSurvey.",
    sessionNotFound: "Pogovor ne obstaja.",
    noSummary: "Pogovor še nima povzetka. Najprej ga zaključite.",
    summaryNotFound: "Povzetek pogovora ne obstaja.",
    /** Lowercase word stems of questions about medication, doses, procedures, tests and therapies. */
    refusalStems: [
      "zdravil",
      "tablet",
      "odmer",
      "doz",
      "mg",
      "ibuprofen",
      "paracetamol",
      "aspirin",
      "antibiotik",
      "protibolečin",
      "vzamem",
      "vzeti",
      "jemati",
      "jemljem",
      "injekcij",
      "poseg",
      "operacij",
      "preiskav",
      "test",
      "izvid",
      "terapij",
      "zdravljenj",
      "fizioterapij",
      "medication",
      "dose",
    ],
  },
  errors: {
    noMatchingProtocol: (procedure: string): string =>
      `Za poseg »${procedure}« ni ustreznega protokola.`,
    unauthenticated: "Povezava ni veljavna.",
    patientNotFound: "Pacient s to povezavo ne obstaja.",
    notFound: "Ne obstaja.",
    routeNotFound: (method: string, url: string): string =>
      `Pot ${method} ${url} ne obstaja.`,
    validation: "Manjkajo obvezni podatki ali pa niso veljavni.",
    invalidField: "Neveljavna vrednost.",
    requiredField: (field: string): string => `Manjka obvezno polje ${field}.`,
    alreadySubmitted:
      "Današnji vprašalnik ste že oddali. Naslednjega lahko izpolnite, ko bo na vrsti.",
    unknownMeasurement: (id: string): string =>
      `Meritev ${id} ni v vašem protokolu.`,
    invalidType: "Vrednost je napačnega tipa.",
    tooSmall: (limit: unknown): string =>
      `Vrednost mora biti vsaj ${String(limit)}.`,
    tooLarge: (limit: unknown): string =>
      `Vrednost je lahko največ ${String(limit)}.`,
    tooLong: (limit: unknown): string =>
      `Besedilo je lahko dolgo največ ${String(limit)} znakov.`,
    notAllowedValue: "Vrednost ni med dovoljenimi.",
    unknownField: (field: string): string => `Polje ${field} ni dovoljeno.`,
    badRequest: "Zahteve ni mogoče prebrati.",
    methodNotAllowed: (method: string): string =>
      `Metoda ${method} tu ni dovoljena: prijave in ocene se ne spreminjajo.`,
    internal: "Prišlo je do nepričakovane napake.",
  },
} as const;
