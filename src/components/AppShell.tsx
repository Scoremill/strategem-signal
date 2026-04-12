"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const open = useCallback(() => setDrawerOpen(true), []);
  const close = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="h-screen bg-[#F8FAFC] flex flex-col">
      <Sidebar isOpen={drawerOpen} onClose={close} />

      {/* Top bar — thin, with hamburger and brand */}
      <header className="flex-shrink-0 z-30 flex items-center gap-3 px-3 sm:px-4 h-12 bg-white border-b border-gray-200">
        <button
          onClick={open}
          aria-label="Open navigation"
          className="p-2 -ml-2 rounded-md text-[#4B5563] hover:bg-gray-100 hover:text-[#1E293B] transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href="/dashboard" className="flex items-center h-full py-2">
          <Image
            src="/Logo.png"
            alt="StrategemSignal"
            width={862}
            height={153}
            priority
            className="h-8 w-auto"
          />
        </Link>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
}
