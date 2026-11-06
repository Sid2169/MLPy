"use client";

import { createContext, useCallback, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type NavigationOptions = { replace?: boolean; scroll?: boolean };
type Navigate = (href: string, options?: NavigationOptions) => void;
const NavigationContext = createContext<Navigate | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback<Navigate>((href, options = {}) => {
    startTransition(() => {
      if (options.replace) router.replace(href, { scroll: options.scroll });
      else router.push(href, { scroll: options.scroll });
    });
  }, [router]);

  return <NavigationContext.Provider value={navigate}>
    {children}
    {pending ? <div className="navigation-feedback" role="status" aria-live="polite" aria-atomic="true">
      <div className="navigation-progress-track" aria-hidden="true"><div className="navigation-progress-bar" /></div>
      <span className="navigation-loading-label"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading page…</span>
    </div> : null}
  </NavigationContext.Provider>;
}

export function useNavigate() {
  const navigate = useContext(NavigationContext);
  if (!navigate) throw new Error("useNavigate must be used inside NavigationProvider");
  return navigate;
}
