"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, MapPin, User, CheckCircle, Bell, Stethoscope } from "lucide-react";

interface QueueStatus {
  patientName: string;
  doctorName: string;
  cabinet: number;
  service: string | null;
  status: string;
  position: number;
  totalWaiting: number;
  etaMinutes: number;
  ticketNumber: string;
}

export default function QueueStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const [data, setData] = useState<QueueStatus | null>(null);
  const [id, setId] = useState<string>("");
  const [error, setError] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [wasNotified, setWasNotified] = useState(false);
  const lastStatus = useRef<string>("");
  const fetchedAt = useRef<number>(0);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    async function fetchStatus() {
      try {
        const res = await fetch(`/api/queue/status/${id}`);
        if (res.ok) {
          const d = await res.json();
          setData(d);
          setError(false);
          fetchedAt.current = Date.now();
          setCountdown(d.etaMinutes * 60);

          // Vibrate + notify when status changes to IN_PROGRESS
          if (d.status === "IN_PROGRESS" && lastStatus.current !== "IN_PROGRESS") {
            try { navigator.vibrate?.([300, 100, 300, 100, 500]); } catch {}
            if (!wasNotified && "Notification" in window && Notification.permission === "granted") {
              new Notification("NeuroFax-B", { body: `Ваша очередь! Кабинет ${d.cabinet}`, icon: "/logo.png" });
              setWasNotified(true);
            }
          }
          lastStatus.current = d.status;
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      }
    }
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [id, wasNotified]);

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
          <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
          <span className="text-gray-400 text-sm">Загрузка...</span>
        </div>
      </div>
    );
  }

  const isCompleted = data.status === "COMPLETED";
  const isInProgress = data.status === "IN_PROGRESS";
  const isWaiting = data.status === "WAITING";

  return (
    <div className={`min-h-screen flex flex-col ${
      isInProgress ? "bg-gradient-to-b from-green-50 to-white" :
      isCompleted ? "bg-gray-50" : "bg-gradient-to-b from-blue-50 to-white"
    }`}>
      {/* Header */}
      <div className="pt-6 pb-3 px-4 text-center">
        <img src="/logo.png" alt="NeuroFax-B" className="h-8 mx-auto mb-1" />
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
              isCompleted ? "bg-gray-400" : "bg-gradient-to-br from-[#1B4F7A] to-[#2a6ea8]"
            }`}>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-[0.2em] mb-2">Ваш талон</p>
              <p className="text-white text-6xl font-bold font-mono tracking-wider">{data.ticketNumber}</p>
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

              {isWaiting && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                        <Clock className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800">Ожидание</p>
                        <p className="text-xs text-gray-500">Перед вами: {Math.max(0, data.position - 1)} чел.</p>
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
                  {data.totalWaiting > 0 && (
                    <div>
                      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-1000"
                          style={{ width: `${Math.max(8, ((data.totalWaiting - data.position + 1) / data.totalWaiting) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] text-gray-400">{data.position} из {data.totalWaiting}</span>
                        <span className="text-[10px] text-gray-400">~{data.etaMinutes} мин</span>
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
