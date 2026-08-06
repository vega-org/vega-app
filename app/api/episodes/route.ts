export const runtime = 'nodejs';
import { NextRequest, NextResponse } from "next/server";
import { getEpisodes } from "@/lib/vega/movieBoxWeb";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { success: false, error: "Missing url param" },
      { status: 400 }
    );
  }

  try {
    const episodes = await getEpisodes(url);
    return NextResponse.json({
      success: true,
      count: episodes.length,
      episodes,
    });
  } catch (error: any) {
    console.error("Episodes API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch episodes" },
      { status: 500 }
    );
  }
}
