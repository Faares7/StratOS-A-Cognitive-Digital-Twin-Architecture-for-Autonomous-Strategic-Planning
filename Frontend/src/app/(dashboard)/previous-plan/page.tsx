"use client";

import React, { useCallback, useRef, useState } from "react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadAndExtract, uploadAndParseMd, listUploads, getSections } from "@/services/ocrApi";
import type { OcrResult, PlanSection, SectionType, UploadSummary } from "@/services/ocrApi";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  CheckCircle2,
  RefreshCcw,
  Upload,
  BookOpen,
  Zap,
  History,
  AlertTriangle,
  FlaskConical,
} from "lucide-react";

// ── Section metadata labels ───────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  cover:               "صفحة الغلاف",
  approval_date:       "تاريخ اعتماد الخطة",
  dean_message:        "كلمة العميد",
  prep_team:           "فريق الإعداد",
  table_of_contents:   "قائمة المحتويات",
  introduction:        "مقدمة الخطة",
  college_overview:    "نبذة عن الكلية",
  org_structure:       "الهيكل التنظيمي",
  financial_resources: "الموارد المالية",
  excellence_features: "سمات التميز",
  planning_philosophy: "الإطار الفكري",
  risk_assessment:     "تقييم المخاطر",
  vision_mission:      "الرؤية والرسالة والقيم",
  guiding_policies:    "السياسات المرشدة",
  swot_analysis:       "التحليل البيئي (SWOT)",
  gap_analysis:        "تحليل الفجوة",
  strategic_goals:     "الغايات والأهداف",
  implementation_plan: "الخطة التنفيذية",
  unknown:             "قسم غير محدد",
};

// ── Markdown → React renderer ─────────────────────────────────────────────────

function parseRow(line: string): string[] {
  // Protect escaped pipes \| so cell content doesn't break the split.
  return line
    .replace(/\\\|/g, "\x00")
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim().replace(/\x00/g, "|"));
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s|:\-]+\|$/.test(line.trim());
}

