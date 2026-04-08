"use client";

export function ScrollToButton({
  targetId,
  children,
}: {
  targetId: string;
  children: React.ReactElement;
}) {
  return (
    <div onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" })}>
      {children}
    </div>
  );
}
