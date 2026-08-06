export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { catalog } from "@/lib/vega/movieBoxWeb";
import { getAllBaseUrls } from "@/lib/vega/baseUrl";

export async function GET() {
  try {
    const urls = await getAllBaseUrls().catch(() => ({} as any));
    return NextResponse.json({
      success: true,
      provider: {
        id: "movieBoxWeb",
        name: "WellFlix Core Engine",
        displayName: "WellFlix (MovieBox)",
        version: "1.4",
        bakedIn: true,
        baseUrl: (urls as any)["movieBoxWeb"]?.url || "https://themoviebox.org",
        catalog,
        features: ["movies", "series", "search", "multi-audio", "subtitles", "4K"],
        description: "Integrated Vega provider powering WellFlix streaming",
      },
    });
  } catch (e: any) {
    return NextResponse.json({
      success: true,
      provider: {
        id: "movieBoxWeb",
        name: "WellFlix Core Engine",
        bakedIn: true,
        catalog,
      },
    });
  }
}
