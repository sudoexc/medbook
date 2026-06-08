-- Wave 5 of `docs/TZ-sms-removal.md` — schema cleanup.
--
-- After Wave 1 (kill-switch) and Waves 2-3 (UI + write-path code removal),
-- two SMS-shaped data items linger:
--
--   1. `Clinic.smsSenderName` — Eskiz/Playmobile sender id, no longer read
--      by any code path. Field is already gone from the Zod patch schema
--      (`src/server/schemas/settings.ts`) and the secrets PATCH route
--      (`src/app/api/crm/clinic/secrets/route.ts`).
--
--   2. `ProviderConnection WHERE kind='SMS'` rows — Eskiz/Playmobile
--      credentials. Nothing reads them; deleting frees the unique-by-clinic
--      slot for a future provider connection of a different kind.
--
-- Enum values (`CommunicationChannel.SMS`, `ProviderKind.SMS`,
-- `NotificationChannel.SMS`, `CommunicationKind.SMS_REPLY`) stay — historical
-- rows in `Communication`, `NotificationSend`, `AuditLog` still reference
-- them and we want the read-only archive view to keep rendering.
--
-- IDEMPOTENT — re-running this migration is a no-op once the column is
-- already dropped (`DROP COLUMN IF EXISTS`) and the rows are already gone
-- (`DELETE` matches zero rows).

ALTER TABLE "Clinic" DROP COLUMN IF EXISTS "smsSenderName";

DELETE FROM "ProviderConnection" WHERE "kind" = 'SMS';
