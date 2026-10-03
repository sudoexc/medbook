/**
 * The reception tablet's screens as one state machine.
 *
 *   home ─┬─ «В очередь»        patient → doctor → confirm → done (ticket)
 *         └─ «Записать на время» patient → doctor → time → confirm → done
 *
 * Every step is one screen. A flow started from a doctor's tile carries the
 * doctor, so picking the patient goes straight past the doctor step (it
 * stays one tap away for a change of mind). «Назад» walks the steps back
 * and leaves to home from the first one.
 *
 * Every flow has an id. A server answer (the ticket, the booking, the
 * «тот же человек?» question, a created card) carries the id of the flow
 * that sent it and lands only in that flow: an answer that arrives after
 * the receptionist moved on to the next patient never shows up on his
 * screen.
 *
 * Pure: the page runs it through `useReducer`, the unit tests call it.
 */

export type TabletMode = "queue" | "book";

export type FlowStep = "patient" | "doctor" | "time" | "confirm" | "done";

/** The owner of a number, as the walk-in and patient routes answer 409. */
export type OwnerQuestion = {
  id: string;
  fullName: string;
  birthYear: number | null;
  unverified?: boolean;
};

export type ChosenPatient =
  | {
      kind: "existing";
      id: string;
      fullName: string;
      phone: string | null;
      birthYear: number | null;
    }
  | {
      kind: "new";
      /** As the API gets it, the birth year appended (see new-patient.ts). */
      fullName: string;
      /** «+998901234567». */
      phone: string;
      birthYear: number | null;
      gender: "MALE" | "FEMALE" | null;
    };

/**
 * A booking whose POST got no answer (the Wi-Fi dropped, a gateway timed
 * out): the visit may exist on the server. The next «Записать» looks for it
 * first instead of booking the patient a second time.
 */
export type UnsureBooking = {
  patientId: string;
  doctorId: string;
  /** Tashkent YYYY-MM-DD. */
  day: string;
  /** «HH:MM». */
  time: string;
};

/** What the success screen shows. */
export type FlowResult =
  | {
      kind: "ticket";
      appointmentId: string;
      ticketNumber: string;
      ticketCode: string | null;
      duplicate: boolean;
      patientName: string;
      doctorId: string;
      cabinet: string | null;
      /** Live waiting count ahead at issue time, until the list refreshes. */
      placeHint: number | null;
    }
  | {
      kind: "booking";
      appointmentId: string;
      patientName: string;
      doctorId: string;
      day: string;
      time: string;
      /** Found already saved on the check after a lost answer. */
      recovered?: boolean;
    };

export type FlowState =
  | { screen: "home" }
  | {
      screen: "flow";
      /** Which flow this is; server answers carry it (see the top). */
      flowId: number;
      mode: TabletMode;
      step: FlowStep;
      patient: ChosenPatient | null;
      doctorId: string | null;
      serviceId: string | null;
      day: string | null;
      time: string | null;
      /** «Это тот же человек?» waiting for an answer. */
      owner: OwnerQuestion | null;
      /**
       * Booking only: the card created for a new patient whose booking then
       * failed (the slot was taken meanwhile). A retry books into it instead
       * of asking the server for the card again.
       */
      createdPatientId: string | null;
      /** Booking only: an earlier «Записать» that got no answer. */
      unsureBooking: UnsureBooking | null;
      result: FlowResult | null;
    };

export type ActiveFlow = Extract<FlowState, { screen: "flow" }>;

export type FlowAction =
  | {
      type: "start";
      mode: TabletMode;
      doctorId?: string | null;
      today: string;
      flowId?: number;
    }
  | { type: "pickPatient"; patient: ChosenPatient }
  | { type: "pickDoctor"; doctorId: string }
  | { type: "pickService"; serviceId: string | null }
  | { type: "pickDay"; day: string }
  | { type: "pickTime"; time: string }
  | { type: "goTo"; step: FlowStep }
  | { type: "back" }
  // Server answers: applied only to the flow `flowId` names.
  | { type: "ownerQuestion"; owner: OwnerQuestion; flowId: number }
  | { type: "patientCreated"; patientId: string; flowId: number }
  | { type: "bookingUnsure"; unsure: UnsureBooking; flowId: number }
  | { type: "done"; result: FlowResult; flowId: number }
  | { type: "ownerCleared" }
  | { type: "home" };

const ANSWER_TYPES: ReadonlySet<FlowAction["type"]> = new Set([
  "ownerQuestion",
  "patientCreated",
  "bookingUnsure",
  "done",
]);

export const HOME: FlowState = { screen: "home" };

/** The steps of a mode, in order, without the success screen. */
export function stepsFor(mode: TabletMode): FlowStep[] {
  return mode === "queue"
    ? ["patient", "doctor", "confirm"]
    : ["patient", "doctor", "time", "confirm"];
}

/** Has the receptionist given what `step` asks for? */
export function isStepComplete(state: ActiveFlow, step: FlowStep): boolean {
  switch (step) {
    case "patient":
      return state.patient !== null;
    case "doctor":
      return state.doctorId !== null;
    case "time":
      return state.day !== null && state.time !== null;
    case "confirm":
      return state.result !== null;
    case "done":
      return false;
  }
}

/** The first step still missing something; «confirm» when all is given. */
export function firstOpenStep(state: ActiveFlow): FlowStep {
  for (const step of stepsFor(state.mode)) {
    if (step === "confirm") return "confirm";
    if (!isStepComplete(state, step)) return step;
  }
  return "confirm";
}

