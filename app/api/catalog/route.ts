export const runtime = 'nodejs';
import { NextRequest, NextResponse } from "next/server";
import { getPosts, catalog } from "@/lib/vega/movieBoxWeb";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filter = searchParams.get("filter") || "/";
  const page = parseInt(searchParams.get("page") || "1", 10);

  try {
    const posts = await getPosts(filter, page);
    return NextResponse.json({
      success: true,
      filter,
      page,
      count: posts.length,
      posts,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      }
    });
  } catch (error: any) {
    console.error("Catalog API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch catalog" },
      { status: 500 }
    );
  }
}
