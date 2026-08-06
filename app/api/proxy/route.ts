export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9, bn;q=0.8",
  "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "video",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
};

function getReferer(url: string, refererParam?: string | null): string {
  if (refererParam) return refererParam;
  // Core engine is movie-box.co
  return "https://movie-box.co/";
}

function getOrigin(referer: string): string {
  try {
    return new URL(referer).origin;
  } catch {
    return "https://movie-box.co";
  }
}

function rewriteM3u8(content: string, baseUrl: string, referer: string): string {
  const base = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
  const lines = content.split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
            try {
              const resolved = new URL(uri, base).toString();
              const proxied = `/api/proxy?url=${encodeURIComponent(resolved)}&referer=${encodeURIComponent(referer)}`;
              return `URI="${proxied}"`;
            } catch {
              return _;
            }
          });
        }
        return line;
      }
      try {
        const resolved = new URL(trimmed, base).toString();
        return `/api/proxy?url=${encodeURIComponent(resolved)}&referer=${encodeURIComponent(referer)}`;
      } catch {
        return line;
      }
    })
    .join("\n");
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const refererParam = request.nextUrl.searchParams.get("referer");
  const range = request.headers.get("range");

  if (!url) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  const host = targetUrl.hostname;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.endsWith(".internal")
  ) {
    return NextResponse.json({ error: "Blocked host" }, { status: 403 });
  }

  const referer = getReferer(url, refererParam);
  const origin = getOrigin(referer);

  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    Referer: referer,
    Origin: origin,
  };

  if (range) headers["Range"] = range;

  // For bcdnxw and hakunaymatata, try to add extra headers that MovieBox uses
  if (host.includes("hakunaymatata") || host.includes("bcdn")) {
    headers["Accept"] = "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5";
    // MovieBox player might send cookie-less, but we try
  }

  try {
    const upstream = await fetch(url, {
      headers,
      cache: "no-store",
      // @ts-ignore
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      // Try alternative public CORS proxies for bcdn which blocks Vercel IPs
      if (host.includes("hakunaymatata") || host.includes("bcdn") || host.includes("aoneroom")) {
        try {
          // Try corsproxy.io as fallback - it uses Cloudflare Workers IP which may not be blocked
          const fallbackUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
          const fallbackRes = await fetch(fallbackUrl, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] } });
          if (fallbackRes.ok) {
            const contentType = fallbackRes.headers.get("content-type") || "";
            const isM3u8 = url.includes(".m3u8") || contentType.includes("mpegurl");
            if (isM3u8) {
              const text = await fallbackRes.text();
              const rewritten = rewriteM3u8(text, url, referer);
              return new NextResponse(rewritten, {
                status: 200,
                headers: {
                  "Content-Type": "application/vnd.apple.mpegurl",
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": "no-cache",
                },
              });
            }
            if (fallbackRes.body) {
              return new NextResponse(fallbackRes.body as any, {
                status: fallbackRes.status,
                headers: {
                  "Content-Type": contentType || "application/octet-stream",
                  "Access-Control-Allow-Origin": "*",
                  "Accept-Ranges": "bytes",
                },
              });
            }
          }
        } catch {}
      }

      const text = await upstream.text().catch(() => "");
      return new NextResponse(text, {
        status: upstream.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/plain",
        },
      });
    }

    const contentType = upstream.headers.get("content-type") || "";
    const isM3u8 =
      url.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("application/vnd.apple.mpegurl");

    if (isM3u8) {
      const text = await upstream.text();
      const rewritten = rewriteM3u8(text, url, referer);
      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type",
          "Cache-Control": "no-cache",
        },
      });
    }

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, s-maxage=3600",
    };

    const contentRange = upstream.headers.get("content-range");
    const contentLength = upstream.headers.get("content-length");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;
    if (contentLength) responseHeaders["Content-Length"] = contentLength;

    if (upstream.body) {
      return new NextResponse(upstream.body as any, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error("Proxy error", error);
    return NextResponse.json({ error: error.message || "Proxy failed", url }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
    },
  });
}
