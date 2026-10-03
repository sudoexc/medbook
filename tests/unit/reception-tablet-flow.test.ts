/**
 * The reception tablet's step state machine (src/lib/reception-tablet/flow.ts):
 * one screen per step, a doctor's tile skips the doctor step, «Назад» walks
 * back, nothing reopens a step once the ticket or booking exists, and a
 * server answer lands only in the flow that sent it.
 */
import { describe, expect, it } from "vitest";

import {
  canOpenStep,
  firstOpenStep,
  flowReducer,
  headerBack,
  HOME,
  stepNumber,
  stepsFor,
  type ActiveFlow,
  type ChosenPatient,
  type FlowAction,
  type FlowResult,
  type FlowState,
  type UnsureBooking,
} from "@/lib/reception-tablet/flow";

const TODAY = "2026-10-03";
const EXISTING: ChosenPatient = {
  kind: "existing",
  id: "p1",
  fullName: "Юсупова Лола",
  phone: "+998901234567",
  birthYear: 1985,
};
const NEW: ChosenPatient = {
  kind: "new",
  fullName: "Каримов Тимур 2012",
  phone: "+998901234567",
  birthYear: 2012,
  gender: null,
};

const TICKET: FlowResult = {
  kind: "ticket",
  appointmentId: "a1",
  ticketNumber: "A-012",
  ticketCode: "K7Q2M",
  duplicate: false,
  patientName: "Юсупова Лола",
  doctorId: "d1",
  cabinet: "101",
  placeHint: 2,
};
const UNSURE: UnsureBooking = { patientId: "p1", doctorId: "d1", day: TODAY, time: "10:00" };

function run(...actions: FlowAction[]): FlowState {
  return actions.reduce(flowReducer, HOME);
}

function active(s: FlowState): ActiveFlow {
  if (s.screen !== "flow") throw new Error("not in a flow");
  return s;
}

describe("steps", () => {
  it("queue: patient, doctor, confirm; booking adds the time", () => {
    expect(stepsFor("queue")).toEqual(["patient", "doctor", "confirm"]);
    expect(stepsFor("book")).toEqual(["patient", "doctor", "time", "confirm"]);
    expect(stepNumber("queue", "confirm")).toBe(3);
    expect(stepNumber("book", "time")).toBe(3);
  });
});

describe("«В очередь»", () => {
  it("from the big button: patient, then doctor, then confirm", () => {
    let s = run({ type: "start", mode: "queue", today: TODAY });
    expect(active(s)).toMatchObject({ step: "patient", doctorId: null, day: null });
    s = flowReducer(s, { type: "pickPatient", patient: EXISTING });
    expect(active(s).step).toBe("doctor");
    s = flowReducer(s, { type: "pickDoctor", doctorId: "d1" });
    expect(active(s)).toMatchObject({ step: "confirm", doctorId: "d1" });
  });

  it("from a doctor's tile: the doctor is carried and his step is skipped", () => {
    const s = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
    );
    expect(active(s)).toMatchObject({ step: "confirm", doctorId: "d1" });
  });

  it("«Назад» from confirm opens the doctor step for a change of mind", () => {
    const s = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
      { type: "back" },
    );
    expect(active(s)).toMatchObject({ step: "doctor", doctorId: "d1" });
  });

  it("«Назад» on the first step leaves to home", () => {
    expect(run({ type: "start", mode: "queue", today: TODAY }, { type: "back" })).toEqual(HOME);
  });

  it("another doctor drops the service picked for the first one", () => {
    const s = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
      { type: "pickService", serviceId: "s1" },
      { type: "goTo", step: "doctor" },
      { type: "pickDoctor", doctorId: "d2" },
    );
    expect(active(s)).toMatchObject({ step: "confirm", doctorId: "d2", serviceId: null });
  });

  it("the same doctor again keeps the service", () => {
    const s = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
      { type: "pickService", serviceId: "s1" },
      { type: "pickDoctor", doctorId: "d1" },
    );
    expect(active(s).serviceId).toBe("s1");
  });
});

describe("«Записать на время»", () => {
  it("starts on today and asks for the time after the doctor", () => {
    let s = run({ type: "start", mode: "book", today: TODAY });
    expect(active(s)).toMatchObject({ step: "patient", day: TODAY, time: null });
    s = flowReducer(s, { type: "pickPatient", patient: NEW });
    s = flowReducer(s, { type: "pickDoctor", doctorId: "d1" });
    expect(active(s).step).toBe("time");
    s = flowReducer(s, { type: "pickDay", day: "2026-10-05" });
    expect(active(s)).toMatchObject({ step: "time", day: "2026-10-05", time: null });
    s = flowReducer(s, { type: "pickTime", time: "14:20" });
    expect(active(s)).toMatchObject({ step: "confirm", time: "14:20" });
  });

  it("another day or another service drops the picked slot", () => {
    const base = run(
      { type: "start", mode: "book", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
      { type: "pickTime", time: "10:00" },
    );
    expect(active(base)).toMatchObject({ step: "confirm", time: "10:00" });
    // The confirm screen cannot stand without a slot: back to the time step.
    expect(active(flowReducer(base, { type: "pickDay", day: "2026-10-04" }))).toMatchObject({
      step: "time",
      time: null,
    });
    expect(active(flowReducer(base, { type: "pickDay", day: TODAY })).time).toBe("10:00");
    expect(active(flowReducer(base, { type: "pickService", serviceId: "s1" }))).toMatchObject({
      step: "time",
      time: null,
    });
  });

  it("a time cannot be picked in the queue flow", () => {
    const s = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
    );
    expect(flowReducer(s, { type: "pickTime", time: "10:00" })).toBe(s);
  });
});

