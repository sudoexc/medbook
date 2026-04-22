import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        success:
          "border-transparent bg-success/15 text-[color:var(--success)]",
        warning:
          "border-transparent bg-warning/20 text-[color:var(--warning-foreground)]",
        info:
          "border-transparent bg-info/15 text-[color:var(--info)]",
        destructive:
          "border-transparent bg-destructive/10 text-destructive",
        violet:
          "border-transparent bg-violet/15 text-[color:var(--violet)]",
        pink:
          "border-transparent bg-pink/15 text-[color:var(--pink)]",
        yellow:
          "border-transparent bg-yellow/30 text-[color:var(--yellow-foreground)]",
        muted:
          "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
