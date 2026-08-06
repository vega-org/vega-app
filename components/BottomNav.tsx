"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Film, Tv, Search, Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export default function BottomNav() {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Home", icon: Home, active: pathname === "/" },
    { href: "/movies", label: "Movie", icon: Film, active: pathname?.startsWith("/movies") },
    { href: "/series", label: "TV Show", icon: Tv, active: pathname?.startsWith("/series") },
    { href: "/search", label: "Search", icon: Search, active: pathname?.startsWith("/search") },
    { href: "/games", label: "Games", icon: Gamepad2, active: false },
  ];

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0e0e12]/95 backdrop-blur-xl border-t border-white/[0.06] safe-area-pb">
      <div className="flex items-center justify-around px-2 py-1.5">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl text-[10px] font-medium transition-all",
              it.active ? "text-white" : "text-white/40"
            )}
          >
            <it.icon className={cn("w-5 h-5", it.active ? "text-white" : "text-white/40")} />
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
