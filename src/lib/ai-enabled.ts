/**
 * Global kill-switch for the AI feature surface.
 *
 * AI work is paused, so every AI-facing panel is either hidden or shown in an
 * "in development" dimmed state until this flips back to `true`. Flip this one
 * boolean to bring the whole AI surface back at once.
 *
 * Kept prisma-free and dependency-free so client components can import it
 * without dragging anything into the browser bundle.
 */
export const AI_ENABLED = false;
