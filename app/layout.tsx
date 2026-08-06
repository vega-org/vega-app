import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.URL) return process.env.URL; // Netlify provides URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://wellflix.netlify.app";
}

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: "WellFlix - Premium Streaming | Movies & Series",
  description:
    "WellFlix is a premium streaming platform powered by Vega providers. Watch movies and TV series in 4K with multi-source streaming, just like Netflix, Prime Video & Max. Baked-in provider, no setup needed.",
  keywords: ["WellFlix", "streaming", "movies", "TV series", "Vega", "Netflix", "Max", "4K"],
  authors: [{ name: "WellFlix" }],
  openGraph: {
    title: "WellFlix - Premium Streaming",
    description: "Watch movies and series in 4K - Powered by Vega",
    type: "website",
    images: ["/og.jpg"],
  },
  twitter: {
    card: "summary_large_image",
    title: "WellFlix - Premium Streaming",
    description: "Watch movies and series in 4K - Powered by Vega",
  },
  metadataBase: new URL(siteUrl),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Instrument+Sans:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#0a0a0b] text-[#fafaf9] antialiased selection:bg-[#5b5cf6] selection:text-white">
        {children}
      </body>
    </html>
  );
}
