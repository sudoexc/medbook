"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { Clock, MapPin, User, CheckCircle, Bell, Stethoscope } from "lucide-react";

interface QueueStatus {
  patientName: string;
  doctorName: string;
  clinicName: string | null;
  clinicSlug: string | null;
  doctorId: string;
  cabinet: string | null;
  service: string | null;
  status: string;
  /** Two-lanes: walk-ins hold a queue position, bookings hold a slot time. */
  lane?: "live" | "schedule";
  slotTime?: string | null;
  position: number | null;
  totalWaiting: number;
  etaMinutes: number | null;
  etaConfidence?: "high" | "med" | "low";
  etaSource?: "history" | "blended" | "fallback";
  ticketNumber: string | null;
}

// SSE now delivers instant pokes; the poll is just a safety net for a dropped
// stream or a missed event.
const POLL_FALLBACK_MS = 20_000;
const SSE_REFETCH_DEBOUNCE_MS = 350;
const QUEUE_EVENTS = new Set<string>([
  "queue.updated",
  "queue.called",
  "appointment.created",
  "appointment.statusChanged",
  "appointment.cancelled",
  "appointment.moved",
]);

export default function QueueStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const [data, setData] = useState<QueueStatus | null>(null);
  const [id, setId] = useState<string>("");
  const [error, setError] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const wasNotified = useRef(false);
  const lastStatus = useRef<string>("");
  const fetchedAt = useRef<number>(0);
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const fetchStatus = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/queue/status/${id}`);
      if (res.ok) {
        const d = (await res.json()) as QueueStatus;
        setData(d);
        setError(false);
        fetchedAt.current = Date.now();
        setCountdown((d.etaMinutes ?? 0) * 60);

        // Vibrate + notify when status changes to IN_PROGRESS
        if (d.status === "IN_PROGRESS" && lastStatus.current !== "IN_PROGRESS") {
          try { navigator.vibrate?.([300, 100, 300, 100, 500]); } catch {}
          if (!wasNotified.current && "Notification" in window && Notification.permission === "granted") {
            new Notification(d.clinicName || "Электронная очередь", { body: `Ваша очередь! Кабинет ${d.cabinet}`, icon: "/logo.png" });
            wasNotified.current = true;
          }
        }
        lastStatus.current = d.status;
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  }, [id]);

  // Initial load + slow fallback poll (covers a dropped stream / missed poke).
  useEffect(() => {
    if (!id) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_FALLBACK_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(refetchTimer.current);
    };
  }, [id, fetchStatus]);

  // SSE — instant refetch when this patient's doctor queue changes. clinicSlug
  // and doctorId arrive with the first status payload, then stay constant, so
  // the stream opens once. Events without a doctorId still refetch (safe).
  const clinicSlug = data?.clinicSlug ?? null;
  const myDoctorId = data?.doctorId ?? null;
  useEffect(() => {
    if (!clinicSlug || !myDoctorId) return;
    const es = new EventSource(`/api/c/${encodeURIComponent(clinicSlug)}/queue/events`);
    es.onmessage = (ev) => {
      let parsed: { type?: string; payload?: { doctorId?: string } };
      try { parsed = JSON.parse(ev.data); } catch { return; }
      const type = parsed?.type;
      if (!type || !QUEUE_EVENTS.has(type)) return;
      const evDoctorId = parsed.payload?.doctorId;
      if (evDoctorId && evDoctorId !== myDoctorId) return;
      clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(fetchStatus, SSE_REFETCH_DEBOUNCE_MS);
    };
    return () => es.close();
  }, [clinicSlug, myDoctorId, fetchStatus]);

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Live countdown
  useEffect(() => {
    if (!data || data.status !== "WAITING" || countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [data, countdown]);

  const countdownMin = Math.floor(countdown / 60);
  const countdownSec = countdown % 60;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 mb-4">
            <span className="text-3xl">🎫</span>
          </div>
          <p className="text-lg text-gray-500 font-medium">Талон не найден</p>
          <p className="text-sm text-gray-400 mt-1">Ticket not found</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-[var(--brand-primary)] animate-spin" />
          <span className="text-gray-400 text-sm">Загрузка...</span>
        </div>
      </div>
    );
  }

  const isCompleted = data.status === "COMPLETED";
  const isInProgress = data.status === "IN_PROGRESS";
  // Two-lanes: a booking (schedule lane) never shows a queue position — its
  // axis is the slot time. Only live-lane walk-ins render position/ETA.
  const isScheduleLane = data.lane === "schedule";
  const isWaiting = data.status === "WAITING" && !isScheduleLane;
  const isArrivedBooking =
    isScheduleLane && ["WAITING", "BOOKED", "CONFIRMED"].includes(data.status);

  return (
    <div className={`min-h-screen flex flex-col ${
      isInProgress ? "bg-gradient-to-b from-green-50 to-white" :
      isCompleted ? "bg-gray-50" : "bg-gradient-to-b from-blue-50 to-white"
    }`}>
      {/* Header */}
      <div className="pt-6 pb-3 px-4 text-center">
        <Image
          src="/logo.png"
          alt={data?.clinicName || "Электронная очередь"}
          width={82}
          height={32}
          priority
          className="h-8 w-auto mx-auto mb-1"
        />
        <p className="text-[11px] text-gray-400 tracking-wider uppercase">Электронная очередь</p>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 pb-6">
        <div className="w-full max-w-sm">

          {/* Ticket number — big hero */}
          <div className={`rounded-3xl overflow-hidden shadow-xl mb-5 ${
            isInProgress ? "shadow-green-200" : isCompleted ? "shadow-gray-200" : "shadow-blue-200"
          }`}>
            <div className={`px-6 py-8 text-center ${
              isInProgress ? "bg-gradient-to-br from-green-500 to-emerald-600" :
              isCompleted ? "bg-gray-400" : "bg-gradient-to-br from-[var(--brand-primary)] to-[#1a3fd6]"
            }`}>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-[0.2em] mb-2">{data.ticketNumber ? "Ваш талон" : "Ваша запись"}</p>
              <p className="text-white text-6xl font-bold font-mono tracking-wider">{data.ticketNumber ?? data.slotTime ?? "—"}</p>
            </div>

            {/* Status section */}
            <div className="bg-white px-6 py-5">
              {isInProgress && (
                <div className="flex items-center gap-4">
                  <div className="relative shrink-0">
                    <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                      <Bell className="h-6 w-6 text-green-600" />
                    </div>
                    <div className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-green-500 border-2 border-white animate-bounce" />
                  </div>
                  <div>
                    <p className="text-green-700 font-bold text-xl">Ваша очередь!</p>
                    <p className="text-green-600 text-sm">Проходите в кабинет {data.cabinet}</p>
                  </div>
                </div>
              )}

              {isArrivedBooking && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-[var(--brand-primary)]" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-800">Приём по записи</p>
                    <p className="text-xs text-gray-500">
                      Ваше время: <span className="font-semibold">{data.slotTime ?? "—"}</span>
                      {data.status === "WAITING" ? " · вы отмечены как пришедший" : ""}
                    </p>
                  </div>
                </div>
              )}

              {isWaiting && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                        <Clock className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800">Ожидание</p>
                        <p className="text-xs text-gray-500">Перед вами: {Math.max(0, (data.position ?? 1) - 1)} чел.</p>
                      </div>
                    </div>
                    {/* Live countdown */}
                    <div className="text-right">
                      <p className="text-2xl font-bold font-mono text-amber-600 tabular-nums">
                        {countdownMin}:{String(countdownSec).padStart(2, "0")}
                      </p>
                      <p className="text-[10px] text-gray-400">примерно</p>
                    </div>
                  </div>

                  {/* Progress */}
                  {data.totalWaiting > 0 && data.position !== null && (
                    <div>
                      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-1000"
                          style={{ width: `${Math.max(8, ((data.totalWaiting - data.position + 1) / data.totalWaiting) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] text-gray-400">{data.position} из {data.totalWaiting}</span>
                        <span className="text-[10px] text-gray-400">~{data.etaMinutes ?? 0} мин</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isCompleted && (
                <div className="flex items-center gap-3 text-gray-500">
                  <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center">
                    <CheckCircle className="h-5 w-5 text-gray-400" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-600">Приём завершён</p>
                    <p className="text-xs text-gray-400">Спасибо за визит!</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Details card */}
          <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
            <div className="divide-y divide-gray-50">
              <div className="flex items-center gap-3 px-5 py-3.5">
                <User className="h-4 w-4 text-gray-300 shrink-0" />
                <span className="text-xs text-gray-400 shrink-0 w-16">Пациент</span>
                <span className="text-sm font-medium text-gray-800">{data.patientName}</span>
              </div>
              <div className="flex items-center gap-3 px-5 py-3.5">
                <Stethoscope className="h-4 w-4 text-gray-300 shrink-0" />
                <span className="text-xs text-gray-400 shrink-0 w-16">Врач</span>
                <span className="text-sm font-medium text-gray-800">{data.doctorName}</span>
              </div>
              <div className="flex items-center gap-3 px-5 py-3.5">
                <MapPin className="h-4 w-4 text-gray-300 shrink-0" />
                <span className="text-xs text-gray-400 shrink-0 w-16">Кабинет</span>
                <span className="text-sm font-bold text-gray-800 text-lg">{data.cabinet}</span>
              </div>
              {data.service && (
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <Clock className="h-4 w-4 text-gray-300 shrink-0" />
                  <span className="text-xs text-gray-400 shrink-0 w-16">Услуга</span>
                  <span className="text-sm font-medium text-gray-800">{data.service}</span>
                </div>
              )}
            </div>
          </div>

          {/* Auto-update indicator */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            <p className="text-[11px] text-gray-400">
              Обновляется автоматически
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
