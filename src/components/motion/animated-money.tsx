"use client";

import * as React from "react";

import { useCountUp } from "@/components/atoms/count-up";
import { MoneyText } from "@/components/atoms/money-text";

/**
 * Money tile that counts up from 0 to `amount` (tiins). Wraps `MoneyText`
 * so it inherits the same currency/locale formatting.
 */
export function AnimatedMoney({
  amount,
  currency = "UZS",
  className,
  durationMs = 800,
}: {
  amount: number;
  currency?: "UZS" | "USD";
  className?: string;
  durationMs?: number;
}) {
  const v = useCountUp(amount, durationMs);
  return (
    <MoneyText
      amount={Math.round(v)}
      currency={currency}
      className={className}
    />
  );
}
