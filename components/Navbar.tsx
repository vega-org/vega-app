"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setMobileOpen(false);
    }
  };

  const navLinks = [
    { href: "/", label: "Home", active: pathname === "/" },
    { href: "/movies", label: "Movies", active: pathname?.startsWith("/movies") },
    { href: "/series", label: "TV Shows", active: pathname?.startsWith("/series") },
  ];

  return (
    <>
      <header className={cn("sticky top-0 z-40 border-b transition-all", scrolled ? "bg-[#08080b]/90 backdrop-blur-xl border-white/[0.06]" : "bg-[#0b0b10] border-white/[0.04]")}>
        <div className="mx-auto max-w-[1600px] px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-[56px] gap-3">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                  <span className="font-black text-[15px] text-black">W</span>
                </div>
                <span className="font-extrabold text-[20px] tracking-tight">WellFlix</span>
              </Link>
              <div className="hidden lg:flex items-center gap-1 ml-6">
                {navLinks.map((l) => (
                  <Link key={l.href} href={l.href} className={cn("px-3.5 py-2 rounded-full text-[13px] font-medium transition-colors", l.active ? "bg-white text-black" : "text-white/60 hover:text-white hover:bg-white/5")}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <form onSubmit={handleSearch} className="hidden md:flex items-center">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search movies, TV shows" className="w-[320px] h-9 pl-9 pr-4 rounded-full bg-[#15151d] border border-white/5 text-[13px] placeholder:text-white/30 focus:outline-none focus:border-white/10 focus:bg-[#1a1a24] transition-all" />
                </div>
              </form>

              <Link href="/search" className="md:hidden w-9 h-9 rounded-full bg-white/5 border border-white/5 flex items-center justify-center">
                <Search className="w-4 h-4" />
              </Link>

              <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden w-9 h-9 rounded-full bg-white text-black flex items-center justify-center">
                {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {mobileOpen && (
            <div className="lg:hidden border-t border-white/5 py-3">
              <form onSubmit={handleSearch} className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search movies, TV shows" className="w-full h-11 pl-10 pr-4 rounded-full bg-[#15151d] border border-white/5 text-[14px] placeholder:text-white/30 focus:outline-none" autoFocus />
              </form>
              <div className="grid grid-cols-3 gap-2">
                {navLinks.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className={cn("py-2.5 rounded-xl text-center text-[13px] font-medium border", l.active ? "bg-white text-black border-white" : "bg-white/5 border-white/5 text-white/60")}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
