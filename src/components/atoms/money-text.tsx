import { useLocale } from "next-intl";
import { formatMoney, formatMoneyDual, type Currency, type Locale } from "@/lib/format";

/**
 * Display a money amount with correct locale/currency formatting.
 *
 * Basic:
 *   <MoneyText amount={150000000} currency="UZS" />         → "1 500 000 сум"
 *   <MoneyText amount={12550}     currency="USD" />         → "$125.50"
 *
 * Dual (primary UZS + secondary USD in small grey):
 *   <MoneyText amount={150000000} currency="UZS" showDual usdAmount={12550} />
 *     → "1 500 000 сум ≈ $125.50"
 *
 * `amount` is in minor units (tiins for UZS, cents for USD) — see `formatMoney`.
 *
 * NOTE: This is a stub owned by `design-system-builder`; the formatting
 * contract (what strings come out) is owned by `i18n-specialist`.
 */

export interface MoneyTextProps {
  amount: number | bigint | null | undefined;
  currency: Currency;
  /** When true and currency is UZS, render USD equivalent in small grey. */
  showDual?: boolean;
  /** USD amount in cents. Required when `showDual` is true. */
  usdAmount?: number | bigint | null;
  /** Optional locale override; defaults to the active next-intl locale. */
  locale?: Locale;
  className?: string;
}

export function MoneyText({
  amount,
  currency,
  showDual = false,
  usdAmount = null,
  locale: localeProp,
  className,
}: MoneyTextProps) {
  // useLocale is safe in both server and client components under next-intl.
  const contextLocale = useLocale() as Locale;
  const activeLocale = localeProp ?? contextLocale ?? "ru";

  if (showDual && currency === "UZS") {
    const { primary, secondary } = formatMoneyDual(amount, usdAmount, activeLocale);
    return (
      <span className={className}>
        <span>{primary}</span>
        {secondary && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            ≈ {secondary}
          </span>
        )}
      </span>
    );
  }

  return <span className={className}>{formatMoney(amount, currency, activeLocale)}</span>;
}
