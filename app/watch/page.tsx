"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, Loader2, Play } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { Stream } from "@/lib/vega/types";

function WatchClient() {
  const searchParams = useSearchParams();
  const link = searchParams.get("link") || "";
  const poster = searchParams.get("poster") || "";
  const title = searchParams.get("title") || "WellFlix";
  const lastLinkRef = useRef<string>("");

  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!link) {
      setError("No playback link");
      setLoading(false);
      return;
    }
    // Fix cache bug: reset when link changes
    if (lastLinkRef.current !== link) {
      setStreams([]);
      setError(null);
      lastLinkRef.current = link;
    }
    const controller = new AbortController();
    const fetchStreams = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/stream?link=${encodeURIComponent(link)}`, { cache: "no-store", signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (data.success && data.streams.length > 0) {
          setStreams(data.streams);
        } else {
          setError(data.error || "No sources found. Try another audio or episode.");
        }
      } catch (e: any) {
        if (e.name !== "AbortError") setError(e.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchStreams();
    return () => controller.abort();
  }, [link]);

  return (
    <div className="min-h-screen bg-[#07070a] flex flex-col">
      <div className="flex items-center justify-between px-4 h-[56px] border-b border-white/[0.06] bg-[#0a0a0b] sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Link href="/" className="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center font-extrabold text-sm">W</Link>
          <div className="text-[13px] font-semibold truncate max-w-[220px] sm:max-w-[520px]">{title}</div>
        </div>
        <Link href="/" className="h-8 px-3.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/5 text-xs font-medium flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Home
        </Link>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="flex-1 bg-black relative min-h-[56vh] lg:min-h-0">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0b]">
              <Loader2 className="w-10 h-10 animate-spin text-white/50" />
              <div className="text-center">
                <div className="font-semibold text-sm flex items-center gap-2"><Play className="w-4 h-4" /> Finding best source...</div>
                <div className="text-xs text-white/40 mt-1">Proxy + Auto failover • If one fails tries next</div>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#0a0a0b]">
              <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-[16px] mb-2">Can't play this</h3>
              <p className="text-[13px] text-white/50 max-w-sm mb-5">{error}</p>
              <div className="flex gap-2">
                <button onClick={() => location.reload()} className="h-9 px-4 rounded-lg bg-white text-black text-sm font-semibold">Retry</button>
                <Link href="/" className="h-9 px-4 rounded-lg bg-white/10 text-sm font-medium flex items-center">Browse</Link>
              </div>
              <div className="mt-6 p-3 rounded-xl bg-[#15151a] border border-white/5 text-[11px] text-white/30 max-w-md">
                If demo streams also fail, your IP may be blocking CDN. Try different title or wait — MovieBox tokens expire fast. WellFlix uses /api/proxy with Referer spoofing like MovieBox app.
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 lg:p-2">
              <VideoPlayer streams={streams} poster={poster} title={title} />
            </div>
          )}
        </div>

        <div className="w-full lg:w-[340px] border-t lg:border-t-0 lg:border-l border-white/10 bg-[#0a0a0b] flex flex-col max-h-[42vh] lg:max-h-none lg:h-[calc(100vh-56px)]">
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <h3 className="font-bold text-[12px] tracking-widest">SOURCES • {streams.length}</h3>
            <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 text-[10px] font-bold">AUTO</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)
              : streams.map((s, idx) => (
                  <div key={`${s.link}-${idx}`} className="p-3 rounded-xl bg-[#16161a] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-[13px] truncate flex items-center gap-2">
                        {idx === 0 && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                        <span className="truncate max-w-[160px]">{s.server}</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-black font-bold">{s.quality || "HD"}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">{s.type.toUpperCase()}</span>
                      {s.subtitles && s.subtitles.length > 0 && <span className="text-[10px] text-white/40">{s.subtitles.length} subs</span>}
                    </div>
                    {s.subtitles && s.subtitles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.subtitles.slice(0, 4).map((sub, si) => (
                          <span key={si} className="px-2 py-0.5 rounded-full bg-white/5 text-[10px] text-white/40 border border-white/5">{sub.title}</span>
                        ))}
                        {s.subtitles.length > 4 && <span className="text-[10px] text-white/20">+{s.subtitles.length - 4}</span>}
                      </div>
                    )}
                  </div>
                ))}
          </div>

          <div className="p-3 border-t border-white/5 text-[11px] text-white/30">
            <div>MovieBox-like player • /api/proxy with Referer spoof</div>
            <div className="mt-1 text-[10px] opacity-60">If stuck at 0:00, proxy is rotating to next source…</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center">Loading...</div>}>
      <WatchClient />
    </Suspense>
  );
}
