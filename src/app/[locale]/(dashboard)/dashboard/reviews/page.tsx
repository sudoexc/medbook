"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "next-intl";
import { Star, Plus, Trash2, Eye, EyeOff, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Review {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  source: string;
  visible: boolean;
  publishedAt: string;
  createdAt: string;
}

const t = {
  ru: {
    title: "Отзывы",
    addReview: "Добавить отзыв",
    author: "Автор",
    rating: "Оценка",
    text: "Текст отзыва",
    source: "Источник",
    date: "Дата",
    save: "Сохранить",
    cancel: "Отмена",
    delete: "Удалить",
    noReviews: "Нет отзывов",
    yandex: "Яндекс Карты",
    google: "Google",
    manual: "Вручную",
    visible: "Виден",
    hidden: "Скрыт",
    total: "Всего отзывов",
    avgRating: "Средний рейтинг",
  },
  uz: {
    title: "Sharhlar",
    addReview: "Sharh qo'shish",
    author: "Muallif",
    rating: "Baho",
    text: "Sharh matni",
    source: "Manba",
    date: "Sana",
    save: "Saqlash",
    cancel: "Bekor",
    delete: "O'chirish",
    noReviews: "Sharhlar yo'q",
    yandex: "Yandex Xaritalar",
    google: "Google",
    manual: "Qo'lda",
    visible: "Ko'rinadi",
    hidden: "Yashirin",
    total: "Jami sharhlar",
    avgRating: "O'rtacha baho",
  },
};

export default function ReviewsPage() {
  const locale = useLocale() as "ru" | "uz";
  const labels = t[locale];
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ authorName: "", rating: 5, text: "", source: "yandex", publishedAt: new Date().toISOString().split("T")[0] });

  const fetchReviews = useCallback(async () => {
    const res = await fetch("/api/reviews?all=true");
    if (res.ok) setReviews(await res.json());
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  async function handleSave() {
    const method = editId ? "PATCH" : "POST";
    const body = editId ? { id: editId, ...form } : form;
    await fetch("/api/reviews", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setShowForm(false);
    setEditId(null);
    setForm({ authorName: "", rating: 5, text: "", source: "yandex", publishedAt: new Date().toISOString().split("T")[0] });
    fetchReviews();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/reviews?id=${id}`, { method: "DELETE" });
    fetchReviews();
  }

  async function toggleVisibility(review: Review) {
    await fetch("/api/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: review.id, visible: !review.visible }),
    });
    fetchReviews();
  }

  function startEdit(review: Review) {
    setEditId(review.id);
    setForm({
      authorName: review.authorName,
      rating: review.rating,
      text: review.text,
      source: review.source,
      publishedAt: review.publishedAt.split("T")[0],
    });
    setShowForm(true);
  }

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : "0";

  const sourceLabels: Record<string, string> = {
    yandex: labels.yandex,
    google: labels.google,
    manual: labels.manual,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{labels.title}</h1>
        <Button onClick={() => { setShowForm(true); setEditId(null); setForm({ authorName: "", rating: 5, text: "", source: "yandex", publishedAt: new Date().toISOString().split("T")[0] }); }} className="gap-2">
          <Plus className="h-4 w-4" />
          {labels.addReview}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm">
          <p className="text-xs text-muted-foreground">{labels.total}</p>
          <p className="text-2xl font-bold">{reviews.length}</p>
        </div>
        <div className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">{labels.avgRating}</p>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold">{avgRating}</p>
            <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
          </div>
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="rounded-2xl border border-border/40 bg-white p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">{labels.author}</label>
              <input
                value={form.authorName}
                onChange={(e) => setForm({ ...form, authorName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{labels.rating}</label>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button key={i} onClick={() => setForm({ ...form, rating: i })}>
                    <Star className={`h-6 w-6 ${i <= form.rating ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">{labels.source}</label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="yandex">{labels.yandex}</option>
                <option value="google">{labels.google}</option>
                <option value="manual">{labels.manual}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">{labels.date}</label>
              <input
                type="date"
                value={form.publishedAt}
                onChange={(e) => setForm({ ...form, publishedAt: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">{labels.text}</label>
            <textarea
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave}>{labels.save}</Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>{labels.cancel}</Button>
          </div>
        </div>
      )}

      {/* Reviews list */}
      <div className="rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
        <div className="divide-y divide-border/40">
          {reviews.length === 0 ? (
            <div className="px-5 py-12 text-center text-muted-foreground">{labels.noReviews}</div>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className={`px-5 py-4 ${!review.visible ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-medium text-sm">{review.authorName}</span>
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Star key={i} className={`h-3.5 w-3.5 ${i <= review.rating ? "fill-amber-400 text-amber-400" : "text-gray-200"}`} />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded">{sourceLabels[review.source] || review.source}</span>
                      <span className="text-xs text-muted-foreground">{new Date(review.publishedAt).toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ")}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{review.text}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => toggleVisibility(review)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" title={review.visible ? labels.visible : labels.hidden}>
                      {review.visible ? <Eye className="h-4 w-4 text-green-600" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    <button onClick={() => startEdit(review)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(review.id)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
