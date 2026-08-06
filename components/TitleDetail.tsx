"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Play, Plus, Star, Calendar, Clock, Share2, Subtitles, Volume2 } from "lucide-react";
import { Info, EpisodeLink } from "@/lib/vega/types";

export default function TitleDetailClient() {
  const searchParams = useSearchParams();
  const link = searchParams.get("link") || "";
  const [meta, setMeta] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string>("");
  const [episodes, setEpisodes] = useState<EpisodeLink[]>([]);
  const [epLoading, setEpLoading] = useState(false);
  const lastLinkRef = useRef<string>("");

  useEffect(() => {
    if (!link) return;
    // Reset all state when link changes - fixes cache bug where old content shows
    if (lastLinkRef.current !== link) {
      setMeta(null);
      setEpisodes([]);
      setSelectedSeason("");
      setError(null);
      lastLinkRef.current = link;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/meta?link=${encodeURIComponent(link)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.success) {
          setMeta(data.meta);
          if (data.meta.linkList?.length) {
            const first = data.meta.linkList[0];
            if (first.episodesLink) setSelectedSeason(first.episodesLink);
          }
        } else setError(data.error);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [link]);

  useEffect(() => {
    if (!selectedSeason) return;
    const controller = new AbortController();
    setEpLoading(true);
    setEpisodes([]); // clear old episodes when season changes
    fetch(`/api/episodes?url=${encodeURIComponent(selectedSeason)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted && data.success) setEpisodes(data.episodes);
      })
      .finally(() => {
        if (!controller.signal.aborted) setEpLoading(false);
      });
    return () => controller.abort();
  }, [selectedSeason]);

  const handlePlayMovie = (directLink: string) => {
    window.location.href = `/watch?link=${encodeURIComponent(directLink)}&poster=${encodeURIComponent(meta?.image || "")}&title=${encodeURIComponent(meta?.title || "")}`;
  };
  const handlePlayEpisode = (epLink: string, epTitle: string) => {
    window.location.href = `/watch?link=${encodeURIComponent(epLink)}&poster=${encodeURIComponent(meta?.image || "")}&title=${encodeURIComponent(`${meta?.title} - ${epTitle}`)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] animate-pulse">
        <div className="h-[60vw] max-h-[720px] bg-[#18181b]" />
        <div className="mx-auto max-w-[1600px] px-6 py-8 space-y-4">
          <div className="h-8 w-1/3 bg-[#18181b] rounded" />
          <div className="h-24 bg-[#18181b] rounded" />
        </div>
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-white/10 mx-auto flex items-center justify-center mb-4">!</div>
          <h2 className="text-xl font-bold mb-2">Couldn't load title</h2>
          <p className="text-white/60 text-sm mb-6">{error || "Unknown"}</p>
          <Link href="/" className="inline-flex h-10 px-6 rounded-lg bg-white text-black font-semibold items-center">Home</Link>
        </div>
      </div>
    );
  }

  const isSeries = meta.type === "series";

  return (
    <div className="min-h-screen bg-[#0a0a0b]">
      <div className="relative">
        <div className="absolute inset-0 h-[70vw] max-h-[860px] overflow-hidden">
          <img src={meta.image} alt={meta.title} className="w-full h-full object-cover object-top scale-[1.02]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/70 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0b] via-[#0a0a0b]/50 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 pt-5 sm:pt-8 pb-10">
          <Link href="/" className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-black/60 backdrop-blur border border-white/10 text-[13px] font-medium hover:bg-black/80 mb-6 sm:mb-10">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-8 lg:gap-10 items-end mt-8 sm:mt-20">
            <div className="hidden lg:block">
              <div className="relative aspect-[2/3] rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                <img src={meta.image} alt={meta.title} className="w-full h-full object-cover" />
              </div>
            </div>

            <div className="space-y-4 sm:space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded bg-white text-black text-[10px] font-bold tracking-widest">{isSeries ? "SERIES" : "MOVIE"}</span>
                {meta.rating && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 border border-white/10 text-[11px] font-medium">
                    <Star className="w-3 h-3 fill-white" /> {meta.rating}
                  </span>
                )}
                {meta.tags?.slice(0, 3).map((t) => (
                  <span key={t} className="px-2 py-1 rounded bg-white/10 text-[11px]">{t}</span>
                ))}
              </div>

              <h1 className="font-extrabold text-[28px] sm:text-[44px] lg:text-[52px] leading-[0.95] tracking-tight drop-shadow-[0_8px_24px_rgba(0,0,0,0.6)]">{meta.title}</h1>

              <div className="flex flex-wrap items-center gap-2 text-[13px] text-white/60">
                <span className="inline-flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {meta.tags?.find((t) => /^\d{4}$/.test(t)) || new Date().getFullYear()}</span>
                <span className="w-1 h-1 rounded-full bg-white/30" />
                <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> {isSeries ? `${episodes.length} Ep` : "HD"}</span>
                <span className="w-1 h-1 rounded-full bg-white/30" />
                <span className="inline-flex items-center gap-1.5"><Subtitles className="w-4 h-4" /> Subs</span>
                <span className="w-1 h-1 rounded-full bg-white/30" />
                <span className="inline-flex items-center gap-1.5"><Volume2 className="w-4 h-4" /> 4K</span>
              </div>

              <p className="text-[14px] sm:text-[15px] leading-[1.6] text-white/75 max-w-[640px]">{meta.synopsis}</p>

              {meta.cast && meta.cast.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {meta.cast.slice(0, 6).map((c) => (
                    <span key={c} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[12px] text-white/70">{c}</span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {!isSeries && meta.linkList[0]?.directLinks?.[0] && (
                  <button onClick={() => handlePlayMovie(meta.linkList[0].directLinks![0].link)} className="inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-white text-black font-bold text-[15px] hover:bg-white/90">
                    <Play className="w-5 h-5 fill-black" /> Play
                  </button>
                )}
                {isSeries && episodes.length > 0 && (
                  <button onClick={() => handlePlayEpisode(episodes[0].link, episodes[0].title)} className="inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-white text-black font-bold text-[15px] hover:bg-white/90">
                    <Play className="w-5 h-5 fill-black" /> Play S01 E01
                  </button>
                )}
                <button className="h-12 px-6 rounded-xl bg-white/10 border border-white/10 font-semibold text-[14px] hover:bg-white/15">+ My List</button>
                <button className="w-12 h-12 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center hover:bg-white/15">
                  <Share2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {isSeries ? (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-[20px] font-bold tracking-tight">Episodes • {episodes.length}</h2>
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {meta.linkList.map((l, idx) => (
                  <button key={idx} onClick={() => setSelectedSeason(l.episodesLink || "")} className={`px-4 py-2 rounded-lg text-[13px] font-semibold whitespace-nowrap border ${selectedSeason === l.episodesLink ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"}`}>
                    {l.title}
                  </button>
                ))}
              </div>
            </div>

            {epLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-[#18181b] animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {episodes.map((ep, idx) => (
                  <button key={`${ep.link}-${idx}`} onClick={() => handlePlayEpisode(ep.link, ep.title)} className="group text-left flex gap-3 p-3 rounded-xl bg-[#151518] border border-white/5 hover:border-white/15 hover:bg-[#1c1c20] transition-all">
                    <div className="w-11 h-11 rounded-lg bg-white/10 flex items-center justify-center font-bold text-xs group-hover:bg-white group-hover:text-black">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[13px] truncate">{ep.title}</div>
                      <div className="text-[11px] text-white/40 mt-1">HD • 24m</div>
                    </div>
                    <Play className="w-4 h-4 text-white/20 group-hover:text-white/60 mt-1" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-[20px] font-bold tracking-tight">Available Audio</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {meta.linkList.map((src, idx) => (
                <div key={idx} className="rounded-xl bg-[#151518] border border-white/5 p-4 space-y-3">
                  <div className="font-medium text-[13px]">{src.title}</div>
                  <div className="space-y-2">
                    {src.directLinks?.map((dl, j) => (
                      <button key={j} onClick={() => handlePlayMovie(dl.link)} className="w-full flex items-center justify-between p-3 rounded-lg bg-white text-black font-semibold text-[13px] hover:bg-white/90">
                        <span className="flex items-center gap-2"><Play className="w-4 h-4 fill-black" /> {dl.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-black text-white">HD</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
