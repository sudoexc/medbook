import { SiteGoalTracker } from "./site-goal-tracker";

/**
 * Yandex Metrika for the public site: visits, sources, click map, session
 * replay, plus the clinic's own goals (see SiteGoalTracker).
 *
 * The counter id is read from the server environment at request time, not
 * baked in at build time, so it is switched on by adding
 * `YANDEX_METRIKA_ID=<number>` to the prod `.env` and recreating the app
 * container. With no id the site renders exactly as before.
 */
export function YandexMetrika() {
  const raw = process.env.YANDEX_METRIKA_ID?.trim();
  // Digits only: the value is interpolated into an inline script.
  if (!raw || !/^\d{5,12}$/.test(raw)) return null;
  const id = Number(raw);

  const snippet = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");window.__ymId=${id};ym(${id},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: snippet }} />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://mc.yandex.ru/watch/${id}`}
          style={{ position: "absolute", left: "-9999px" }}
          alt=""
        />
      </noscript>
      <SiteGoalTracker />
    </>
  );
}
