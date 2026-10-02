/**
 * The top-bar search (`/api/crm/search` and its dialog) starts at this many
 * characters (audit AC-23). One letter matches a large part of the patient
 * base and ran four ILIKE scans (patients, doctors, visit notes, chats) on
 * every keystroke, for a list nobody reads. Shared so the dialog does not
 * send what the endpoint answers with nothing.
 */
export const GLOBAL_SEARCH_MIN_CHARS = 2;
