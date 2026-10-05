"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
// Locale-aware router: pushes /crm/telegram as /<locale>/crm/telegram.
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useLiveEvents } from "@/hooks/use-live-events";
import { isReceptionTabletPath } from "@/lib/reception-tablet/access";
import { isDoctorThread } from "@/lib/doctor-tg-alert";
import {
  DOCTOR_NOTIFICATION_PREFS_KEY,
  doctorWantsMessageAlerts,
  fetchDoctorNotificationPrefs,
} from "@/lib/doctor-notification-prefs";
import {
  installNotificationSoundUnlock,
  playNotificationSound,
} from "@/lib/notification-sound";

/**
 * Shell-level alerts for incoming Telegram messages: toast + ping, on every
 * screen.
 *
 * The toast used to be mounted inside the Telegram page only, so whether the
 * receptionist saw an incoming message depended on which section she happened
 * to be in — reported verbatim as «то выходит то не выходит». Alerts about
 * new messages are a property of being on shift, not of the section, so they
 * live in the layout now.
 *
 * On the inbox page itself this component stays SILENT: the page's own
 * `useTgInboxAlerts` keeps handling toasts there (it knows which thread is
 * focused and suppresses alerts for it — knowledge the shell doesn't have).
 * Two toasters for one event would double every alert instead.
 *
 * In the doctor's cabinet it rings only for the doctor's own threads (audit
 * DC-04, see `isDoctorThread`): reception works the whole clinic's inbox,
 * a doctor sees his caseload. And only while his «Новое сообщение → В
 * системе» switch is on (audit DC-09): the setting used to be saved and
 * ignored, so switching it off changed nothing.
 */
export function GlobalTgAlerts({
  inboxPath,
  scope = "clinic",
}: {
  /** Where this surface reads Telegram: /crm/telegram or /doctor/messages. */
  inboxPath: string;
  /** Whose messages ring here: the whole clinic's, or the doctor's own. */
  scope?: "clinic" | "doctor";
}) {
  const t = useTranslations("tgInbox");
  const router = useRouter();
  const pathname = usePathname() ?? "";

  // Audio must be armed by a user gesture; install the one-shot listeners as
  // soon as the shell mounts so the first click anywhere unlocks the ping.
  React.useEffect(() => {
    installNotificationSoundUnlock();
  }, []);

  // The doctor's own switch. Same cache as the settings tab, so a flip there
  // reaches the next message without a reload. Reception has no such row.
  const prefs = useQuery({
    queryKey: DOCTOR_NOTIFICATION_PREFS_KEY,
    queryFn: ({ signal }) => fetchDoctorNotificationPrefs(signal),
    enabled: scope === "doctor",
    staleTime: 5 * 60_000,
  });

  const onInboxPageRef = React.useRef(false);
  // The reception iPad page answers no messages, and the toast's «Открыть»
  // would leave a booking half done: no toast there, the unread badge of
  // the desktop still counts it.
  const onTabletRef = React.useRef(false);
  const inboxPathRef = React.useRef(inboxPath);
  const scopeRef = React.useRef(scope);
  const wantsAlertsRef = React.useRef(true);
  React.useEffect(() => {
    onInboxPageRef.current = pathname.includes(inboxPath);
    onTabletRef.current = isReceptionTabletPath(pathname);
    inboxPathRef.current = inboxPath;
    scopeRef.current = scope;
    wantsAlertsRef.current =
      scope !== "doctor" || doctorWantsMessageAlerts(prefs.data);
  }, [pathname, inboxPath, scope, prefs.data]);

  const handler = React.useCallback(
    (event: { type: string; payload?: unknown }) => {
      if (event.type !== "tg.message.new") return;
      // The inbox page runs its own, focus-aware alerting.
      if (onInboxPageRef.current || onTabletRef.current) return;

      const p = (event.payload ?? {}) as {
        conversationId?: string;
        preview?: string;
        contactName?: string;
        direction?: string;
      };
      // Our own outbound replies also emit tg.message.new — a ping about a
      // message the operator just typed is noise.
      if (p.direction === "OUT") return;

      const ring = () => {
        playNotificationSound();
        toast.info(
          p.contactName
            ? t("globalToast.titleFrom", { name: p.contactName })
            : t("globalToast.title"),
          {
            description: p.preview || t("globalToast.noText"),
            action: {
              label: t("globalToast.open"),
              onClick: () => {
                router.push(
                  p.conversationId
                    ? `${inboxPathRef.current}?conv=${encodeURIComponent(p.conversationId)}`
                    : inboxPathRef.current,
                );
              },
            },
          },
        );
      };

      if (scopeRef.current === "doctor") {
        // Switched off in his settings: no toast, no sound. The unread badge
        // on «Сообщения» still counts the message.
        if (!wantsAlertsRef.current) return;
        // Asked before a sound or a preview leaves the screen. The answer
        // may land after the doctor opened his inbox, which alerts itself.
        void isDoctorThread(p.conversationId).then((mine) => {
          if (mine && !onInboxPageRef.current && wantsAlertsRef.current) ring();
        });
        return;
      }
      ring();
    },
    [router, t],
  );

  useLiveEvents(handler, { filter: ["tg.message.new"] });

  return null;
}
