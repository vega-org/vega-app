"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { Post } from "@/lib/vega/types";
import { useState } from "react";

interface Props {
  post: Post;
  size?: "sm" | "md" | "lg";
  index?: number;
}

export default function PosterCard({ post, size = "md", index }: Props) {
  const [imgError, setImgError] = useState(false);
  const href = `/title?link=${encodeURIComponent(post.link)}&title=${encodeURIComponent(post.title)}`;

  const sizing =
    size === "sm"
      ? "w-[136px] sm:w-[150px]"
      : size === "lg"
      ? "w-[180px] sm:w-[210px]"
      : "w-[150px] sm:w-[168px]";

  const isHindi = post.title.toLowerCase().includes("hindi") || post.title.includes("[Hindi]") || Math.random() > 0.6;

  return (
    <Link href={href} className={`group relative flex-shrink-0 ${sizing} select-none`} draggable={false}>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-[#1a1a20] border border-white/[0.06]">
        {!imgError ? (
          <img
            src={post.image}
            alt={post.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1e1e24] to-[#0f0f13] p-3">
            <span className="text-[12px] font-semibold text-white/50 text-center line-clamp-3">{post.title}</span>
          </div>
        )}

        {/* Top Hindi badge like MovieBox */}
        {isHindi && (
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] font-bold text-white border border-white/10">Hindi</div>
        )}

        {typeof index === "number" && index < 10 && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white text-black flex items-center justify-center text-[10px] font-bold">
            {index + 1}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
          <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-xl">
            <Play className="w-4 h-4 fill-black ml-0.5" />
          </div>
        </div>

        <div className="absolute bottom-1 left-1 right-1 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-white text-black">HD</span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-black/60 text-white border border-white/10">4K</span>
        </div>
      </div>

      <div className="mt-2">
        <h3 className="text-[12px] leading-[1.25] font-medium text-white/85 group-hover:text-white line-clamp-2">{post.title}</h3>
      </div>
    </Link>
  );
}
