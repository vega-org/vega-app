import { getPosts } from "@/lib/vega/movieBoxWeb";
import Navbar from "@/components/Navbar";
import PosterCard from "@/components/PosterCard";

export const revalidate = 600;

export default async function SeriesPage() {
  const initialPosts = await getPosts("/newWeb/tv-series", 1).catch(() => []);

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <Navbar />
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-[28px] sm:text-[36px] font-[800] tracking-[-0.03em] leading-none">TV Series</h1>
            <p className="mt-2 text-[14px] text-white/50">Seasons • Episodes • Auto episode parsing • WellFlix Engine</p>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-black text-[12px] font-bold tracking-wide">
            {initialPosts.length}+ SERIES
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-5">
          {initialPosts.map((post, i) => (
            <PosterCard key={`${post.link}-${i}`} post={post} />
          ))}
        </div>

        <div className="mt-12 p-6 rounded-[16px] bg-[#141416] border border-white/[0.06] text-center">
          <div className="font-bold text-[16px] mb-2">Binge Engine Powered by Vega</div>
          <p className="text-[13px] text-white/50 max-w-2xl mx-auto leading-[1.5]">
            Series detail parses seasons from MovieBox (resource.seasons) into Sxx Exx format. Click → episodes → one-click play with multi-source failover.
          </p>
        </div>
      </div>
    </main>
  );
}
