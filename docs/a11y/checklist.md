# A11y checklist for page-agents

Target: **WCAG 2.2 AA**. Every CRM and Mini-App page agent MUST tick this
checklist before declaring a page done. Open a follow-up if any item
cannot be satisfied — do not silently skip.

## 1. Landmarks

- [ ] Exactly one `<main>` per route (the CRM layout already provides it —
      do not nest another).
- [ ] Site navigation is inside `<nav>`; `<aside>` for right rails; the
      central scroll column is `<section>` or lives in `<main>`.
- [ ] Each landmark that can coexist with a sibling landmark of the same
      role has a discriminating `aria-label`.

## 2. Headings

- [ ] One `<h1>` per route (usually the page title via `SectionHeader`).
- [ ] Section titles are `<h2>`/`<h3>`; don't skip levels.
- [ ] Heading text is unique enough to be searchable ("Врачи —
      расписание", not "Расписание").

## 3. Interactive elements

- [ ] Every clickable is a real `<button>` / `<a>` (not a `<div>` with
      `onClick`).
- [ ] Icon-only controls have `aria-label` AND `title` (the `title` is
      used by `Button` as a tooltip, `aria-label` by screen readers).
- [ ] Buttons outside the shared `Button` atom expose a visible
      `focus-visible` ring. Tailwind snippet:
      `outline-none focus-visible:ring-2 focus-visible:ring-ring/50`.

## 4. Forms

- [ ] Every `<input>`, `<textarea>`, `<select>` either:
  - has a sibling/parent `<Label htmlFor={id}>` (preferred), OR
  - has an explicit `aria-label`.
- [ ] Validation errors are attached via `aria-describedby` pointing at
      a `<p id={errId}>…</p>` near the field.
- [ ] `aria-invalid={Boolean(error)}` on the field when in error state.
- [ ] Submit is triggered by Enter; Escape closes the containing
      dialog/sheet.
- [ ] Native date/time inputs have `aria-label` when the visible label
      is distant (e.g. range pickers with a single "Период" label).

## 5. Modals / drawers / popovers

- [ ] Use the shared `Dialog`, `Sheet`, `Popover` components. They trap
      focus and restore focus on close — do not reimplement.
- [ ] Every `Dialog` has a `DialogTitle` (even if visually hidden via
      `sr-only`). Radix enforces this at runtime.
- [ ] Esc closes the dialog — verified by default; if you pass
      `onOpenChange`, do NOT swallow the `Escape` key.

## 6. Live regions

- [ ] Any container that updates from polling / SSE / WebSocket without
      user interaction gets `aria-live="polite"` (use `assertive` only
      for alerts).
- [ ] Pair with `aria-atomic="false"` so screen readers announce just
      the changed node, not the whole region.
- [ ] Toasts are fine — `sonner` already sets `role="status"` /
      `aria-live="polite"` on the container.

## 7. Keyboard

- [ ] Tab order flows left-to-right, top-to-bottom. No `tabIndex` > 0.
- [ ] Ctrl/Cmd-K opens the global search (already wired).
- [ ] Arrow keys navigate inside `<Select>`, `<Command>`, `<Tabs>`
      (Radix defaults). Don't rebind them.

## 8. Color / contrast

- [ ] Body text ≥ 4.5:1 against its background.
- [ ] Large (≥ 18pt or 14pt bold) and UI-component text ≥ 3:1.
- [ ] Primary teal (`#3DD5C0`) uses foreground `#0b2e29` — 11:1,
      always safe for dark-on-teal. Never pair `--primary` with white
      text.
- [ ] Never convey meaning by color alone — add an icon, a label, or
      `<span className="sr-only">` helper text.

## 9. Images / icons

- [ ] Decorative icons inside a labelled button: `aria-hidden="true"`.
- [ ] Meaningful images / avatars: `alt="…"` or `aria-label="…"`.
- [ ] Lucide icons without a sibling text node need an adjacent
      `<span className="sr-only">label</span>`.

## 10. Test hook

- [ ] Spec file uses `await checkA11y(page)` from `tests/e2e/helpers.ts`
      on the landing URL of the route.
- [ ] No new entries are added to `CRM_AXE_WHITELIST` without a linked
      issue or a deliberate design decision documented in
      `docs/a11y/phase-N.md`.

## Smoke test (manual, 5 min per page)

1. Tab through every interactive element — the focus ring must be
   visible on every stop.
2. Press Esc on every modal — it must close.
3. Turn on VoiceOver (⌘F5 on macOS) / NVDA — read the page title, the
   primary action, and the first table row. All three must be
   pronounced intelligibly.
4. Zoom to 200 % (Cmd-+ twice) — no horizontal scroll, no clipped text.
5. Resize to 1280×720 — the page must still be fully functional.
