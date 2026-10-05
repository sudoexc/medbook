"use client"

import { useTheme } from "@/components/providers/theme-provider"
import { isReceptionTabletPath } from "@/lib/reception-tablet/access"
import { cn } from "@/lib/utils"
import { usePathname } from "next/navigation"
import { Toaster as Sonner } from "sonner"
import type { CSSProperties, ComponentProps } from "react"

type ToasterProps = ComponentProps<typeof Sonner>

/**
 * Toast host using Sonner. Mount once in the root layout. Call `toast()` from
 * anywhere to fire notifications. See https://sonner.emilkowal.ski/
 */
function Toaster({ className, style, ...props }: ToasterProps) {
  // The painted theme, not the stored choice: off the staff surfaces the
  // page is light whatever is stored (audit LD-17).
  const { resolvedTheme } = useTheme()
  // The reception iPad page is read from arm's length and worked with a
  // finger: its toasts get its own text and button sizes (`.toaster-tablet`
  // in globals.css) and a wider card, whoever fired them.
  const tablet = isReceptionTabletPath(usePathname())

  return (
    <Sonner
      theme={resolvedTheme}
      className={cn("toaster group", tablet && "toaster-tablet", className)}
      style={tablet ? ({ "--width": "26rem", ...style } as CSSProperties) : style}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
export { toast } from "sonner"
