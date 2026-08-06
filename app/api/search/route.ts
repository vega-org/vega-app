export const runtime = 'nodejs';
import { NextRequest, NextResponse } from "next/server";
import { getSearchPosts } from "@/lib/vega/movieBoxWeb";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q") || searchParams.get("query") || "";
  const page = parseInt(searchParams.get("page") || "1", 10);

  if (!q.trim()) {
    return NextResponse.json({ success: true, posts: [], query: q });
  }

  try {
    const posts = await getSearchPosts(q, page);
    return NextResponse.json({
      success: true,
      query: q,
      page,
      count: posts.length,
      posts,
    });
  } catch (error: any) {
    console.error("Search API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Search failed" },
      { status: 500 }
    );
  }
}
