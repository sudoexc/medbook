/**
 * The given name in the clinic's «Фамилия Имя Отчество» order: the second
 * word, or the only one.
 *
 * Every text that greets a patient by name reads it here (audit TG-29).
 * The chats and the broadcasts took the second word, while the reminders,
 * the medication reminders and the reactivation messages took the first,
 * so a patient read «Каримов, напоминаем...» from one and «Алишер» from
 * another.
 */
export function givenNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts[1] ?? parts[0] ?? "";
}