function MdTable({ lines }: { lines: string[] }) {
  const rows = lines.filter((l) => !isSeparatorRow(l));
  if (rows.length === 0) return null;
  const [header, ...body] = rows;
  const headers  = parseRow(header);
  const bodyRows = body
    .map(parseRow)
    .filter((row) => row.some((c) => c.trim() !== ""));

  if (headers.length === 0) return null;

  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full border-collapse text-[11px]" dir="rtl">
        <thead>
          <tr className="bg-white/[0.08]">
            {headers.map((h, j) => (
              <th
                key={j}
                className="border-b border-white/10 px-3 py-2 text-right font-semibold text-slate-200 whitespace-nowrap"
              >
                {h || "—"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-white/[0.02]" : ""}>
              {row.map((cell, ci) =>
                cell.trim() === "" ? (
                  <td key={ci} className="px-3 py-1.5" />
                ) : (
                  <td
                    key={ci}
                    className="border border-white/10 px-3 py-1.5 text-right text-slate-300 align-top"
                  >
                    {cell}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderContent(content: string): React.ReactNode {
  if (!content) return <p className="text-slate-500 text-xs">—</p>;

  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // blank or pure separator
    if (!line || /^-{3,}$/.test(line)) { i++; continue; }

    // table block — collect all consecutive pipe lines
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      nodes.push(<MdTable key={`tbl-${i}`} lines={tableLines} />);
      continue;
    }

    // headings
    const hm = line.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      const lvl = hm[1].length;
      const cls = lvl === 1
        ? "mt-3 text-sm font-bold text-slate-100"
        : lvl === 2
        ? "mt-2 text-xs font-bold text-slate-200"
        : "mt-1.5 text-xs font-semibold text-slate-300";
      nodes.push(<p key={i} className={cls} dir="rtl">{hm[2]}</p>);
      i++;
      continue;
    }

    // list items — collect a run
    if (line.startsWith("- ") || line.startsWith("• ")) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (l.startsWith("- ") || l.startsWith("• ")) {
          items.push(l.replace(/^[-•]\s+/, ""));
          i++;
        } else break;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="my-1.5 list-disc list-inside space-y-0.5" dir="rtl">
          {items.map((item, j) => (
            <li key={j} className="text-[11px] text-slate-300">{item}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // paragraph
    nodes.push(
      <p key={i} className="text-[11px] leading-relaxed text-slate-300" dir="rtl">
        {line}
      </p>,
    );
    i++;
  }

  return <>{nodes}</>;
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ section }: { section: PlanSection }) {
  const [expanded, setExpanded] = useState(false);
  const isStatic  = section.section_type === "static";
  const isDynamic = section.section_type === "dynamic";

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-200",
        isStatic  && "border-emerald-500/30 bg-emerald-500/5",
        isDynamic && "border-amber-500/30   bg-amber-500/5",
        !isStatic && !isDynamic && "border-white/10 bg-white/5",
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <div className="mt-0.5 shrink-0">
          {isStatic  && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          {isDynamic && <RefreshCcw   className="h-4 w-4 text-amber-400" />}
          {!isStatic && !isDynamic && <AlertTriangle className="h-4 w-4 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200" dir="rtl">
            {section.title_ar || SECTION_LABELS[section.section_key] || section.section_key}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Pages {section.page_start}–{section.page_end} ·{" "}
            {Math.ceil(section.content.length / 100) * 100} chars
          </p>
        </div>
        <div className="shrink-0 ml-2">
          {expanded
            ? <ChevronUp   className="h-4 w-4 text-slate-500" />
            : <ChevronDown className="h-4 w-4 text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="max-h-96 overflow-y-auto border-t border-white/5 px-4 py-3 space-y-1">
          {renderContent(section.content)}
        </div>
      )}
    </div>
  );
}

// ── Type filter tabs ──────────────────────────────────────────────────────────

const FILTERS: { value: SectionType | "all"; label: string; icon: React.ReactNode }[] = [
  { value: "all",     label: "All",     icon: <BookOpen     className="h-3.5 w-3.5" /> },
  { value: "static",  label: "Static",  icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> },
  { value: "dynamic", label: "Dynamic", icon: <RefreshCcw   className="h-3.5 w-3.5 text-amber-400" /> },
];

// ── Upload history row ────────────────────────────────────────────────────────

function HistoryRow({ upload, onLoad }: { upload: UploadSummary; onLoad: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm text-slate-200">{upload.filename}</p>
        <p className="text-[11px] text-slate-500">
          {upload.static_count} static · {upload.dynamic_count} dynamic ·{" "}
          {new Date(upload.uploaded_at).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={() => onLoad(upload.upload_id)}
        className="shrink-0 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/20"
      >
        Load
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Phase = "idle" | "uploading" | "results" | "error";

export default function PreviousPlanPage() {
  const fileInputRef              = useRef<HTMLInputElement>(null);
  const mdInputRef                = useRef<HTMLInputElement>(null);
  const [phase, setPhase]         = useState<Phase>("idle");
  const [progress, setProgress]   = useState("");
  const [error, setError]         = useState("");
  const [result, setResult]       = useState<OcrResult | null>(null);
  const [filter, setFilter]       = useState<SectionType | "all">("all");
  const [uploads, setUploads]     = useState<UploadSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragging, setDragging]   = useState(false);

  const handleFile = useCallback(async (file: File) => {
    const name  = file.name.toLowerCase();
    const isPdf = name.endsWith(".pdf");
    const isMd  = name.endsWith(".md");

    if (!isPdf && !isMd) {
      setError("Please upload a PDF or a pre-extracted .md file.");
      setPhase("error");
      return;
    }
    setPhase("uploading");
    setError("");
    try {
      const data = isMd
        ? await uploadAndParseMd(file, setProgress)
        : await uploadAndExtract(file, setProgress);
      setResult(data);
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // reset so same file can be re-selected
    e.target.value = "";
  };

  const loadHistory = async () => {
    try {
      const data = await listUploads();
      setUploads(data);
    } catch {
      setUploads([]);
    }
    setHistoryOpen(true);
  };

  const loadUpload = async (uploadId: string) => {
    setHistoryOpen(false);
    setPhase("uploading");
    setProgress("Loading saved sections…");
    try {
      const sections = await getSections(uploadId);
      const first    = sections[0];
      setResult({
        upload_id:   uploadId,
        filename:    first?.filename ?? "unknown.pdf",
        sections,
        total_pages: sections.reduce((m, s) => Math.max(m, s.page_end ?? 0), 0),
        stats:       { docai: 0, hybrid: 0, fallback: 0, empty: 0 },
      });
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const sections =
    result?.sections.filter((s) => filter === "all" || s.section_type === filter) ?? [];
  const staticCount  = result?.sections.filter((s) => s.section_type === "static").length  ?? 0;
  const dynamicCount = result?.sections.filter((s) => s.section_type === "dynamic").length ?? 0;

  return (
    <div className="flex h-screen flex-col bg-[#080a16]">
      <Header title="Previous Strategic Plan" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">

          {/* Page header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-100">Previous Plan OCR</h1>
              <p className="mt-1 text-sm text-slate-400">
                Upload the previous strategic plan PDF to extract static sections that carry
                over unchanged to the new plan.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHistory}
              className="flex items-center gap-2 border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            >
              <History className="h-3.5 w-3.5" />
              History
            </Button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm text-slate-300">
                <span className="font-medium text-emerald-400">Static</span> — copied as-is to the new plan
              </span>
            </div>
            <div className="flex items-center gap-2">
              <RefreshCcw className="h-4 w-4 text-amber-400" />
              <span className="text-sm text-slate-300">
                <span className="font-medium text-amber-400">Dynamic</span> — regenerated by StratOS agents
              </span>
            </div>
          </div>

          {/* Upload history */}
          {historyOpen && (
            <div className="rounded-xl border border-white/10 bg-[#0d1117] p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Previous uploads
              </p>
              {uploads.length === 0 ? (
                <p className="text-sm text-slate-500">No uploads yet.</p>
              ) : (
                uploads.map((u) => (
                  <HistoryRow key={u.upload_id} upload={u} onLoad={loadUpload} />
                ))
              )}
            </div>
          )}

          {/* Upload zone — two panels */}
          {(phase === "idle" || phase === "error") && (
            <div className="grid grid-cols-2 gap-4">
              {/* PDF upload */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-10 transition-colors",
                  dragging
                    ? "border-cyan-500/60 bg-cyan-500/10"
                    : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]",
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                  <Upload className="h-5 w-5 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-200">Upload PDF</p>
                  <p className="mt-1 text-xs text-slate-500">Calls Document AI — full extraction</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={onFileChange}
                />
              </div>

              {/* MD test upload */}
              <div
                onClick={() => mdInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-violet-500/30 bg-violet-500/5 py-10 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10">
                  <FlaskConical className="h-5 w-5 text-violet-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-violet-300">Upload .md file</p>
                  <p className="mt-1 text-xs text-violet-400/70">
                    Test mode — no API costs
                  </p>
                </div>
                <input
                  ref={mdInputRef}
                  type="file"
                  accept=".md"
                  className="hidden"
                  onChange={onFileChange}
                />
              </div>
            </div>
          )}

          {/* Error state */}
          {phase === "error" && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-300">Extraction failed</p>
                <p className="mt-0.5 text-xs text-red-400/80">{error}</p>
              </div>
            </div>
          )}

          {/* Processing state */}
          {phase === "uploading" && (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
              <div className="text-center">
                <p className="text-sm font-medium text-slate-200">Processing…</p>
                <p className="mt-1 text-xs text-slate-500">{progress}</p>
              </div>
            </div>
          )}

          {/* Results */}
          {phase === "results" && result && (
            <>
              {/* Summary bar */}
              <div className="grid grid-cols-3 gap-4">
                <StatCard
                  icon={<FileText     className="h-4 w-4 text-slate-400"   />}
                  label="Total Pages"     value={result.total_pages} color="slate"
                />
                <StatCard
                  icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  label="Static Sections" value={staticCount}        color="emerald"
                />
                <StatCard
                  icon={<RefreshCcw   className="h-4 w-4 text-amber-400"   />}
                  label="Dynamic Sections" value={dynamicCount}      color="amber"
                />
              </div>

              {/* Extraction mode badge */}
              {result.mode && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Extraction engine:</span>
                  <span className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                    result.mode === "docai+pdfium"  && "bg-cyan-500/15    text-cyan-400",
                    result.mode === "pdfium_only"   && "bg-slate-500/15   text-slate-400",
                    result.mode === "md_parse"      && "bg-violet-500/15  text-violet-400",
                  )}>
                    {result.mode === "docai+pdfium"  && "Google Document AI + pypdfium2"}
                    {result.mode === "pdfium_only"   && "pypdfium2 (native PDF text)"}
                    {result.mode === "md_parse"      && "Test mode — pre-extracted .md"}
                  </span>
                </div>
              )}

              {/* Filter + reset */}
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setFilter(f.value)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        filter === f.value
                          ? "bg-cyan-500/20 text-cyan-300"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200",
                      )}
                    >
                      {f.icon}
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setPhase("idle"); setResult(null); }}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Upload new plan
                </button>
              </div>

              {/* Section cards */}
              <div className="space-y-2">
                {sections.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    No sections match this filter.
                  </p>
                ) : (
                  sections.map((sec, i) => (
                    <SectionCard key={`${sec.section_key}-${i}`} section={sec} />
                  ))
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "slate" | "emerald" | "amber";
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4",
      color === "slate"   && "border-white/10       bg-white/5",
      color === "emerald" && "border-emerald-500/20  bg-emerald-500/5",
      color === "amber"   && "border-amber-500/20    bg-amber-500/5",
    )}>
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs text-slate-400">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}
