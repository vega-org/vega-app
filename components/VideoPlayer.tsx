"use client";

import { useEffect, useRef, useState } from "react";
import { Stream } from "@/lib/vega/types";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  SkipBack,
  SkipForward,
} from "lucide-react";

interface Props {
  streams: Stream[];
  poster?: string;
  title?: string;
  onError?: (err: any) => void;
}

export default function VideoPlayer({ streams, poster, title, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<any>(null);
  const [currentStreamIndex, setCurrentStreamIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const controlsTimeout = useRef<NodeJS.Timeout>();

  const currentStream = streams[currentStreamIndex];

  const getProxiedUrl = (url: string) => {
    const isPublic =
      url.includes("mux.dev") ||
      url.includes("googleapis.com") ||
      url.includes("gstatic.com") ||
      url.includes("commondatastorage");
    if (isPublic) return url;
    // Core engine is movie-box.co - proxy with correct referer
    return `/api/proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent("https://movie-box.co/")}`;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentStream) return;
    let mounted = true;
    setLoading(true);

    const setup = async () => {
      const proxiedLink = getProxiedUrl(currentStream.link);
      // Dynamic import HLS only on client
      if (currentStream.type === "m3u8") {
        try {
          const HlsModule = await import("hls.js");
          const Hls = HlsModule.default;
          if (!mounted) return;
          if (Hls.isSupported()) {
            if (hlsRef.current) {
              hlsRef.current.destroy();
            }
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              xhrSetup: (xhr, url) => {
                // Ensure credentials not sent, but allow proxy to handle referer
                xhr.withCredentials = false;
              },
            });
            hlsRef.current = hls;
            hls.loadSource(proxiedLink);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!mounted) return;
              setLoading(false);
              video.play().catch(() => {});
            });
            hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
              if (data.fatal) {
                console.warn("HLS fatal", data);
                setLoading(false);
                onError?.(data);
                if (currentStreamIndex < streams.length - 1) {
                  setTimeout(() => {
                    if (mounted) setCurrentStreamIndex((i) => i + 1);
                  }, 1200);
                }
              }
            });
            return;
          }
        } catch (e) {
          console.warn("HLS dynamic import failed", e);
        }
      }
      // Fallback mp4 or native hls
      try {
        video.src = proxiedLink;
        video.load();
        const onCanPlay = () => {
          if (!mounted) return;
          setLoading(false);
          video.play().catch((err) => {
            console.warn("Play failed, trying next source", err);
            if (currentStreamIndex < streams.length - 1) {
              setCurrentStreamIndex((i) => i + 1);
            }
          });
        };
        const onErr = () => {
          if (!mounted) return;
          setLoading(false);
          if (currentStreamIndex < streams.length - 1) {
            setTimeout(() => {
              if (mounted) setCurrentStreamIndex((i) => i + 1);
            }, 800);
          }
        };
        video.addEventListener("canplay", onCanPlay, { once: true });
        video.addEventListener("error", onErr, { once: true });
      } catch (err) {
        setLoading(false);
        onError?.(err);
        if (currentStreamIndex < streams.length - 1) {
          setCurrentStreamIndex((i) => i + 1);
        }
      }
    };

    setup();

    return () => {
      mounted = false;
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {}
        hlsRef.current = null;
      }
    };
  }, [currentStream, onError, currentStreamIndex, streams.length]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onDuration = () => setDuration(video.duration);
    const onPlay = () => {
      setIsPlaying(true);
      setLoading(false);
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onError = () => {
      setLoading(false);
      // Auto try next source
      if (currentStreamIndex < streams.length - 1) {
        setCurrentStreamIndex((i) => i + 1);
      }
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onDuration);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onDuration);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onError);
    };
  }, [currentStreamIndex, streams.length]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = parseFloat(e.target.value);
    v.currentTime = t;
    setCurrentTime(t);
  };

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    v.volume = vol;
    setMuted(vol === 0);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const newMuted = !muted;
    setMuted(newMuted);
    v.muted = newMuted;
  };

  const toggleFs = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const formatTime = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const resetControlsTimer = () => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3500);
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group overflow-hidden rounded-[12px] sm:rounded-[14px] border border-white/[0.06]"
      onMouseMove={resetControlsTimer}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onClick={resetControlsTimer}
    >
      <video
        ref={videoRef}
        poster={poster}
        className="w-full h-full object-contain bg-black"
        playsInline
        crossOrigin="anonymous"
        onContextMenu={(e) => e.preventDefault()}
      />

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm z-20 gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <div className="text-[11px] font-bold tracking-[0.08em] text-white/70 text-center px-4">
            LOADING {currentStream?.quality ? `${currentStream.quality}P` : "SOURCE"} • {currentStream?.server}
            <br />
            <span className="text-[10px] font-normal opacity-60">WellFlix auto tries next if this fails</span>
          </div>
        </div>
      )}

      {!isPlaying && !loading && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center z-10 group/big"
        >
          <div className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center shadow-[0_12px_40px_rgba(0,0,0,0.5)] group-hover/big:scale-105 transition-transform">
            <Play className="w-8 h-8 fill-black ml-1" />
          </div>
        </button>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 z-30 transition-all duration-300 ${
          showControls ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
        }`}
      >
        <div className="px-3 sm:px-4 pb-2">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={seek}
            className="w-full h-1 accent-white cursor-pointer appearance-none bg-white/20 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
        </div>

        <div className="flex items-center justify-between px-3 sm:px-4 pb-3 sm:pb-4 bg-gradient-to-t from-black via-black/60 to-transparent pt-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={togglePlay}
              className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black ml-0.5" />}
            </button>

            <button
              onClick={() => videoRef.current && (videoRef.current.currentTime -= 10)}
              className="hidden sm:flex w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 text-white items-center justify-center"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={() => videoRef.current && (videoRef.current.currentTime += 10)}
              className="hidden sm:flex w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 text-white items-center justify-center"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center"
              >
                {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={changeVolume}
                className="hidden sm:block w-20 h-1 accent-white"
              />
            </div>

            <span className="text-[11px] font-mono text-white/60 ml-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="h-8 px-3 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-bold tracking-wide flex items-center gap-1.5"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {currentStream?.quality ? `${currentStream.quality}p` : "Source"} • {streams.length}
                </span>
                <span className="sm:hidden">{currentStream?.quality || "HD"}</span>
              </button>

              {showSettings && (
                <div className="absolute bottom-full right-0 mb-2 w-[320px] max-h-[300px] overflow-y-auto rounded-[12px] bg-[#141416] border border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.6)] p-2 animate-[scaleIn_0.2s_ease-out]">
                  <div className="px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-white/40">
                    SOURCES • AUTO FAILOVER • WELLFLIX CORE
                  </div>
                  {streams.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setCurrentStreamIndex(idx);
                        setShowSettings(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-[8px] flex items-center justify-between transition-colors ${
                        idx === currentStreamIndex ? "bg-white text-black" : "hover:bg-white/[0.06] text-white/80"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold leading-none truncate">{s.server}</div>
                        <div className="text-[11px] opacity-60 mt-1 truncate">
                          {s.type.toUpperCase()} • {s.quality || "Auto"} • {s.subtitles?.length || 0} subs
                        </div>
                      </div>
                      {idx === currentStreamIndex && <div className="w-2 h-2 rounded-full bg-[#5b5cf6] ml-2 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={toggleFs}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`absolute top-0 inset-x-0 p-4 sm:p-5 bg-gradient-to-b from-black/80 via-black/20 to-transparent transition-opacity ${
          showControls ? "opacity-100" : "opacity-0"
        } pointer-events-none`}
      >
        <div className="text-[13px] sm:text-[15px] font-[700] tracking-[-0.01em] text-white line-clamp-1">{title}</div>
        <div className="text-[10px] tracking-[0.06em] text-white/50 mt-1 font-bold">
          WELLFLIX PLAYER • {currentStream?.server} • {currentStream?.quality ? `${currentStream.quality}p` : "HD"} • {currentStreamIndex + 1}/
          {streams.length}
        </div>
      </div>
    </div>
  );
}
