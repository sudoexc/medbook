/**
 * The doctor's notification switches and which of them do anything
 * (audit DC-09).
 *
 * «Настройки → Уведомления» offered a 4 × 3 matrix (new appointment, new
 * message, lab result, reminder × in the app, email, Telegram) and saved
 * every flip, but nothing read the row: the doctor switched «В системе» off
 * and the message toasts kept ringing, switched Telegram on and nothing ever
 * came. A switch that changes nothing is a mock in production.
 *
 * Only cells with a real delivery behind them are offered now. Today that is
 * one: the in-app alert (toast and sound) for a new Telegram message of the
 * doctor's own thread, `GlobalTgAlerts` in the cabinet. The other events have
 * no doctor-facing delivery yet, and there is no email or Telegram channel to
 * a doctor at all; the tab says so instead of showing switches. When a
 * delivery lands, its cell joins `WIRED_DOCTOR_PREF_CELLS` and the switch
 * appears by itself.
 *
 * Client-safe: no server imports.
 */

export type DoctorNotificationPref = {
  id: string;
  userId: string;
  appointmentCreated_inApp: boolean;
  appointmentCreated_email: boolean;
  appointmentCreated_telegram: boolean;
  messageNew_inApp: boolean;
  messageNew_email: boolean;
  messageNew_telegram: boolean;
  labResultReceived_inApp: boolean;
  labResultReceived_email: boolean;
  labResultReceived_telegram: boolean;
  reminderDue_inApp: boolean;
  reminderDue_email: boolean;
  reminderDue_telegram: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DoctorPrefEvent =
  | "appointmentCreated"
  | "messageNew"
  | "labResultReceived"
  | "reminderDue";

export type DoctorPrefChannel = "inApp" | "email" | "telegram";

export type DoctorPrefCell = `${DoctorPrefEvent}_${DoctorPrefChannel}`;

/** Every cell the settings matrix has a column for, in display order. */
export const DOCTOR_PREF_EVENTS: readonly DoctorPrefEvent[] = [
  "appointmentCreated",
  "messageNew",
  "labResultReceived",
  "reminderDue",
];
export const DOCTOR_PREF_CHANNELS: readonly DoctorPrefChannel[] = [
  "inApp",
  "email",
  "telegram",
];

/** Cells something actually honours. Keep in step with the readers below. */
export const WIRED_DOCTOR_PREF_CELLS: ReadonlySet<DoctorPrefCell> = new Set<
  DoctorPrefCell
>(["messageNew_inApp"]);

export function doctorPrefCell(
  event: DoctorPrefEvent,
  channel: DoctorPrefChannel,
): DoctorPrefCell {
  return `${event}_${channel}`;
}

export function isWiredDoctorPrefCell(cell: string): boolean {
  return WIRED_DOCTOR_PREF_CELLS.has(cell as DoctorPrefCell);
}

/** The events and channels the settings tab still has a switch for. */
export function wiredDoctorPrefMatrix(): {
  events: DoctorPrefEvent[];
  channels: DoctorPrefChannel[];
} {
  return {
    events: DOCTOR_PREF_EVENTS.filter((e) =>
      DOCTOR_PREF_CHANNELS.some((c) => isWiredDoctorPrefCell(doctorPrefCell(e, c))),
    ),
    channels: DOCTOR_PREF_CHANNELS.filter((c) =>
      DOCTOR_PREF_EVENTS.some((e) => isWiredDoctorPrefCell(doctorPrefCell(e, c))),
    ),
  };
}

export const DOCTOR_NOTIFICATION_PREFS_KEY = [
  "doctor",
  "me",
  "notification-prefs",
] as const;

export const DOCTOR_NOTIFICATION_PREFS_URL =
  "/api/crm/doctors/me/notification-prefs";

export async function fetchDoctorNotificationPrefs(
  signal?: AbortSignal,
): Promise<DoctorNotificationPref> {
  const res = await fetch(DOCTOR_NOTIFICATION_PREFS_URL, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`notification-prefs: ${res.status}`);
  return (await res.json()) as DoctorNotificationPref;
}

/**
 * Whether the cabinet rings (toast and sound) for a new message. While the
 * row is loading or failed to load, the model's default (on) applies: a
 * doctor who never opened the tab must keep getting his alerts.
 */
export function doctorWantsMessageAlerts(
  pref: Pick<DoctorNotificationPref, "messageNew_inApp"> | null | undefined,
): boolean {
  return pref?.messageNew_inApp !== false;
}
