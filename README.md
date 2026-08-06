# WellFlix — Premium Streaming Webapp (HBO Max Inspired)

**WellFlix** is a complete, production-ready streaming webapp built with Next.js 14, inspired by **HBO Max** matte finish UI and **Netflix / Prime Video** UX. It bakes in the Vega providers engine (MovieBox Web) so users don't need to add any provider sources — just like MovieBoxPro's approach.

> Built from `riyadhhere-source/vega-webapp` branch, transformed from React Native Vega App to a Vercel-deployable Next.js webapp.

## ✨ Features

- **Baked-in Vega Provider**: MovieBox Web (`themoviebox.org`) engine is integrated directly — no user configuration. Fetches multi-source streaming links automatically.
- **HBO Max Inspired UI**: White & slightly black solid matte finish, bold typography (Inter + Instrument Sans), minimal shadows, premium rounded cards, 4K badges.
- **Netflix-style Home**: Hero carousel (trending), horizontal rows, rank cards, continue watching vibes, shimmer loading.
- **Movies & Series**: Separate pages with pagination (`/movies`, `/series`), powered by `/api/catalog` with filter `/`, `/newWeb/movie`, `/newWeb/tv-series`.
- **Full Detail Flow**:
  - Click any title → `/title?link=...` fetches meta via Vega `getMeta` (cover, synopsis, cast, tags, rating, dubs/languages).
  - For **Movies**: lists all audio tracks (Original, Hindi, etc.) with directLinks → click → `/watch`.
  - For **Series**: language selector → `getEpisodes` (season parsing via Sxx Exx) → episode grid → one-click play.
- **Multi-source Player**: `/watch?link=...` fetches all working streams via `getStream` (HLS / MP4), shows HLS.js player with:
  - Auto failover UI, quality badge, server list
  - Subtitles support, volume, fullscreen, time scrub
  - Source switcher dropdown (auto-reloads HLS)
- **Search**: Global search bar (navbar + `/search`) using `getSearchPosts` scraping logic.
- **Vercel Ready**: Optimized Next.js API routes with caching, `vercel.json` maxDuration, remote image patterns.
- **Branding**: WellFlix logo (W), Core Engine badge, LIVE indicator, beta tag.

## 🧩 Architecture — Like MovieBoxPro

Vega App normally requires users to add provider JSON. WellFlix **bakes in** one provider (MovieBox Web) into main engine:

```
User opens WellFlix → Home fetches trending from MovieBox Web API (/wefeed-h5api-bff/subject/trending)
Clicks movie → Detail parses __NUXT_DATA__ → builds playbackLink JSON (subjectId, detailPath, language, season, episode)
Episode → fetch /api/episodes (decodeLink → expand seasons.allEp)
Play → /api/stream (subject/play API + captions API) → returns Stream[] (server, link, type m3u8/mp4, quality, subtitles, headers)
Player uses HLS.js to play, auto failover if one fails
```

All logic lives in `lib/vega/movieBoxWeb.ts` — ported from https://github.com/Zenda-Cross/vega-providers/providers/movieBoxWeb

## 📁 Structure

```
app/
  api/
    catalog    → trending, movies, tv
    search     → keyword search
    meta       → Info (title, synopsis, linkList)
    episodes   → EpisodeLink[] from episodesLink
    stream     → Stream[] with subtitles
    providers  → baked-in provider info
  page.tsx     → Home (Hero + Rows)
  title/       → Detail page (movie + series seasons)
  watch/       → Player (HLS.js + source list)
  movies/      → Movies catalog with pagination
  series/      → Series catalog
  search/      → Search results
  globals.css  → Max matte styles
components/
  Navbar, Hero, ContentRow, PosterCard, VideoPlayer, TitleDetail
lib/
  vega/
    movieBoxWeb.ts  → Full provider engine
    baseUrl.ts      → urls.json fetcher with cache + fallback
    types.ts
  utils/cn.ts
```

## 🚀 Deploy to Vercel

1. Push to GitHub
2. Import in Vercel → Framework: Next.js
3. No env needed (uses public urls.json). Optional: add `NEXT_PUBLIC_TMDB` if you extend with TMDB.
4. Deploy — API routes will handle CORS and cheerio scraping.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
```

## 🎨 UI / UX — HBO Max

- **Colors**: `#0a0a0b` black, `#18181b` cards, `#ffffff` primary button, `#5b5cf6` accent
- **Matte**: `0 0 0 1px rgba(255,255,255,0.06)` border, soft shadow, no glass unless secondary button
- **Typography**: 800 weight for titles, -0.03em tracking, Instrument Sans for display
- **Rows**: hover scale 1.02, rank badge, HD/4K pills, shimmer loading
- **Player**: black backdrop, rounded 12-14px, white play button, auto-hiding controls, source switcher

## 🔧 Vega Provider Integration

Copied and refactored from https://github.com/vega-org/vega-providers

- `getBaseUrl` → fetches `https://raw.githubusercontent.com/Zenda-Cross/vega-providers/refs/heads/main/urls.json`, cached 1h, fallback `https://themoviebox.org`
- `parseNuxtData` → decodes `#__NUXT_DATA__` (Vue Nuxt serialization)
- `fetchCatalogPage` → trending API with `tabId` (ONEROOM_MOVIE / ONEROOM_TV)
- `fetchPostsLegacy` → scrapes `a[href^="/moviesDetail/"]` fallback
- `getMeta` → fetches `/moviesDetail/${detailPath}`, extracts subject, resource, dubs → linkList
- `getEpisodes` → expands `seasons[].allEp` or `maxEp` into `Sxx Exx` list
- `getStream` → `/wefeed-h5api-bff/subject/play` + `/caption`, returns multiple Stream with headers

## 📦 Dependencies

- Next.js 14, React 18, Tailwind 3.4, Cheerio, HLS.js, Lucide React

## 🛡️ Disclaimer

WellFlix does not host media. It uses third-party Vega provider that aggregates public sources. Like Vega App, all content is user-sourced.

## 📝 License

GPL (inherited from Vega App)

---

**Brand**: WellFlix — "Watch Well, Flix Well" • Beta • Built for Web, iOS soon.
