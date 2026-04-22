"use client"

import * as React from "react"
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes"

/**
 * Thin wrapper around `next-themes` so the rest of the app can import from a
 * stable path. Defaults: attribute="class", dark-mode via `.dark` on `<html>`.
 */
export function ThemeProvider(props: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    />
  )
}
