import * as React from "react";

// Wraps case-insensitive matches of `term` inside `text` in <mark>. Returns the
// raw string when term is empty so the chapter/category view pays no regex cost.
export function Highlight({ text, term }: { text: string; term: string }) {
  const re = React.useMemo(
    () =>
      term ? new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi") : null,
    [term],
  );
  if (!re) return <>{text}</>;
  const lower = term.toLowerCase();
  return (
    <>
      {text.split(re).map((p, i) =>
        p.toLowerCase() === lower ? (
          <mark key={i} className="rounded bg-warning/30 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
