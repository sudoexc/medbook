"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { Banknote, CheckCircle, AlertCircle, Filter, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDoctors } from "@/components/providers/doctors-provider";
import type { Locale } from "@/types";

interface PaymentItem {
  id: string;
  amount: number;
  method: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  appointment: {
    id: string;
    service: string | null;
    date: string;
    patient: { id: string; fullName: string; phone: string };
    doctor: { id: string; nameRu: string; nameUz: string };
  };
}

const t = {
  ru: {
    title: "Касса",
    all: "Все",
    paid: "Оплачено",
    unpaid: "Долги",
    total: "Итого",
    paidTotal: "Оплачено",
    debt: "Задолженность",
    patient: "Пациент",
    service: "Услуга",
    amount: "Сумма",
    method: "Способ",
    status: "Статус",
    date: "Дата",
    doctor: "Врач",
    markPaid: "Оплатить",
    markUnpaid: "Отменить",
    cash: "Наличные",
    card: "Карта",
    transfer: "Перевод",
    noPayments: "Нет платежей",
    sum: "сум",
    from: "От",
    to: "До",
    filter: "Фильтр",
  },
  uz: {
    title: "Kassa",
    all: "Hammasi",
    paid: "To'langan",
    unpaid: "Qarzlar",
    total: "Jami",
    paidTotal: "To'langan",
    debt: "Qarzdorlik",
    patient: "Bemor",
    service: "Xizmat",
    amount: "Summa",
    method: "Usul",
    status: "Status",
    date: "Sana",
    doctor: "Shifokor",
    markPaid: "To'lash",
    markUnpaid: "Bekor",
    cash: "Naqd",
    card: "Karta",
    transfer: "O'tkazma",
    noPayments: "To'lovlar yo'q",
    sum: "so'm",
    from: "Dan",
    to: "Gacha",
    filter: "Filtr",
  },
};

function formatMoney(n: number): string {
  return n.toLocaleString("ru-RU").replace(/,/g, " ");
}

export default function PaymentsPage() {
  const locale = useLocale() as Locale;
  const labels = t[locale];
  const { data: session } = useSession();
  const doctors = useDoctors();

  const isAdmin = session?.user?.role === "ADMIN";

  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [summary, setSummary] = useState({ totalAmount: 0, paidAmount: 0, unpaidAmount: 0 });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);

  const fetchPayments = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (doctorFilter) params.set("doctorId", doctorFilter);

    const res = await fetch(`/api/payments?${params}`);
    if (res.ok) {
      const data = await res.json();
      setPayments(data.payments);
      setSummary(data.summary);
    }
  }, [dateFrom, dateTo, statusFilter, doctorFilter]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  async function togglePaymentStatus(id: string, currentStatus: string) {
    const newStatus = currentStatus === "PAID" ? "UNPAID" : "PAID";
    await fetch("/api/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus }),
    });
    fetchPayments();
  }

  const methodLabels: Record<string, string> = {
    CASH: labels.cash,
    CARD: labels.card,
    TRANSFER: labels.transfer,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{labels.title}</h1>
        <a
          href={`/api/export?type=payments&from=${dateFrom}&to=${dateTo}${doctorFilter ? `&doctorId=${doctorFilter}` : ""}`}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary transition-colors"
        >
          <Download className="h-4 w-4" />
          Excel
        </a>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{formatMoney(summary.totalAmount)} <span className="text-sm font-normal text-muted-foreground">{labels.sum}</span></p>
              <p className="text-xs text-muted-foreground">{labels.total}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-600">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{formatMoney(summary.paidAmount)} <span className="text-sm font-normal text-muted-foreground">{labels.sum}</span></p>
              <p className="text-xs text-muted-foreground">{labels.paidTotal}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{formatMoney(summary.unpaidAmount)} <span className="text-sm font-normal text-muted-foreground">{labels.sum}</span></p>
              <p className="text-xs text-muted-foreground">{labels.debt}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-border/40 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {/* Status tabs */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["all", "PAID", "UNPAID"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === s ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                }`}
              >
                {s === "all" ? labels.all : s === "PAID" ? labels.paid : labels.unpaid}
              </button>
            ))}
          </div>
          {/* Date range */}
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground text-xs">{labels.from}</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-border px-2 py-1 text-sm" />
            <span className="text-muted-foreground text-xs">{labels.to}</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-border px-2 py-1 text-sm" />
          </div>
          {/* Doctor filter */}
          {isAdmin && (
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            >
              <option value="">{labels.doctor}: {labels.all}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name[locale]}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Payments table */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/30">
                <th className="px-5 py-3 text-left font-semibold">{labels.patient}</th>
                <th className="px-5 py-3 text-left font-semibold">{labels.service}</th>
                {isAdmin && <th className="px-5 py-3 text-left font-semibold">{labels.doctor}</th>}
                <th className="px-5 py-3 text-left font-semibold">{labels.amount}</th>
                <th className="px-5 py-3 text-left font-semibold">{labels.method}</th>
                <th className="px-5 py-3 text-left font-semibold">{labels.status}</th>
                <th className="px-5 py-3 text-left font-semibold">{labels.date}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="px-5 py-12 text-center text-muted-foreground">
                    {labels.noPayments}
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-5 py-3">
                      <a href={`/${locale}/dashboard/patients/${p.appointment.patient.id}`} className="font-medium hover:text-primary transition-colors">
                        {p.appointment.patient.fullName}
                      </a>
                      <p className="text-xs text-muted-foreground">{p.appointment.patient.phone}</p>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{p.appointment.service || "—"}</td>
                    {isAdmin && (
                      <td className="px-5 py-3">{locale === "ru" ? p.appointment.doctor.nameRu : p.appointment.doctor.nameUz}</td>
                    )}
                    <td className="px-5 py-3 font-semibold tabular-nums">{formatMoney(p.amount)}</td>
                    <td className="px-5 py-3">{methodLabels[p.method] || p.method}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${
                        p.status === "PAID" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                      }`}>
                        {p.status === "PAID" ? labels.paid : labels.unpaid}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {new Date(p.appointment.date).toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ")}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => togglePaymentStatus(p.id, p.status)}
                          className={`h-7 rounded-lg px-2 text-xs ${
                            p.status === "UNPAID" ? "text-green-600 hover:text-green-700 hover:bg-green-50" : "text-muted-foreground hover:bg-secondary"
                          }`}
                        >
                          {p.status === "UNPAID" ? labels.markPaid : labels.markUnpaid}
                        </Button>
                        <a
                          href={`/${locale}/dashboard/print?type=receipt&id=${p.id}`}
                          target="_blank"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
