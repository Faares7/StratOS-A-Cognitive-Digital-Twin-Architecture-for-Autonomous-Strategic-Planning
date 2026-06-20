"use client";

/**
 * Client-only PDF viewer using react-pdf (pdf.js).
 * Loaded via dynamic import in the review page to avoid SSR.
 */

import React, { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

// Worker served from /public — version-locked to the installed pdfjs-dist,
// no CDN dependency, no webpack asset handling needed.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Props {
  url: string;
  targetPage: number;
}

export default function PdfViewer({ url, targetPage }: Props) {
  const [numPages,  setNumPages]  = useState<number>(0);
  const [page,      setPage]      = useState(1);
  const [width,     setWidth]     = useState(600);
  const [loadErr,   setLoadErr]   = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync to external scroll request
  useEffect(() => {
    if (targetPage >= 1 && targetPage <= numPages) {
      setPage(targetPage);
    }
  }, [targetPage, numPages]);

  // Measure container width for responsive rendering
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setWidth(el.clientWidth - 32); // 16px padding each side
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden bg-[#080a14]">
      {/* Controls */}
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30 transition"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs text-slate-500">
          Page {page} / {numPages || "—"}
        </span>
        <button
          disabled={page >= numPages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30 transition"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Document */}
      <div className="flex-1 overflow-y-auto flex justify-center py-4 px-4">
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }: { numPages: number }) => { setNumPages(n); setLoadErr(null); }}
          onLoadError={(err: Error) => setLoadErr(err.message)}
          loading={
            <div className="flex items-center gap-2 text-slate-600 py-16">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading PDF…</span>
            </div>
          }
          error={
            <p className="text-xs text-rose-400 py-8 text-center">
              {loadErr ?? "Failed to load PDF."}
            </p>
          }
        >
          <Page
            pageNumber={page}
            width={width > 0 ? width : 600}
            renderAnnotationLayer={true}
            renderTextLayer={true}
            className="shadow-2xl"
          />
        </Document>
      </div>
    </div>
  );
}
