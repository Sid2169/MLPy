"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { ProgressProvider } from "@/components/progress-provider";
import { NavigationProvider } from "@/components/navigation-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <NavigationProvider><ProgressProvider>{children}</ProgressProvider></NavigationProvider>
    </ThemeProvider>
  );
}
