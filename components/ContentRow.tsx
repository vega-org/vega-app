"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Post } from "@/lib/vega/types";
import PosterCard from "./PosterCard";

interface Props {
  title: string;
  posts: Post[];
  subtitle?: string;
  size?: "sm" | "md" | "lg";
  showRank?: boolean;
}

export default function ContentRow({ title, posts, subtitle, size = "md", showRank }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.8;
    scrollRef.current.scrollBy({
      left: dir === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  if (!posts.length) return null;

  return (
    <section className="relative group/row py-5 sm:py-6">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        {/* Header - Max style */}
        <div className="flex items-end justify-between mb-3 sm:mb-4">
          <div>
            <h2 className="font-[700] text-[18px] sm:text-[22px] tracking-[-0.02em] leading-none text-white flex items-center gap-3">
              {title}
              <span className="hidden sm:inline-block w-px h-5 bg-white/10" />
              <span className="hidden sm:inline text-[13px] font-[500] tracking-wide text-white/50">{subtitle || `${posts.length} titles`}</span>
            </h2>
            {subtitle && (
              <p className="sm:hidden mt-1 text-[12px] text-white/50 font-medium tracking-wide">{subtitle}</p>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
            <button
              onClick={() => scroll("left")}
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white border border-white/[0.06] hover:border-white text-white/70 hover:text-black flex items-center justify-center transition-all"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => scroll("right")}
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white border border-white/[0.06] hover:border-white text-white/70 hover:text-black flex items-center justify-center transition-all"
              aria-label="Scroll right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable row */}
      <div
        ref={scrollRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-hide scroll-smooth px-4 sm:px-6 lg:px-8"
        style={{ paddingLeft: "max(1rem, calc((100vw - 1600px)/2 + 1.5rem))" }}
      >
        {posts.map((post, i) => (
          <PosterCard key={`${post.link}-${i}`} post={post} size={size} index={showRank ? i : undefined} />
        ))}
        {/* End spacer */}
        <div className="flex-shrink-0 w-[1rem] sm:w-[1.5rem]" />
      </div>
    </section>
  );
}
