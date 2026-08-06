"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import PosterCard from "@/components/PosterCard";
import { Post } from "@/lib/vega/types";
import { Search, X, Film } from "lucide-react";

function SearchClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!initialQuery.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(initialQuery)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setResults(data.posts);
      })
      .finally(() => setLoading(false));
  }, [initialQuery]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <Navbar />

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* Search box - Max matte */}
        <div className="max-w-[720px] mx-auto mb-10">
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies, TV series, people..."
              className="w-full h-[56px] pl-12 pr-12 rounded-[14px] bg-[#18181b] border border-white/[0.08] text-[16px] font-[500] placeholder:text-white/30 focus:outline-none focus:border-white/15 focus:bg-[#1e1e20] transition-all"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>

          <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-white/40">
            <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.06]">Powered by WellFlix Core Engine</span>
            <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.06]">{results.length} results</span>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-5">
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-[2/3] rounded-[12px] bg-[#18181b] shimmer" />
                <div className="h-3 rounded bg-[#18181b] shimmer w-3/4" />
              </div>
            ))}
          </div>
        ) : results.length > 0 ? (
          <>
            <div className="flex items-center gap-3 mb-6">
              <h1 className="text-[22px] font-[700] tracking-[-0.02em]">Search results for &quot;{initialQuery}&quot;</h1>
              <span className="px-2.5 py-1 rounded-full bg-white text-black text-[12px] font-bold">{results.length}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-5">
              {results.map((post, idx) => (
                <PosterCard key={`${post.link}-${idx}`} post={post} size="md" />
              ))}
            </div>
          </>
        ) : initialQuery ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full bg-white/5 mx-auto flex items-center justify-center mb-4">
              <Film className="w-8 h-8 text-white/20" />
            </div>
            <h3 className="font-bold text-[18px] mb-2">No results for &quot;{initialQuery}&quot;</h3>
            <p className="text-white/50 text-[14px] max-w-md mx-auto">Try different keywords. WellFlix searches across MovieBox catalog with Vega engine.</p>
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="inline-flex flex-col items-center gap-4 p-8 rounded-[16px] bg-[#141416] border border-white/[0.06] max-w-md">
              <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center">
                <Search className="w-6 h-6 text-black" />
              </div>
              <div>
                <h3 className="font-bold text-[16px]">Search WellFlix</h3>
                <p className="text-[13px] text-white/50 mt-1 leading-[1.5]">Find any movie or series. Our baked-in Vega provider will fetch all working sources instantly.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-2">
                {["Avengers", "Breaking Bad", "Inception", "Dune", "Stranger Things"].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setQuery(s);
                      router.push(`/search?q=${encodeURIComponent(s)}`);
                    }}
                    className="px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.06] text-[12px] font-medium hover:bg-white/[0.10]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0b]" />}>
      <SearchClient />
    </Suspense>
  );
}