describe("guards", () => {
  it("a step opens only once the steps before it are complete", () => {
    const s = active(run({ type: "start", mode: "book", today: TODAY }));
    expect(canOpenStep(s, "patient")).toBe(true);
    expect(canOpenStep(s, "doctor")).toBe(false);
    expect(canOpenStep(s, "confirm")).toBe(false);
    expect(flowReducer(s, { type: "goTo", step: "confirm" })).toBe(s);
    expect(firstOpenStep(s)).toBe("patient");
  });

  it("a new patient pick clears a stale «same person?» question and a created card", () => {
    const s = run(
      { type: "start", mode: "book", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: NEW },
      { type: "pickTime", time: "10:00" },
      {
        type: "ownerQuestion",
        owner: { id: "p9", fullName: "Каримова Д.", birthYear: 1985 },
        flowId: 0,
      },
      { type: "patientCreated", patientId: "p_new", flowId: 0 },
    );
    expect(active(s)).toMatchObject({ createdPatientId: "p_new" });
    expect(active(s).owner?.id).toBe("p9");
    const again = active(flowReducer(s, { type: "pickPatient", patient: EXISTING }));
    expect(again.owner).toBeNull();
    expect(again.createdPatientId).toBeNull();
  });

  it("leaving the confirm step closes an open question", () => {
    const s = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: NEW },
      {
        type: "ownerQuestion",
        owner: { id: "p9", fullName: "Каримова Д.", birthYear: null },
        flowId: 0,
      },
      { type: "back" },
    );
    expect(active(s).owner).toBeNull();
  });

  it("after the ticket only «Следующий пациент» leaves: no step reopens", () => {
    const done = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
      { type: "done", result: TICKET, flowId: 0 },
    );
    expect(active(done).step).toBe("done");
    for (const a of [
      { type: "back" },
      { type: "goTo", step: "confirm" },
      { type: "pickDoctor", doctorId: "d2" },
      { type: "pickPatient", patient: NEW },
    ] as FlowAction[]) {
      expect(flowReducer(done, a)).toBe(done);
    }
    expect(flowReducer(done, { type: "home" })).toEqual(HOME);
  });

  it("actions that need a flow do nothing at home", () => {
    expect(flowReducer(HOME, { type: "pickDoctor", doctorId: "d1" })).toBe(HOME);
    expect(flowReducer(HOME, { type: "back" })).toBe(HOME);
  });

  it("starting again always begins clean", () => {
    const s = run(
      { type: "start", mode: "book", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
      { type: "start", mode: "queue", today: TODAY },
    );
    expect(active(s)).toMatchObject({
      mode: "queue",
      step: "patient",
      patient: null,
      doctorId: null,
      day: null,
    });
  });
});

describe("answers belong to the flow that sent them", () => {
  // The receptionist confirms patient A on a slow Wi-Fi, gives up, and starts
  // patient B before A's answer arrives.
  const flowA = run(
    { type: "start", mode: "queue", doctorId: "d1", today: TODAY, flowId: 1 },
    { type: "pickPatient", patient: EXISTING },
  );
  const flowB = flowReducer(flowReducer(flowA, { type: "home" }), {
    type: "start",
    mode: "book",
    doctorId: "d2",
    today: TODAY,
    flowId: 2,
  });

  it("a flow keeps the id it was started with", () => {
    expect(active(flowA).flowId).toBe(1);
    expect(active(flowB).flowId).toBe(2);
    expect(active(run({ type: "start", mode: "queue", today: TODAY })).flowId).toBe(0);
  });

  it("A's ticket does not turn B's screen into «Талон выдан»", () => {
    expect(flowReducer(flowB, { type: "done", result: TICKET, flowId: 1 })).toBe(flowB);
    expect(active(flowReducer(flowA, { type: "done", result: TICKET, flowId: 1 })).step).toBe("done");
  });

  it("A's «тот же человек?» and A's new card stay out of B's flow", () => {
    const owner = { id: "p9", fullName: "Каримова Д.", birthYear: 1985 };
    expect(flowReducer(flowB, { type: "ownerQuestion", owner, flowId: 1 })).toBe(flowB);
    expect(flowReducer(flowB, { type: "patientCreated", patientId: "pA", flowId: 1 })).toBe(flowB);
    expect(flowReducer(flowB, { type: "bookingUnsure", unsure: UNSURE, flowId: 1 })).toBe(flowB);
    expect(active(flowReducer(flowB, { type: "patientCreated", patientId: "pB", flowId: 2 }))).toMatchObject({
      createdPatientId: "pB",
    });
  });

  it("an answer after the flow went home changes nothing", () => {
    const home = flowReducer(flowA, { type: "home" });
    expect(flowReducer(home, { type: "done", result: TICKET, flowId: 1 })).toBe(HOME);
  });
});

