"use client";

import { useTranslations } from "next-intl";
import { Star, ExternalLink } from "lucide-react";

// Real patient reviews quoted from the clinic's public Yandex Maps page
// (yandex.com/maps/org/neyrofaks_b/85279497169). Not invented — each carries
// its original author + date, and the "read all" link points back to the
// source so anything shown here is verifiable. No aggregate rating/count is
// asserted because those move over time and can't be pinned reliably.
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
    text: "Делюсь отличным врачом! Невропатолог Азиз Султанов (клиника «Neurofax») это просто находка. Была у него два раза. Все четко, по делу, без лишнего. Все объясняет понятным языком, назначения сразу помогли. Очень рекомендую! Теперь только к нему.",
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
    text: "Советую, грамотно лечат, огромное спасибо Азизу Бахтияровичу и Бахтиёр ака.",
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
    text: "Лучший невропатолог которого можно только найти, чтобы попасть приезжайте пораньше, очередь живая и не маленькая.",
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
          className={`h-4 w-4 ${
            i <= rating ? "fill-primary text-primary" : "text-border"
          }`}
        />
      ))}
    </div>
  );
}

export function Reviews() {
  const t = useTranslations("reviews");

  return (
    <section id="reviews" className="border-t border-border bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t("title")}
            </h2>
            <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
          </div>
          <a
            href={YANDEX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {t("source")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((review) => (
            <div
              key={review.id}
              className="flex flex-col rounded-xl border border-border bg-white p-5"
            >
              <div className="mb-3 flex items-center justify-between">
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
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
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
            className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            {t("allReviews")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
