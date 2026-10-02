/**
 * Where the staff's light/dark choice applies (audit LD-17).
 *
 * The theme is one `localStorage.theme` key per origin, toggled in the CRM and
 * the doctor's cabinet, and it used to put `dark` on `<html>` on every page of
 * the origin. The public site, the paper-ticket pages and the sign-up are
 * built light (white sections, dialogs portalled to `<body>`), so on a
 * reception computer with the dark theme the site showed near-white text on
 * white: exactly where it is shown to patients. Now only the staff surfaces
 * follow the choice and every other page is light. Pure and client-safe.
 */

/**
 * Staff surfaces: the CRM and the doctor's cabinet (with or without a locale
 * prefix), the platform admin and the staff sign-in. «/doctor» is matched as
 * a whole segment so the public «/doctors/<id>» pages stay light.
 */
export const STAFF_THEMED_PATH =
  /^\/(?:(?:ru|uz)\/)?(?:crm|doctor)(?:\/|$)|^\/(?:admin|login)(?:\/|$)/;

/** Whether the staff theme choice applies on `pathname`. */
export function staffThemeApplies(pathname: string | null | undefined): boolean {
  return !!pathname && STAFF_THEMED_PATH.test(pathname);
}

/**
 * Inline FOUC guard for the root layout: paints the right class before the
 * first frame. Same rule as `staffThemeApplies`, built from the same regexp so
 * the two cannot drift. Defaults to light unless the user chose dark, or
 * system with a dark OS, and only on a staff surface.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=new RegExp(${JSON.stringify(
  STAFF_THEMED_PATH.source,
)}).test(location.pathname);var t=localStorage.getItem('theme');var d=s&&(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));var r=document.documentElement;if(d){r.classList.add('dark');r.style.colorScheme='dark'}else{r.style.colorScheme='light'}}catch(e){}})();`;
