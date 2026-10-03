/**
 * Viewport checks for client components. Client-safe; false on the server.
 */

/**
 * Narrower than Tailwind's `md` (768 px): a phone. The CRM and cabinet
 * sidebars start collapsed there when nobody chose otherwise, since the
 * 240 px rail left a 390 px screen about 150 px of page.
 */
export function isPhoneViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px)").matches
  );
}
