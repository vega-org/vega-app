import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import ContentRow from "@/components/ContentRow";
import BottomNav from "@/components/BottomNav";
import { getPosts, getSearchPosts } from "@/lib/vega/movieBoxWeb";
import { genreCollections, regionCollections } from "@/lib/vega/fallback";
import { getPosts as getMyFlixPosts } from "@/lib/vega/myflixbd";
import { Server } from "lucide-react";

export const revalidate = 60;
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [
    trending,
    movies,
    series,
    action,
    comedy,
    hollywood,
    bollywood,
    south,
    bangla,
    banglaBD,
    thriller,
    myflixTrending,
    myflixBangla,
  ] = await Promise.all([
    getPosts("/", 1).catch(() => []),
    getPosts("/newWeb/movie", 1).catch(() => []),
    getPosts("/newWeb/tv-series", 1).catch(() => []),
    getSearchPosts("action", 1).catch(() => genreCollections.action),
    getSearchPosts("comedy", 1).catch(() => genreCollections.comedy),
    getSearchPosts("hollywood", 1).catch(() => regionCollections.hollywood),
    getSearchPosts("bollywood", 1).catch(() => regionCollections.bollywood),
    getSearchPosts("south indian", 1).catch(() => regionCollections.south),
    getSearchPosts("bangla", 1).catch(() => [...regionCollections.bangla_kolkata, ...regionCollections.bangla_bd]),
    getSearchPosts("bangladesh", 1).catch(() => regionCollections.bangla_bd),
    getSearchPosts("thriller", 1).catch(() => genreCollections.thriller),
    getMyFlixPosts("/", 1).catch(() => []),
    getMyFlixPosts("/movie-genre/bangla/", 1).catch(() => []),
  ]);

  // Merge Bangla from MovieBox + MyFlixBD for richer catalog
  const banglaMerged = [...bangla, ...myflixBangla, ...myflixTrending].filter((v, i, a) => a.findIndex((t) => t.link === v.link) === i).slice(0, 20);
  const banglaBDMerged = [...banglaBD, ...myflixBangla].filter((v, i, a) => a.findIndex((t) => t.link === v.link) === i).slice(0, 20);

  return (
    <main className="min-h-screen bg-[#08080b] text-white pb-[72px] lg:pb-0">
      <Navbar />
      <Hero items={trending.length ? trending : movies} />

      {/* Discover More like MovieBox */}
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-[15px] flex items-center gap-2"><span className="w-1 h-4 rounded-full bg-[#1CB7FF]" /> Discover More</h3>
        </div>
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
          {[
            { label: "Hollywood", q: "hollywood" },
            { label: "Bollywood", q: "bollywood" },
            { label: "South Indian", q: "south" },
            { label: "Bangla", q: "bangla" },
            { label: "Action", q: "action" },
            { label: "Comedy", q: "comedy" },
            { label: "Thriller", q: "thriller" },
            { label: "Horror", q: "horror" },
          ].map((c) => (
            <a key={c.q} href={`/search?q=${c.q}`} className="flex-shrink-0 px-4 py-2 rounded-full bg-[#1a1a24] border border-white/5 text-[13px] font-medium hover:bg-white/10 transition-colors">
              {c.label}
            </a>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <ContentRow title="🔥 Trending Now" subtitle="Most watched • movie-box.co core" posts={trending.length ? trending : myflixTrending} size="lg" showRank />
        <ContentRow title="🎬 Hollywood • Blockbusters" posts={hollywood} size="md" />
        <ContentRow title="🇮🇳 Bollywood • Hindi" posts={bollywood} size="md" />
        <ContentRow title="🎭 South Indian • Tamil Telugu" posts={south} size="md" />
        <ContentRow title="🌸 Bangla • Kolkata • Tollywood" posts={banglaMerged} size="md" />
        <ContentRow title="🇧🇩 Bangladeshi • Dhaka • MyFlixBD" posts={banglaBDMerged} size="md" />
        <ContentRow title="💥 Action • Thrills" posts={action} size="md" />
        <ContentRow title="😂 Comedy • Light" posts={comedy} size="sm" />
        <ContentRow title="😱 Thriller" posts={thriller} size="md" />
        <ContentRow title="🍿 Popular Movies" posts={movies} size="md" />
        <ContentRow title="📺 TV Series • Binge" posts={series} size="md" />
      </div>

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 mt-8 mb-8">
        <div className="rounded-2xl bg-gradient-to-r from-[#1CB7FF]/20 to-[#2FF58B]/20 border border-white/5 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1CB7FF] to-[#2FF58B] flex items-center justify-center text-black font-bold">▶</div>
            <div>
              <div className="font-bold text-sm">Get the App • Watch & Download Free</div>
              <div className="text-xs text-white/50">No ads • HD • Premium Contents</div>
            </div>
          </div>
          <div className="hidden sm:block px-4 py-2 rounded-full bg-white text-black text-xs font-bold">Download</div>
        </div>
      </div>

      <footer className="border-t border-white/5 bg-[#0a0a0b] py-8">
        <div className="mx-auto max-w-[1600px] px-6 flex flex-col sm:flex-row justify-between gap-3 text-[11px] text-white/25">
          <span>© 2026 WellFlix</span>
          <span className="flex items-center gap-2"><Server className="w-3 h-3" /> /api/proxy • Auto failover • MovieBox engine</span>
        </div>
      </footer>

      <BottomNav />
    </main>
  );
}
