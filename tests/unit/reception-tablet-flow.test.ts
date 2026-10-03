/**
 * The reception tablet's step state machine (src/lib/reception-tablet/flow.ts):
 * one screen per step, a doctor's tile skips the doctor step, «Назад» walks
 * back, and nothing reopens a step once the ticket or booking exists.
 */
import { describe, expect, it } from "vitest";

import {
  canOpenStep,
  firstOpenStep,
  flowReducer,
  HOME,
  stepNumber,
  stepsFor,
  type ActiveFlow,
  type ChosenPatient,
  type FlowAction,
  type FlowState,
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
      { type: "ownerQuestion", owner: { id: "p9", fullName: "Каримова Д.", birthYear: 1985 } },
      { type: "patientCreated", patientId: "p_new" },
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
      { type: "ownerQuestion", owner: { id: "p9", fullName: "Каримова Д.", birthYear: null } },
      { type: "back" },
    );
    expect(active(s).owner).toBeNull();
  });

  it("after the ticket only «Следующий пациент» leaves: no step reopens", () => {
    const done = run(
      { type: "start", mode: "queue", doctorId: "d1", today: TODAY },
      { type: "pickPatient", patient: EXISTING },
      {
        type: "done",
        result: {
          kind: "ticket",
          appointmentId: "a1",
          ticketNumber: "A-012",
          ticketCode: "K7Q2M",
          duplicate: false,
          patientName: "Юсупова Лола",
          doctorId: "d1",
          cabinet: "101",
          placeHint: 2,
        },
      },
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
