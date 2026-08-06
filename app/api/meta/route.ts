export const runtime = 'nodejs';
import { NextRequest, NextResponse } from "next/server";
import { getMeta } from "@/lib/vega/movieBoxWeb";

export async function GET(request: NextRequest) {
  const link = request.nextUrl.searchParams.get("link");
  if (!link) {
    return NextResponse.json(
      { success: false, error: "Missing link param" },
      { status: 400 }
    );
  }

  try {
    const meta = await getMeta(link);
    return NextResponse.json(
      { success: true, meta },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
        },
      }
    );
  } catch (error: any) {
    console.error("Meta API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch metadata" },
      { status: 500 }
    );
  }
}
