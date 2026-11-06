"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useNavigate } from "@/components/navigation-provider";

type Props = Omit<ComponentProps<typeof NextLink>, "href"> & { href: string };

// Keep Next's prefetching and link semantics, but own the transition in the
// persistent provider so feedback survives a closing mobile menu/search dialog.
export default function NavigationLink({ href, onNavigate, replace, scroll, ...props }: Props) {
  const navigate = useNavigate();
  return <NextLink {...props} href={href} replace={replace} scroll={scroll} onNavigate={(event) => {
    let prevented = false;
    onNavigate?.({ preventDefault: () => { prevented = true; event.preventDefault(); } });
    if (prevented) return;
    const destination = new URL(href, window.location.href);
    if (destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname && destination.search === window.location.search)) return;
    event.preventDefault();
    navigate(href, { replace, scroll });
  }} />;
}
