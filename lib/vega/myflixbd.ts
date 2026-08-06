import * as cheerio from "cheerio";
import { Post, Info, Stream } from "./types";

const baseUrl = "https://myflixbd.to";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

function absoluteUrl(path: string): string {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

export const catalog = [
  { title: "Trending • Bangla", filter: "/" },
  { title: "Bangla Movies", filter: "/movie-genre/bangla/" },
  { title: "Hindi", filter: "/movie-genre/hindi/" },
  { title: "Hollywood", filter: "/movie-genre/hollywood/" },
  { title: "South Indian", filter: "/movie-genre/south-indian/" },
];

export async function getPosts(filter: string, page: number, signal?: AbortSignal): Promise<Post[]> {
  try {
    const url = filter === "/" ? `${baseUrl}/` : `${baseUrl}${filter}${page > 1 ? `page/${page}/` : ""}`;
    const res = await fetch(url, { headers, signal, next: { revalidate: 300 } as any });
    if (!res.ok) throw new Error(`myflixbd ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const posts: Post[] = [];
    // MyFlixBD uses article or div with image and title
    $("article, .post, .movie, .item").each((_, el) => {
      const a = $(el).find("a").first();
      const img = $(el).find("img").first();
      const href = a.attr("href") || $(el).find("a").attr("href") || "";
      const title = (img.attr("alt") || a.attr("title") || $(el).find("h2,h3").text() || "").trim();
      const image = img.attr("src") || img.attr("data-src") || "";
      if (href && title && image && href.includes("/movie/")) {
        if (!posts.find((p) => p.link === href)) {
          posts.push({ title, link: href, image });
        }
      }
    });
    // Fallback selector: all links to /movie/ with images
    if (posts.length === 0) {
      $('a[href*="/movie/"]').each((_, el) => {
        const a = $(el);
        const href = a.attr("href") || "";
        if (!href.includes("/movie/") || href === baseUrl + "/movie/") return;
        const img = a.find("img").first();
        const parent = a.parent();
        const img2 = parent.find("img").first();
        const image = img.attr("src") || img2.attr("src") || "";
        const title = a.text().trim() || img.attr("alt") || "";
        if (href && title.length > 3 && image && !posts.find((p) => p.link === href)) {
          posts.push({ title, link: href, image });
        }
      });
    }
    return posts.slice(0, 18);
  } catch (e) {
    console.log("myflixbd getPosts fallback", e);
    return [];
  }
}

export async function getSearchPosts(query: string, page: number, signal?: AbortSignal): Promise<Post[]> {
  try {
    if (page > 1) return [];
    const url = `${baseUrl}/?s=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers, signal });
    if (!res.ok) throw new Error(`myflixbd search ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const posts: Post[] = [];
    $("a").each((_, el) => {
      const a = $(el);
      const href = a.attr("href") || "";
      if (!href.includes("/movie/") && !href.includes("/tv-show/")) return;
      const img = a.find("img").first();
      const image = img.attr("src") || "";
      const title = (a.attr("title") || a.text() || img.attr("alt") || "").trim();
      if (title.length > 4 && image && !posts.find((p) => p.link === href)) {
        posts.push({ title, link: href, image });
      }
    });
    return posts.slice(0, 20);
  } catch {
    return [];
  }
}

export async function getMeta(link: string): Promise<Info> {
  try {
    const res = await fetch(link, { headers });
    if (!res.ok) throw new Error(`myflixbd meta ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $("h1").first().text().trim() || $("title").text().split("–")[0].trim();
    const image = $(".poster img, .post-thumbnail img").first().attr("src") || $("img").first().attr("src") || "";
    const synopsis = $(".description, .entry-content p").first().text().trim() || "Bangla movie from MyFlixBD";
    const tags: string[] = [];
    $(".genres a, .genre a").each((_, el) => {
      tags.push($(el).text().trim());
    });
    // Find download links
    const linkList: any[] = [];
    const directLinks: any[] = [];
    $('a[href*="myflixbd.fun"], a[href*="hubcloud"], a[href*="gdflix"]').each((_, el) => {
      const a = $(el);
      const href = a.attr("href") || "";
      const text = a.text().trim() || "Server";
      if (href && href.startsWith("http")) {
        directLinks.push({ title: text, link: href, type: "movie" });
      }
    });
    if (directLinks.length > 0) {
      linkList.push({ title: "MyFlixBD Servers", directLinks });
    } else {
      linkList.push({ title: "Original", directLinks: [{ title: "Watch", link: link, type: "movie" }] });
    }

    return {
      title,
      image,
      synopsis,
      imdbId: "",
      type: link.includes("/tv-show/") ? "series" : "movie",
      tags,
      cast: [],
      rating: "",
      linkList,
      webUrl: link,
    };
  } catch (e: any) {
    throw new Error(`MyFlixBD meta failed: ${e.message}`);
  }
}

// Simplified hubcloud extractor for MyFlixBD
async function extractHubcloud(hubcloudUrl: string): Promise<string[]> {
  try {
    const res = await fetch(hubcloudUrl, { headers });
    const html = await res.text();
    // Look for url = atob(...) or similar
    const atobMatch = html.match(/atob\(atob\(['"]([^'"]+)['"]\)\)/);
    if (atobMatch?.[1]) {
      try {
        const decoded = Buffer.from(Buffer.from(atobMatch[1], "base64").toString(), "base64").toString();
        if (decoded.startsWith("http")) return [decoded];
      } catch {}
    }
    const urlMatch = html.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
    if (urlMatch?.[1]) {
      let url = urlMatch[1];
      if (url.includes("r=")) {
        const b64 = url.split("r=")[1];
        try {
          url = Buffer.from(b64, "base64").toString();
        } catch {}
      }
      if (url.startsWith("http")) return [url];
    }
    // Look for buttons with href to drive etc
    const $ = cheerio.load(html);
    const links: string[] = [];
    $(".btn-success, .btn-danger, a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("drive.google.com") || href.includes("pixeldrain") || href.includes(".mkv") || href.includes("hubcloud")) {
        links.push(href);
      }
    });
    return links;
  } catch {
    return [];
  }
}

export async function getStream(link: string): Promise<Stream[]> {
  try {
    // link is myflixbd.fun page
    const res = await fetch(link, { headers });
    const html = await res.text();
    const $ = cheerio.load(html);
    const streams: Stream[] = [];

    const serverLinks: string[] = [];
    $('a[href*="hubcloud"], a[href*="xcloud"], a[href*="gdflix"], a[href*="drive.google"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) serverLinks.push(href);
    });

    for (const sLink of serverLinks.slice(0, 5)) {
      if (sLink.includes("hubcloud")) {
        const direct = await extractHubcloud(sLink);
        for (const d of direct) {
          streams.push({ server: "HubCloud", link: d, type: d.includes(".m3u8") ? "m3u8" : "mp4", quality: "1080" });
        }
      } else {
        streams.push({ server: "MyFlixBD", link: sLink, type: "mp4", quality: "1080" });
      }
    }

    return streams;
  } catch (e: any) {
    throw new Error(`MyFlixBD stream failed: ${e.message}`);
  }
}