/** A step may be opened once every step before it is complete. */
export function canOpenStep(state: ActiveFlow, step: FlowStep): boolean {
  const steps = stepsFor(state.mode);
  const idx = steps.indexOf(step);
  if (idx < 0) return false;
  return steps.slice(0, idx).every((s) => isStepComplete(state, s));
}

/**
 * After a change that drops a choice (another day drops the slot), a screen
 * whose earlier steps are no longer complete gives way to the first one
 * that needs an answer again.
 */
function settle(next: ActiveFlow): ActiveFlow {
  return canOpenStep(next, next.step) ? next : { ...next, step: firstOpenStep(next) };
}

/** The same person picked again (the same card, or the same new patient's details). */
function samePerson(prev: ChosenPatient | null, next: ChosenPatient): boolean {
  if (!prev) return false;
  if (prev.kind === "existing" && next.kind === "existing") return prev.id === next.id;
  if (prev.kind === "new" && next.kind === "new") {
    return prev.fullName === next.fullName && prev.phone === next.phone;
  }
  return false;
}

function startFlow(
  mode: TabletMode,
  doctorId: string | null,
  today: string,
  flowId: number,
): ActiveFlow {
  return {
    screen: "flow",
    flowId,
    mode,
    step: "patient",
    patient: null,
    doctorId,
    serviceId: null,
    day: mode === "book" ? today : null,
    time: null,
    owner: null,
    createdPatientId: null,
    unsureBooking: null,
    result: null,
  };
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  if (action.type === "start") {
    return startFlow(action.mode, action.doctorId ?? null, action.today, action.flowId ?? 0);
  }
  if (action.type === "home") return HOME;
  if (state.screen !== "flow") return state;
  // An answer to a flow that is gone (cancelled, timed out, replaced by the
  // next patient's) is not this flow's.
  if (ANSWER_TYPES.has(action.type) && "flowId" in action && action.flowId !== state.flowId) {
    return state;
  }
  // Once the ticket or the booking exists, the flow is over: only «home»
  // (Следующий пациент) leaves the success screen. A stray tap on an old
  // control must not reopen a step and issue a second ticket.
  if (state.step === "done") return state;

  switch (action.type) {
    case "pickPatient": {
      const same = samePerson(state.patient, action.patient);
      const lostBookingIsHis =
        state.unsureBooking !== null &&
        (same ||
          (action.patient.kind === "existing" &&
            action.patient.id === state.unsureBooking.patientId));
      const next: ActiveFlow = {
        ...state,
        patient: action.patient,
        owner: null,
        // The card made for this same new patient stays his; anyone else
        // starts clean.
        createdPatientId: same && action.patient.kind === "new" ? state.createdPatientId : null,
        // A booking that got no answer is still looked for while it is the
        // same person; another person's pick drops it.
        unsureBooking: lostBookingIsHis ? state.unsureBooking : null,
      };
      return { ...next, step: firstOpenStep(next) };
    }
    case "pickDoctor": {
      const changed = action.doctorId !== state.doctorId;
      const next: ActiveFlow = {
        ...state,
        doctorId: action.doctorId,
        serviceId: changed ? null : state.serviceId,
        time: changed ? null : state.time,
        owner: null,
      };
      return { ...next, step: firstOpenStep(next) };
    }
    case "pickService":
      // A service changes the visit's length, so a picked slot may no
      // longer fit: it is picked again.
      return settle({
        ...state,
        serviceId: action.serviceId,
        time: state.mode === "book" && action.serviceId !== state.serviceId ? null : state.time,
      });
    case "pickDay":
      return action.day === state.day ? state : settle({ ...state, day: action.day, time: null });
    case "pickTime": {
      if (state.mode !== "book" || state.day === null) return state;
      const next: ActiveFlow = { ...state, time: action.time };
      return { ...next, step: firstOpenStep(next) };
    }
    case "goTo":
      if (action.step === "done" || !canOpenStep(state, action.step)) return state;
      return { ...state, step: action.step, owner: null };
    case "back": {
      const steps = stepsFor(state.mode);
      const idx = steps.indexOf(state.step);
      if (idx <= 0) return HOME;
      return { ...state, step: steps[idx - 1]!, owner: null };
    }
    case "ownerQuestion":
      return { ...state, owner: action.owner };
    case "ownerCleared":
      return { ...state, owner: null };
    case "patientCreated":
      return { ...state, createdPatientId: action.patientId };
    case "bookingUnsure":
      return state.mode === "book" ? { ...state, unsureBooking: action.unsure } : state;
    case "done":
      return { ...state, step: "done", owner: null, unsureBooking: null, result: action.result };
  }
  return state;
}

/**
 * What the header's «Назад» does. The new patient form lives inside the
 * patient step, so on it «Назад» closes the form back to the search, typing
 * kept, instead of leaving the whole flow (and losing the form) for home.
 */
export function headerBack(
  state: ActiveFlow,
  sub: { creatingPatient: boolean },
): "closeNewPatient" | "back" {
  return state.step === "patient" && sub.creatingPatient ? "closeNewPatient" : "back";
}

/** Stepper position: the 1-based number of `step` among the mode's steps. */
export function stepNumber(mode: TabletMode, step: FlowStep): number {
  const steps = stepsFor(mode);
  const idx = steps.indexOf(step);
  return idx < 0 ? steps.length : idx + 1;
}
