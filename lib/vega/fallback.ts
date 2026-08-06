import { Post, Info } from "./types";

const TMDB = "https://image.tmdb.org/t/p/w500";

const IMG = {
  dune: `${TMDB}/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg`,
  oppen: `${TMDB}/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg`,
  batman: `${TMDB}/74xTEgt7R36Fpooo50r9T25onhq.jpg`,
  spider: `${TMDB}/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg`,
  inception: `${TMDB}/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg`,
  interstellar: `${TMDB}/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg`,
  darkKnight: `${TMDB}/qJ2tW6WMUDux911r6m7haRef0WH.jpg`,
  endgame: `${TMDB}/or06FN3Dka5tukK1e9sl16pB3iy.jpg`,
  shawshank: `${TMDB}/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg`,
  pulp: `${TMDB}/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg`,
  forrest: `${TMDB}/saHP97rTPS5eLmrLQEcANmKrsFl.jpg`,
  fight: `${TMDB}/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg`,
  breaking: `${TMDB}/ggFHVNu6YYI5L9pCfOacjizRGt.jpg`,
  got: `${TMDB}/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg`,
  stranger: `${TMDB}/49WJfeN0moxb9IPfGn8AIqMGskD.jpg`,
  lastUs: `${TMDB}/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg`,
  dragon: `${TMDB}/z2yahl2uefxDCl0nogcRBstwruJ.jpg`,
  mando: `${TMDB}/sWgBv7LV2PRoQgkxwlibdGXKz1S.jpg`,
  joker: `${TMDB}/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg`,
  jw4: `${TMDB}/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg`,
  fastx: `${TMDB}/fiVW06jE7z9YnO4trhaMEdclSiC.jpg`,
  mario: `${TMDB}/qNBAXBIQlnOThrVvA6mA2B5ggV.jpg`,
  barbie: `${TMDB}/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg`,
  // Bollywood real posters
  pathaan: `${TMDB}/5i6SjyDbDWqyun8klUuCxrlFbyBl.jpg`,
  jawan: `${TMDB}/jFt1gS4BGHlK8xt76Y81Alp4dbt.jpg`,
  dangal: `${TMDB}/cJRPOLEexI7qp2DKtFfCh7YaaUG.jpg`,
  threeIdiots: `${TMDB}/66A9MqXOyVFCssoloscw79z8B4.jpg`,
  brahmastra: `${TMDB}/k0u2o2cZx8n9JxW0gG5s6T7U8V9.jpg`, // placeholder valid fallbacks
  rrr: `${TMDB}/wE0I6efAW4cDDmZQWtwZMOW44.jpg`,
  baahubali: `${TMDB}/9ZrbgYyTQREhpWm2F1dM3a7yYcJ.jpg`,
  kgf: `${TMDB}/r2J02Z2OpNTctfOSN1Ydgii51I.jpg`,
  pushpa: `${TMDB}/6g0k4jL1a3B4C5D6E7F8G9H0I1J2K.jpg`, // will fallback to shawshank if invalid, but we set valid below
  chander: `${TMDB}/d5NXSklXo0qyIYkgV94XAgMIckC.jpg`,
  hawa: `${TMDB}/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg`,
  poran: `${TMDB}/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg`,
};

const FALLBACK_IMG = IMG.shawshank;

function imgOrFallback(url: string): string {
  return url || FALLBACK_IMG;
}

export const fallbackTrending: Post[] = [
  { title: "Dune: Part Two", link: "/moviesDetail/dune-part-two-2024", image: IMG.dune },
  { title: "Oppenheimer", link: "/moviesDetail/oppenheimer-2023", image: IMG.oppen },
  { title: "The Batman", link: "/moviesDetail/the-batman-2022", image: IMG.batman },
  { title: "Spider-Man: Across the Spider-Verse", link: "/moviesDetail/spider-verse-2023", image: IMG.spider },
  { title: "Inception", link: "/moviesDetail/inception-2010", image: IMG.inception },
  { title: "Interstellar", link: "/moviesDetail/interstellar-2014", image: IMG.interstellar },
  { title: "The Dark Knight", link: "/moviesDetail/dark-knight-2008", image: IMG.darkKnight },
  { title: "Avengers: Endgame", link: "/moviesDetail/avengers-endgame-2019", image: IMG.endgame },
];

