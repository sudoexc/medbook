import * as React from "react"

import { Button } from "@/components/ui/button"

type ButtonProps = React.ComponentProps<typeof Button>

export interface IconButtonProps extends Omit<ButtonProps, "size"> {
  size?: "xs" | "sm" | "default" | "lg"
  "aria-label": string
}

const SIZE_MAP = {
  xs: "icon-xs",
  sm: "icon-sm",
  default: "icon",
  lg: "icon-lg",
} as const

/**
 * Square button for a single icon. Requires `aria-label` for a11y.
 */
export function IconButton({ size = "default", ...props }: IconButtonProps) {
  return <Button size={SIZE_MAP[size] as ButtonProps["size"]} {...props} />
}