describe("a booking that got no answer", () => {
  const confirm = run(
    { type: "start", mode: "book", doctorId: "d1", today: TODAY, flowId: 3 },
    { type: "pickPatient", patient: EXISTING },
    { type: "pickTime", time: "10:00" },
  );
  const unsure = flowReducer(confirm, { type: "bookingUnsure", unsure: UNSURE, flowId: 3 });

  it("is remembered so the next «Записать» looks for it first", () => {
    expect(active(confirm).unsureBooking).toBeNull();
    expect(active(unsure).unsureBooking).toEqual(UNSURE);
  });

  it("survives another slot or doctor: the lost visit is still this patient's", () => {
    const otherSlot = run(
      { type: "start", mode: "book", doctorId: "d1", today: TODAY, flowId: 3 },
      { type: "pickPatient", patient: EXISTING },
      { type: "pickTime", time: "10:00" },
      { type: "bookingUnsure", unsure: UNSURE, flowId: 3 },
      { type: "goTo", step: "time" },
      { type: "pickTime", time: "11:00" },
      { type: "goTo", step: "doctor" },
      { type: "pickDoctor", doctorId: "d2" },
    );
    expect(active(otherSlot).unsureBooking).toEqual(UNSURE);
  });

  it("survives picking the same person again («Изменить» on the patient)", () => {
    const again = flowReducer(unsure, { type: "pickPatient", patient: EXISTING });
    expect(active(again)).toMatchObject({ step: "confirm", unsureBooking: UNSURE });
  });

  it("a new patient picked again keeps his card and his lost booking", () => {
    const lost: UnsureBooking = { ...UNSURE, patientId: "p_new" };
    const s = run(
      { type: "start", mode: "book", doctorId: "d1", today: TODAY, flowId: 6 },
      { type: "pickPatient", patient: NEW },
      { type: "pickTime", time: "10:00" },
      { type: "patientCreated", patientId: "p_new", flowId: 6 },
      { type: "bookingUnsure", unsure: lost, flowId: 6 },
      { type: "goTo", step: "patient" },
    );
    // The same details from the form again.
    const same = active(flowReducer(s, { type: "pickPatient", patient: { ...NEW } }));
    expect(same).toMatchObject({ createdPatientId: "p_new", unsureBooking: lost });
    // Or the card made for him, found by the search.
    const found = active(
      flowReducer(s, { type: "pickPatient", patient: { ...EXISTING, id: "p_new" } }),
    );
    expect(found).toMatchObject({ createdPatientId: null, unsureBooking: lost });
    // A corrected name is another pick: the server is asked again.
    const other = active(
      flowReducer(s, { type: "pickPatient", patient: { ...NEW, fullName: "Каримов Темур 2012" } }),
    );
    expect(other).toMatchObject({ createdPatientId: null, unsureBooking: null });
  });

  it("is dropped for another patient, on done, and by a new flow", () => {
    expect(active(flowReducer(unsure, { type: "pickPatient", patient: NEW })).unsureBooking).toBeNull();
    const booked = flowReducer(unsure, {
      type: "done",
      flowId: 3,
      result: {
        kind: "booking",
        appointmentId: "a9",
        patientName: "Юсупова Лола",
        doctorId: "d1",
        day: TODAY,
        time: "10:00",
        recovered: true,
      },
    });
    expect(active(booked)).toMatchObject({ step: "done", unsureBooking: null });
    expect(
      active(flowReducer(unsure, { type: "start", mode: "book", today: TODAY, flowId: 4 })).unsureBooking,
    ).toBeNull();
  });

  it("means nothing in the queue flow (the walk-in route hands the same ticket back)", () => {
    const queue = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY, flowId: 5 },
      { type: "pickPatient", patient: EXISTING },
    );
    expect(flowReducer(queue, { type: "bookingUnsure", unsure: UNSURE, flowId: 5 })).toBe(queue);
  });
});

describe("the header's «Назад»", () => {
  const patientStep = active(run({ type: "start", mode: "queue", today: TODAY }));

  it("on the new patient form closes the form, keeping the flow (and the typing)", () => {
    expect(headerBack(patientStep, { creatingPatient: true })).toBe("closeNewPatient");
  });

  it("on the search walks back as usual (home from the first step)", () => {
    expect(headerBack(patientStep, { creatingPatient: false })).toBe("back");
    expect(flowReducer(patientStep, { type: "back" })).toEqual(HOME);
  });

  it("on any later step walks back a step, whatever the form was", () => {
    const doctor = active(flowReducer(patientStep, { type: "pickPatient", patient: NEW }));
    expect(doctor.step).toBe("doctor");
    expect(headerBack(doctor, { creatingPatient: true })).toBe("back");
  });
});
