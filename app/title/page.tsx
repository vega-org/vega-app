"use client";

import { Suspense } from "react";
import Navbar from "@/components/Navbar";
import TitleDetail from "@/components/TitleDetail";

export default function TitlePage() {
  return (
    <main className="min-h-screen bg-[#0a0a0b]">
      <Navbar />
      <Suspense fallback={<div className="min-h-screen bg-[#0a0a0b] animate-pulse" />}>
        <TitleDetail />
      </Suspense>
    </main>
  );
}
