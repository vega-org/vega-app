import * as cheerio from "cheerio";
import { Post, Info, Stream } from "./types";

const baseUrl = "https://5z35jc.movielinkbd.li";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export async function getPosts(filter: string, page: number, signal?: AbortSignal): Promise<Post[]> {
  try {
    const url = filter === "/" ? `${baseUrl}/` : `${baseUrl}${filter}`;
    const res = await fetch(url, { headers, signal, next: { revalidate: 300 } as any });
    if (!res.ok) throw new Error(`movielinkbd ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const posts: Post[] = [];
    $('a[href*="/movie/"], a[href*="/series/"], a[href*="/drama/"]').each((_, el) => {
      const a = $(el);
      const href = a.attr("href") || "";
      if (!href || href === baseUrl + "/" || posts.find((p) => p.link === href)) return;
      const img = a.find("img").first();
      const parent = a.parent();
      const img2 = parent.find("img").first();
      const image = img.attr("src") || img2.attr("src") || "";
      const title = a.text().trim() || img.attr("alt") || "";
      if (title.length > 4 && image && (href.includes("/movie/") || href.includes("/series/") || href.includes("/drama/"))) {
        if (!posts.find((p) => p.link === href)) posts.push({ title, link: href, image });
      }
    });
    return posts.slice(0, 20);
  } catch {
    return [];
  }
}

export async function getSearchPosts(query: string, page: number, signal?: AbortSignal): Promise<Post[]> {
  try {
    if (page > 1) return [];
    const url = `${baseUrl}/?s=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers, signal });
    if (!res.ok) throw new Error(`search ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const posts: Post[] = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!href.includes("/movie/") && !href.includes("/series/") && !href.includes("/drama/")) return;
      const img = $(el).find("img").first();
      const image = img.attr("src") || "";
      const title = ($(el).text().trim() || img.attr("alt") || "").trim();
      if (title.length > 4 && image) posts.push({ title, link: href, image });
    });
    return posts.slice(0, 20);
  } catch {
    return [];
  }
}

export async function getMeta(link: string): Promise<Info> {
  try {
    const res = await fetch(link, { headers });
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $("h1").first().text().trim() || $("title").text().split("|")[0].trim();
    const image = $(".post-thumbnail img, img").first().attr("src") || "";
    const synopsis = $("p").first().text().trim() || "Movie from MovieLinkBD";
    return {
      title,
      image,
      synopsis,
      imdbId: "",
      type: link.includes("/series/") || link.includes("/drama/") ? "series" : "movie",
      tags: [],
      cast: [],
      rating: "",
      linkList: [{ title: "Original", directLinks: [{ title: "Watch", link: link, type: "movie" }] }],
      webUrl: link,
    };
  } catch (e: any) {
    throw new Error(`movielinkbd meta ${e.message}`);
  }
}

export async function getStream(link: string): Promise<Stream[]> {
  // TODO: implement real extraction for movielinkbd similar to myflixbd
  // For now return empty to avoid demo confusion
  return [];
}
