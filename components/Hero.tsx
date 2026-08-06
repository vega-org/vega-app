"use client";

import Link from "next/link";
import { Play, Info, Star } from "lucide-react";
import { Post } from "@/lib/vega/types";
import { useState, useEffect } from "react";

interface HeroProps {
  items: Post[];
}

export default function Hero({ items }: HeroProps) {
  const [current, setCurrent] = useState(0);
  const heroItem = items[current];

  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % Math.min(items.length, 6));
    }, 7000);
    return () => clearInterval(id);
  }, [items.length]);

  if (!heroItem) return null;

  const detailHref = `/title?link=${encodeURIComponent(heroItem.link)}`;

  return (
    <div className="relative w-full h-[56vw] min-h-[480px] max-h-[820px] overflow-hidden bg-[#0a0a0b]">
      <div className="absolute inset-0">
        <img src={heroItem.image} alt={heroItem.title} className="w-full h-full object-cover scale-[1.02]" style={{ objectPosition: "center top" }} />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0b] via-[#0a0a0b]/80 via-30% to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/60 via-40% to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0b]/40 via-transparent to-transparent" />
      </div>

      <div className="relative z-10 h-full mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 flex flex-col justify-end sm:justify-center pb-20 sm:pb-0">
        <div className="max-w-[560px] space-y-4 sm:space-y-5 animate-[slideUp_0.6s_ease-out]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded bg-white text-black text-[10px] font-bold tracking-widest">TOP 10</span>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 border border-white/10 text-[11px] font-medium">
              <Star className="w-3 h-3 fill-white" /> 8.4
            </span>
          </div>

          <h1 className="font-[800] text-[32px] sm:text-[48px] lg:text-[54px] leading-[0.95] tracking-[-0.03em] line-clamp-2">{heroItem.title}</h1>

          <p className="text-[14px] sm:text-[15px] leading-[1.5] text-white/70 line-clamp-2 max-w-[500px]">
            Watch in 4K • Dolby Audio • Multi-language • Subtitles
          </p>

          <div className="flex items-center gap-3 pt-1">
            <Link href={`${detailHref}&autoplay=1`} className="inline-flex items-center gap-2 h-11 sm:h-12 px-7 rounded-lg bg-white text-black font-bold text-[14px] hover:bg-white/90 transition-all">
              <Play className="w-5 h-5 fill-black" /> Play
            </Link>
            <Link href={detailHref} className="inline-flex items-center gap-2 h-11 sm:h-12 px-6 rounded-lg bg-white/15 backdrop-blur border border-white/10 text-white font-semibold text-[14px] hover:bg-white/20">
              <Info className="w-5 h-5" /> More Info
            </Link>
          </div>

          <div className="flex items-center gap-1.5 pt-2">
            {items.slice(0, 6).map((_, i) => (
              <button key={i} onClick={() => setCurrent(i)} className={`h-1 rounded-full transition-all ${i === current ? "w-6 bg-white" : "w-1.5 bg-white/30"}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[120px] bg-gradient-to-t from-[#0a0a0b] to-transparent pointer-events-none" />
    </div>
  );
}