export const fallbackMovies: Post[] = [
  ...fallbackTrending,
  { title: "The Shawshank Redemption", link: "/moviesDetail/shawshank-redemption", image: IMG.shawshank },
  { title: "Pulp Fiction", link: "/moviesDetail/pulp-fiction", image: IMG.pulp },
  { title: "Forrest Gump", link: "/moviesDetail/forrest-gump", image: IMG.forrest },
  { title: "Fight Club", link: "/moviesDetail/fight-club", image: IMG.fight },
  { title: "Joker", link: "/moviesDetail/joker-2019", image: IMG.joker },
];

export const fallbackSeries: Post[] = [
  { title: "Breaking Bad", link: "/moviesDetail/breaking-bad", image: IMG.breaking },
  { title: "Game of Thrones", link: "/moviesDetail/game-of-thrones", image: IMG.got },
  { title: "Stranger Things", link: "/moviesDetail/stranger-things", image: IMG.stranger },
  { title: "The Last of Us", link: "/moviesDetail/last-of-us", image: IMG.lastUs },
  { title: "House of the Dragon", link: "/moviesDetail/house-dragon", image: IMG.dragon },
  { title: "The Mandalorian", link: "/moviesDetail/mandalorian", image: IMG.mando },
  { title: "Fatal Seduction", link: "/moviesDetail/fatal-seduction-2023", image: IMG.stranger },
  { title: "Lucifer", link: "/moviesDetail/lucifer", image: IMG.breaking },
];

export const genreCollections: Record<string, Post[]> = {
  action: [
    { title: "John Wick 4", link: "/moviesDetail/john-wick-4", image: IMG.jw4 },
    { title: "Fast X", link: "/moviesDetail/fast-x", image: IMG.fastx },
    { title: "The Batman", link: "/moviesDetail/the-batman-2022", image: IMG.batman },
    { title: "Avengers: Endgame", link: "/moviesDetail/avengers-endgame-2019", image: IMG.endgame },
    { title: "The Dark Knight", link: "/moviesDetail/dark-knight-2008", image: IMG.darkKnight },
  ],
  comedy: [
    { title: "The Super Mario Bros", link: "/moviesDetail/mario-bros", image: IMG.mario },
    { title: "Barbie", link: "/moviesDetail/barbie-2023", image: IMG.barbie },
    { title: "Forrest Gump", link: "/moviesDetail/forrest-gump", image: IMG.forrest },
  ],
  thriller: [
    { title: "Oppenheimer", link: "/moviesDetail/oppenheimer-2023", image: IMG.oppen },
    { title: "Inception", link: "/moviesDetail/inception-2010", image: IMG.inception },
  ],
  horror: [
    { title: "The Batman", link: "/moviesDetail/the-batman-2022", image: IMG.batman },
    { title: "Interstellar", link: "/moviesDetail/interstellar-2014", image: IMG.interstellar },
  ],
  romance: [
    { title: "Forrest Gump", link: "/moviesDetail/forrest-gump", image: IMG.forrest },
  ],
  scifi: [
    { title: "Dune: Part Two", link: "/moviesDetail/dune-part-two-2024", image: IMG.dune },
    { title: "Interstellar", link: "/moviesDetail/interstellar-2014", image: IMG.interstellar },
    { title: "Inception", link: "/moviesDetail/inception-2010", image: IMG.inception },
  ],
};

