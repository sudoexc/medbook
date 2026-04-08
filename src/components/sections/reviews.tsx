"use client";

import { useTranslations } from "next-intl";
import { Star, ExternalLink } from "lucide-react";

const REVIEWS = [
  {
    id: "1",
    authorName: "Sadoqat Hasan",
    rating: 5,
    text: "С 6 месячным ребенком была у невропотолога-педиатра. Врач был с большим стажем работы все коротко и ясно объяснила что к чему и быстро диагностировала малыша. Спасибо большое УЗИсту очень тщательно все проверила.",
    date: "14 ноября 2025",
  },
  {
    id: "2",
    authorName: "Евгения Мищенко",
    rating: 5,
    text: "Делюсь отличным врачом! Невропатолог Азиз Султанов (клиника «Neurofax») — это просто находка. Была у него два раза. Все четко, по делу, без лишнего. Все объясняет понятным языком, назначения сразу помогли. Очень рекомендую! Теперь только к нему.",
    date: "30 октября 2025",
  },
  {
    id: "3",
    authorName: "Румия Рафаэловна",
    rating: 5,
    text: "Невропатолог Бахтиер ака, самый лучший в мире, я не могу словами передать, спасибо Вам большое Бахтиер ака, моя мамочка успокоилась, Вы лучший доктор, дай Бог Вам долгих лет жизни, то что Вы делаете это бесценно.",
    date: "20 октября 2025",
  },
  {
    id: "4",
    authorName: "Зиёда Салахиддинова",
    rating: 5,
    text: "Советую, Грамотно лечат, огромное спасибо Азизу Бахтияровичу и Бахтиёр ака",
    date: "29 декабря 2025",
  },
  {
    id: "5",
    authorName: "Тохир Дадажанов",
    rating: 5,
    text: "Врач суперклассный. Невропатолог высшего уровня. Врач Бахтиёр ака. Надо приходить пораньше чтобы занять очередь.",
    date: "8 апреля 2025",
  },
  {
    id: "6",
    authorName: "Регина Ахмадишина",
    rating: 5,
    text: "Лучший невропатолог которого можно только найти, что бы попасть приезжайте пораньше, очередь живая и не маленькая.",
    date: "19 мая 2025",
  },
];

const YANDEX_URL = "https://yandex.com/maps/org/neyrofaks_b/85279497169/reviews/";

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= rating ? "fill-amber-400 text-amber-400" : "text-gray-200"}`}
        />
      ))}
    </div>
  );
}

export function Reviews() {
  const t = useTranslations("reviews");

  return (
    <section id="reviews" className="py-16 sm:py-20 bg-[#f8f9fa]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
              {t("title")}
            </h2>
            <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
          </div>
          <a
            href={YANDEX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-border bg-white px-5 py-3 hover:shadow-md transition-shadow"
          >
            <div className="text-right">
              <div className="flex items-center gap-1">
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                <span className="text-xl font-bold">5.0</span>
              </div>
              <p className="text-xs text-muted-foreground">250+ отзывов</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-secondary/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" />
                <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor" fontWeight="bold">Я</text>
              </svg>
              {t("source")}
              <ExternalLink className="h-3 w-3" />
            </div>
          </a>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((review) => (
            <div
              key={review.id}
              className="rounded-xl border border-border bg-white p-5 flex flex-col"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {review.authorName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{review.authorName}</p>
                    <p className="text-xs text-muted-foreground">{review.date}</p>
                  </div>
                </div>
                <StarRating rating={review.rating} />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                {review.text}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center">
          <a
            href={YANDEX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium hover:bg-secondary transition-colors"
          >
            {t("allReviews")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
