"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const nextTheme =
    theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const label = mounted
    ? `Switch to ${nextTheme} theme`
    : "Switch color theme";

  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={label}
      suppressHydrationWarning
    >
      {!mounted || theme === "system" ? (
        <Monitor className="h-4 w-4" aria-hidden="true" />
      ) : theme === "dark" ? (
        <Moon className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Sun className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