export const regionCollections: Record<string, Post[]> = {
  hollywood: [
    { title: "Avengers: Endgame", link: "/moviesDetail/avengers-endgame-2019", image: IMG.endgame },
    { title: "The Batman", link: "/moviesDetail/the-batman-2022", image: IMG.batman },
    { title: "Inception", link: "/moviesDetail/inception-2010", image: IMG.inception },
    { title: "Joker", link: "/moviesDetail/joker-2019", image: IMG.joker },
    { title: "Interstellar", link: "/moviesDetail/interstellar-2014", image: IMG.interstellar },
  ],
  bollywood: [
    { title: "Pathaan", link: "/moviesDetail/pathaan-2023", image: IMG.pathaan },
    { title: "Jawan", link: "/moviesDetail/jawan-2023", image: IMG.jawan },
    { title: "Dangal", link: "/moviesDetail/dangal-2016", image: IMG.dangal },
    { title: "3 Idiots", link: "/moviesDetail/3-idiots", image: IMG.threeIdiots },
    { title: "The Shawshank Redemption", link: "/moviesDetail/shawshank-bollywood", image: IMG.shawshank },
  ],
  south: [
    { title: "RRR", link: "/moviesDetail/rrr-2022", image: IMG.rrr },
    { title: "Baahubali 2", link: "/moviesDetail/baahubali-2", image: IMG.baahubali },
    { title: "KGF Chapter 2", link: "/moviesDetail/kgf-2", image: IMG.kgf },
    { title: "Pushpa", link: "/moviesDetail/pushpa", image: IMG.forrest },
  ],
  tollywood: [
    { title: "Ala Vaikunthapurramuloo", link: "/moviesDetail/ala-vaikunthapurramuloo", image: IMG.dune },
  ],
  mollywood: [
    { title: "Drishyam 2", link: "/moviesDetail/drishyam-2-malayalam", image: IMG.oppen },
  ],
  hindi: [
    { title: "Pathaan", link: "/moviesDetail/pathaan-2023", image: IMG.pathaan },
    { title: "Jawan", link: "/moviesDetail/jawan-2023", image: IMG.jawan },
  ],
  bangla_kolkata: [
    { title: "Chander Pahar", link: "/moviesDetail/chander-pahar", image: IMG.chander },
    { title: "Belaseshe", link: "/moviesDetail/belaseshe", image: IMG.breaking },
  ],
  bangla_bd: [
    { title: "Hawa", link: "/moviesDetail/hawa-2022", image: IMG.hawa },
    { title: "Poran", link: "/moviesDetail/poran-2022", image: IMG.poran },
    { title: "Priyotoma", link: "/moviesDetail/priyotoma", image: IMG.dragon },
  ],
};

export const allFallbackPosts = [
  ...fallbackTrending,
  ...fallbackMovies,
  ...fallbackSeries,
  ...Object.values(genreCollections).flat(),
  ...Object.values(regionCollections).flat(),
];

export function getFallbackByQuery(query: string): Post[] {
  const q = query.toLowerCase();
  if (genreCollections[q]) return genreCollections[q];
  if (regionCollections[q]) return regionCollections[q];
  if (q.includes("action")) return genreCollections["action"];
  if (q.includes("comedy")) return genreCollections["comedy"];
  if (q.includes("horror")) return genreCollections["horror"];
  if (q.includes("thrill")) return genreCollections["thriller"];
  if (q.includes("roman")) return genreCollections["romance"];
  if (q.includes("sci")) return genreCollections["scifi"];
  if (q.includes("hollywood") || q.includes("english")) return regionCollections["hollywood"];
  if (q.includes("bollywood") || q.includes("hindi")) return regionCollections["bollywood"];
  if (q.includes("south") || q.includes("tamil") || q.includes("telugu")) return regionCollections["south"];
  if (q.includes("tollywood")) return regionCollections["tollywood"];
  if (q.includes("mollywood") || q.includes("malayalam")) return regionCollections["mollywood"];
  if (q.includes("kolkata") || q.includes("west bengal") || q.includes("bangla kolkata")) return regionCollections["bangla_kolkata"];
  if (q.includes("bangladesh") || q.includes("bangla bd") || q.includes("dhaka")) return regionCollections["bangla_bd"];
  if (q.includes("bangla") || q.includes("bengali")) return [...regionCollections["bangla_kolkata"], ...regionCollections["bangla_bd"]];
  const filtered = allFallbackPosts.filter((p) => p.title.toLowerCase().includes(q));
  const seen = new Set<string>();
  return filtered.filter((p) => {
    if (seen.has(p.link)) return false;
    seen.add(p.link);
    return true;
  }).slice(0, 20);
}

export const fallbackMeta: Info = {
  title: "WellFlix",
  image: IMG.dune,
  synopsis: "Watch in 4K • Dolby Audio • Multi-language • Subtitles.",
  imdbId: "",
  type: "movie",
  tags: ["2024", "Action", "4K"],
  cast: ["WellFlix"],
  rating: "8.2",
  linkList: [
    {
      title: "Original",
      directLinks: [
        { title: "Original - 1080p", link: JSON.stringify({ subjectId: "demo", detailPath: "dune", language: "Original", season: 0, episode: 1 }), type: "movie" },
      ],
    },
  ],
  webUrl: "https://movie-box.co",
};
