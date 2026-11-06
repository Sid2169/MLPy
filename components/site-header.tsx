"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Github, Menu, X } from "lucide-react";
import { SearchDialog } from "@/components/search-dialog";
import {
  SidebarContent,
  type SidebarChapter,
} from "@/components/sidebar-nav";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({ chapters }: { chapters: SidebarChapter[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            className="icon-button lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open course navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="hidden text-sm font-semibold text-slate-900 dark:text-slate-100 sm:block lg:hidden">
              MLPy
            </span>
            <SearchDialog />
          </div>

          <div className="flex items-center gap-1.5">
            <a
              href="https://github.com/Sid2169/MLPy"
              target="_blank"
              rel="noreferrer"
              className="icon-button hidden sm:inline-flex"
              aria-label="View the course repository on GitHub"
              title="GitHub repository"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
            role="presentation"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[min(20rem,88vw)] border-r border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              className="icon-button absolute right-3 top-3 z-10"
              onClick={() => setMobileOpen(false)}
              aria-label="Close course navigation"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <SidebarContent
              chapters={chapters}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
