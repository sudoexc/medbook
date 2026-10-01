/**
 * The lobby kiosk's decisions, kept out of the page so they can be pinned by
 * unit tests (the page itself is a client component with no DOM in the test
 * run). The page renders; these say what it shows and what it sends.
 */

export type KioskLang = "ru" | "uz";

/** A service on the kiosk's picker; `price` in whole soms (see /api/kiosk/doctors). */
export type KioskService = {
  id: string;
  nameRu: string;
  nameUz: string;
  price: number;
};

export type KioskDoctor = {
  id: string;
  nameRu: string;
  nameUz: string;
  cabinet: string | null;
  color: string | null;
  /** People in front of a new walk-in: waiting plus the one being seen. */
  ahead: number;
  services: KioskService[];
};

/** A row of /api/c/<slug>/queue/doctors (on duty today, live counts). */
export type QueueDoctorRow = {
  id: string;
  nameRu: string;
  nameUz: string | null;
  cabinet: string | null;
  color: string | null;
  waitingCount: number;
};

/** A row of /api/kiosk/doctors (services and this doctor's prices). */
export type KioskDoctorDetails = {
  id: string;
  services: KioskService[];
};

/**
 * Doctors for the «Выберите врача» step (audit Q-07). Who is listed and how
 * many are ahead come from the live queue endpoint, which counts the
 * patient being seen too; the board's `waiting.length` left him out and the
 * kiosk said «перед вами 0» to someone who would wait for him.
 */
export function mergeKioskDoctors(
  queue: QueueDoctorRow[],
  details: KioskDoctorDetails[],
): KioskDoctor[] {
  const services = new Map(details.map((d) => [d.id, d.services]));
  return queue.map((d) => ({
    id: d.id,
    nameRu: d.nameRu,
    nameUz: d.nameUz || d.nameRu,
    cabinet: d.cabinet,
    color: d.color,
    ahead: Math.max(0, d.waitingCount),
    services: services.get(d.id) ?? [],
  }));
}

export type KioskTodayBooking = {
  id: string;
  doctorName: string;
  cabinet: string | null;
  service: string | null;
  time: string;
  ticketNumber: string | null;
};

export type KioskUpcomingBooking = {
  id: string;
  doctorName: string;
  cabinet: string | null;
  service: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
};

/** One card the typed number stands for (see /api/kiosk/checkin). */
export type KioskPerson = {
  id: string;
  /** Masked («Каримова Д.»). */
  fullName: string;
  unverified: boolean;
  appointments: KioskTodayBooking[];
  upcoming: KioskUpcomingBooking[];
};

export type KioskLookup = {
  patient: { id: string; fullName: string; unverified?: boolean } | null;
  appointments?: KioskTodayBooking[];
  upcoming?: KioskUpcomingBooking[];
  people?: KioskPerson[];
};

/** Everyone the lookup offers, the primary card first. */
export function lookupPeople(data: KioskLookup): KioskPerson[] {
  if (data.people && data.people.length > 0) return data.people;
  if (!data.patient) return [];
  return [
    {
      id: data.patient.id,
      fullName: data.patient.fullName,
      unverified: data.patient.unverified === true,
      appointments: data.appointments ?? [],
      upcoming: data.upcoming ?? [],
    },
  ];
}

/**
 * After the phone: nobody holds it (a first visit), one card («Это вы?»),
 * or a family on one number («Кто пришёл?», audit P1D-02).
 */
export function stepAfterLookup(people: KioskPerson[]): "enter-name" | "is-this-you" | "who" {
  if (people.length === 0) return "enter-name";
  return people.length === 1 ? "is-this-you" : "who";
}

/** Once the person is known: today's bookings, a later one, or a new ticket. */
export function stepForPerson(person: KioskPerson): "checkin" | "upcoming" | "select-doctor" {
  if (person.appointments.length > 0) return "checkin";
  if (person.upcoming.length > 0) return "upcoming";
  return "select-doctor";
}

/** What the «Кто пришёл?» row says under a name, if anything. */
export function personBookingHint(
  person: KioskPerson,
): { kind: "today"; time: string } | { kind: "later"; date: string; time: string } | null {
  const today = person.appointments[0];
  if (today) return { kind: "today", time: today.time };
  const later = person.upcoming[0];
  if (later) {
    const [yyyy, mm, dd] = later.date.split("-");
    return { kind: "later", date: `${dd}.${mm}.${yyyy}`, time: later.time };
  }
  return null;
}

/**
 * The walk-in request. The card picked on the kiosk goes as `patientId`
 * (P1D-02), so a relative's visit lands on his own card; `phoneOwner` stays
 * for a number nobody claimed or a person who said «это не я». The chosen
 * service goes by id (Q-06): its name alone was shown and then lost.
 */
export function walkinRequestBody(args: {
  fullName: string;
  phone: string;
  doctorId: string;
  lang: KioskLang;
  pickedPatientId: string | null;
  notOwner: boolean;
  service: KioskService | null;
}): Record<string, unknown> {
  return {
    fullName: args.fullName,
    phone: args.phone,
    doctorId: args.doctorId,
    lang: args.lang.toUpperCase(),
    phoneOwner: args.pickedPatientId ? "same" : args.notOwner ? "other" : undefined,
    ...(args.pickedPatientId ? { patientId: args.pickedPatientId } : {}),
    ...(args.service ? { serviceId: args.service.id } : {}),
  };
}

/** A print job: the stub is loaded once per job, in the language it was issued in. */
export type KioskPrintJob = { token: string; lang: KioskLang; seq: number };

/**
 * Where the kiosk's hidden print frame points (audit Q-09). The stub opened
 * in a new tab used to stay on the screen for the next person; now it loads
 * in a frame on the kiosk's own page and prints itself there.
 */
export function ticketPrintSrc(job: Pick<KioskPrintJob, "token" | "lang">): string {
  return `/ticket/${encodeURIComponent(job.token)}?lang=${job.lang}`;
}
