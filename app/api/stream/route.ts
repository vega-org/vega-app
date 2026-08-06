export const runtime = 'nodejs';
import { NextRequest, NextResponse } from "next/server";
import { getStream as getMovieBoxStream } from "@/lib/vega/movieBoxWeb";
import { getStream as getMyFlixStream } from "@/lib/vega/myflixbd";

export async function GET(request: NextRequest) {
  const link = request.nextUrl.searchParams.get("link");
  if (!link) {
    return NextResponse.json({ success: false, error: "Missing link param" }, { status: 400 });
  }

  try {
    let streams: any[] = [];

    // Route to correct provider based on link
    if (link.includes("myflixbd") || link.includes("myflixbd.fun") || link.includes("hubcloud") || link.includes("gdflix")) {
      try {
        streams = await getMyFlixStream(link);
      } catch (e) {
        console.log("MyFlixBD stream failed, trying MovieBox fallback", e);
      }
    }

    // If not myflixbd or myflixbd failed, try MovieBox
    if (streams.length === 0) {
      try {
        streams = await getMovieBoxStream(link);
      } catch (e) {
        console.log("MovieBox stream failed", e);
      }
    }

    if (streams.length === 0) {
      return NextResponse.json(
        { success: false, error: "No working sources found. Try another title or check MyFlixBD provider.", count: 0, streams: [] },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { success: true, count: streams.length, streams },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("Stream API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "No sources", count: 0, streams: [] },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const link = body.link;
    if (!link) return NextResponse.json({ success: false, error: "Missing link" }, { status: 400 });
    // Reuse GET logic
    const fakeReq = { nextUrl: { searchParams: new URLSearchParams({ link }) } } as any;
    const res = await GET(fakeReq);
    return res;
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
