"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Clock, FileText, Sparkles,
  MoreHorizontal, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanDocument } from "@/types/plan-document";

// ── localStorage keys ──────────────────────────────────────────────────────────

const LANG_KEYS = ["en", "ar"] as const;
const storageKey = (lang: string) => `stratos-plan-draft-v2-${lang}`;

// ── Template preview thumbnails ────────────────────────────────────────────────

function BlankDocPreview() {
  return (
    <div className="w-full h-full bg-[#f5f4ef] flex flex-col overflow-hidden">
      {/* running header stub */}
      <div className="shrink-0 h-5 border-b border-[#b8922f]/30 bg-[#f5f4ef] flex items-center justify-between px-2">
        <div className="h-3 w-3 rounded-sm bg-[#1e293b]/40 border border-[#b8922f]/40" />
        <div className="h-1 w-8 rounded-full bg-[#b8922f]/30" />
      </div>
      {/* cover page: just logo + title lines, no chapters */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <div className="h-5 w-5 rounded bg-[#1e293b]/60 border border-[#b8922f]/60 flex items-center justify-center">
          <div className="h-2 w-2 rounded-sm bg-[#b8922f]/50" />
        </div>
        <div className="h-2 w-14 rounded-sm bg-[#1e293b]/50" />
        <div className="h-1 w-9 rounded-sm bg-[#b8922f]/50" />
        <div className="flex items-center gap-1 mt-1">
          <div className="h-px w-4 bg-[#b8922f]/30" />
          <div className="h-1 w-1 rounded-full bg-[#b8922f]/30" />
          <div className="h-px w-4 bg-[#b8922f]/30" />
        </div>
      </div>
    </div>
  );
}

function ActionPlanPreview() {
  return (
    <div className="w-full h-full bg-white flex flex-col overflow-hidden" dir="rtl">
      {/* cover stub */}
      <div className="shrink-0 bg-white flex flex-col items-center justify-center gap-1 py-2 border-b border-slate-200">
        <div className="h-px w-10 bg-[#3b6ca8]" />
        <div className="h-1.5 w-12 rounded-sm bg-slate-700" />
        <div className="h-1 w-9 rounded-sm bg-slate-400" />
        <div className="h-px w-10 bg-[#3b6ca8]" />
      </div>
      {/* mini table */}
      <div className="flex-1 p-1 flex flex-col gap-0.5">
        {/* banner row */}
        <div className="h-2 rounded-sm w-full" style={{ background: '#bdd7ee' }} />
        {/* header row */}
        <div className="flex gap-px">
          {[14, 16, 20, 12, 10, 20, 8].map((w, i) => (
            <div key={i} className="h-1.5 rounded-sm" style={{ width: `${w}%`, background: '#bdd7ee' }} />
          ))}
        </div>
        {/* data rows */}
        {[0, 1, 2, 3].map(r => (
          <div key={r} className="flex gap-px">
            {[14, 16, 20, 12, 10, 20, 8].map((w, i) => (
              <div key={i} className="h-1 rounded-sm bg-slate-100 border border-slate-200" style={{ width: `${w}%` }} />
            ))}
          </div>
        ))}
        {/* second banner row */}
        <div className="h-2 rounded-sm w-full mt-0.5" style={{ background: '#bdd7ee' }} />
        {/* data rows */}
        {[0, 1].map(r => (
          <div key={r} className="flex gap-px">
            {[14, 16, 20, 12, 10, 20, 8].map((w, i) => (
              <div key={i} className="h-1 rounded-sm bg-slate-100 border border-slate-200" style={{ width: `${w}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function FormalGovPreview({ mini = false }: { mini?: boolean }) {
  return (
    <div className="w-full h-full bg-[#f5f4ef] flex flex-col overflow-hidden">
      {/* running header */}
      <div
        className="shrink-0 border-b border-[#b8922f]/40 bg-[#f5f4ef] flex items-center justify-between px-2"
        style={{ height: mini ? 12 : 16 }}
      >
        <div className="flex items-center gap-1">
          <div className={cn("rounded-sm bg-[#b8922f]/60", mini ? "h-1 w-3" : "h-1.5 w-4")} />
        </div>
        <div className={cn("rounded-full bg-slate-400/25", mini ? "h-0.5 w-5" : "h-1 w-7")} />
      </div>
      {/* cover page simulation */}
      <div className="flex-1 flex flex-col items-center justify-center gap-1.5">
        {/* decorative diamond */}
        <div className={cn("text-[#b8922f]/10 font-serif select-none leading-none", mini ? "text-lg" : "text-2xl")}>◆</div>
        {/* logo placeholder */}
        <div className={cn("rounded-sm bg-[#1e293b]/70", mini ? "h-2 w-4" : "h-3 w-6")} />
        {/* title lines */}
        <div className={cn("rounded-sm bg-[#1e293b]/60 mt-0.5", mini ? "h-1.5 w-10" : "h-2 w-14")} />
        <div className={cn("rounded-sm bg-[#b8922f]/70", mini ? "h-1 w-7" : "h-1.5 w-10")} />
        {/* divider */}
        <div className="flex items-center gap-0.5 mt-0.5">
          <div className={cn("bg-[#b8922f]/35", mini ? "h-px w-2" : "h-px w-3")} />
          <div className={cn("rounded-full bg-[#b8922f]/35", mini ? "h-0.5 w-0.5" : "h-1 w-1")} />
          <div className={cn("bg-[#b8922f]/35", mini ? "h-px w-2" : "h-px w-3")} />
        </div>
        {/* org line */}
        <div className={cn("rounded-sm bg-slate-400/25 mt-0.5", mini ? "h-0.5 w-8" : "h-1.5 w-12")} />
      </div>
    </div>
  );
}

// ── Template card (Google Docs style) ─────────────────────────────────────────

interface TemplateCardProps {
  label: string;
  sublabel?: string;
  preview: React.ReactNode;
  badge?: string;
  onClick: () => void;
}

function TemplateCard({ label, sublabel, preview, badge, onClick }: TemplateCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-2.5 text-left focus:outline-none"
    >
      {/* thumbnail */}
      <div
        className="relative overflow-hidden rounded-xl border-2 border-white/6 bg-white/3 shadow-md transition-all duration-200
          group-hover:border-[#b8922f]/70 group-hover:shadow-[0_0_0_1px_rgba(184,146,47,0.25),0_16px_48px_rgba(0,0,0,0.55)]
          group-focus:border-[#b8922f]/70"
        style={{ width: 140, height: 196 }}
      >
        <div className="absolute inset-0">{preview}</div>
        {/* gold sheen on hover */}
        <div className="absolute inset-0 rounded-xl bg-[#b8922f]/0 transition-colors duration-200 group-hover:bg-[#b8922f]/5" />
        {badge && (
          <span className="absolute top-2 start-2 rounded-full bg-[#0b0e1a]/80 px-2 py-0.5 text-[9px] font-bold uppercase text-[#b8922f] backdrop-blur">
            {badge}
          </span>
        )}
      </div>
      {/* labels */}
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-semibold text-slate-300 transition-colors duration-200 group-hover:text-[#b8922f]">
          {label}
        </p>
        {sublabel && (
          <p className="text-[10px] text-slate-600">{sublabel}</p>
        )}
      </div>
    </button>
  );
}

// ── Recent document card ───────────────────────────────────────────────────────

function RecentDocCard({
  doc, lang, onOpen, onDelete,
}: {
  doc: PlanDocument;
  lang: "en" | "ar";
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const edited = new Date(doc.updatedAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

  const statusStyles: Record<string, string> = {
    draft:      "text-amber-400 bg-amber-500/10",
    generating: "text-cyan-400 bg-cyan-500/10",
    final:      "text-emerald-400 bg-emerald-500/10",
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-[#0d1020] transition-all duration-200 hover:border-white/10 hover:shadow-xl">
      {/* Thumbnail — clickable */}
      <button
        onClick={onOpen}
        className="relative h-32 w-full overflow-hidden border-b border-white/5 focus:outline-none"
      >
        <FormalGovPreview />
        {/* overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/15 opacity-0 group-hover:opacity-100 transition-opacity" />
        {/* language badge */}
        <span className="absolute top-2 end-2 rounded-full bg-[#080a16]/80 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-400 backdrop-blur">
          {lang}
        </span>
        {/* chapter count */}
        <span className="absolute bottom-2 start-2 rounded-full bg-[#080a16]/80 px-2 py-0.5 text-[9px] text-slate-500 backdrop-blur">
          {doc.chapters.length} ch.
        </span>
      </button>

      {/* Metadata */}
      <div className="flex flex-col gap-1.5 p-3">
        <button onClick={onOpen} className="text-left focus:outline-none">
          <h3 className="line-clamp-2 text-[11px] font-semibold leading-snug text-slate-200 group-hover:text-white transition-colors">
            {doc.meta.title}
          </h3>
          {doc.meta.orgName && (
            <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-600">{doc.meta.orgName}</p>
          )}
        </button>

        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide", statusStyles[doc.docStatus] ?? "text-slate-600")}>
            {doc.docStatus}
          </span>
          <div className="flex items-center gap-1 text-[10px] text-slate-600">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            {edited}
          </div>
        </div>
      </div>

      {/* Context menu trigger */}
      <div className="absolute top-2 end-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ top: 136 }}>
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0d1020]/90 text-slate-500 hover:text-slate-300 backdrop-blur transition-colors"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute end-0 top-7 z-50 w-36 overflow-hidden rounded-lg border border-white/10 bg-[#1a2030] shadow-xl">
                <button
                  onClick={() => { setMenuOpen(false); onOpen(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" /> Open
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PlanHomePage() {
  const router = useRouter();
  const [recentDocs, setRecentDocs] = useState<Array<{ doc: PlanDocument; lang: "en" | "ar" }>>([]);
  const [search, setSearch] = useState("");

  const loadRecent = () => {
    const docs: Array<{ doc: PlanDocument; lang: "en" | "ar" }> = [];
    for (const lang of LANG_KEYS) {
      try {
        const raw = localStorage.getItem(storageKey(lang));
        if (!raw) continue;
        const parsed = JSON.parse(raw) as PlanDocument;
        if (parsed?.meta?.title && Array.isArray(parsed.chapters)) {
          docs.push({ doc: parsed, lang });
        }
      } catch { /* ignore */ }
    }
    docs.sort((a, b) => new Date(b.doc.updatedAt).getTime() - new Date(a.doc.updatedAt).getTime());
    setRecentDocs(docs);
  };

  useEffect(() => { loadRecent(); }, []);

  const openTemplate = (kind: "blank" | "template", lang: "en" | "ar" = "en") => {
    try {
      sessionStorage.setItem("plan-editor-init", JSON.stringify({ kind, lang }));
    } catch { /* ignore */ }
    router.push("/plan-generation/editor");
  };

  const openActionPlan = (kind: "blank" | "sample") => {
    try {
      sessionStorage.setItem("action-plan-init", JSON.stringify({ kind }));
    } catch { /* ignore */ }
    router.push("/plan-generation/action-plan");
  };

  const openRecent = (lang: "en" | "ar") => {
    try {
      sessionStorage.setItem("plan-editor-init", JSON.stringify({ kind: "recent", lang }));
    } catch { /* ignore */ }
    router.push("/plan-generation/editor");
  };

  const deleteRecent = (lang: "en" | "ar") => {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    localStorage.removeItem(storageKey(lang));
    loadRecent();
  };

  const filtered = recentDocs.filter(
    ({ doc }) =>
      !search ||
      doc.meta.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.meta.orgName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#0b0e1a]">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-white/5 bg-[#080a16]">
        <div className="mx-auto max-w-6xl px-8 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#b8922f]/10">
              <Sparkles className="h-4 w-4 text-[#b8922f]" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-200 leading-tight">Plan Generation</h1>
              <p className="text-[10px] text-slate-600 mt-0.5">Strategic documents powered by AI agents</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative w-64">
            <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search plans…"
              className="w-full rounded-lg border border-white/8 bg-[#0d1020] py-2 ps-9 pe-3 text-xs text-slate-300 placeholder-slate-600 outline-none transition-colors focus:border-[#b8922f]/40"
            />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-8 py-8">

        {/* ── Template gallery ── */}
        {!search && (
          <section>
            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-200">Start a new plan</h2>
            </div>

            <div className="flex items-start gap-5 overflow-x-auto pb-3">
              {/* Blank Document */}
              <TemplateCard
                label="Blank Document"
                sublabel="Start with just a cover page"
                preview={<BlankDocPreview />}
                onClick={() => router.push("/plan-generation/blank")}
              />

              {/* Strategic Plan */}
              <TemplateCard
                label="Strategic Plan"
                sublabel="AI-generated strategic document"
                preview={<FormalGovPreview />}
                onClick={() => openTemplate("template", "en")}
              />

              {/* Executive Plan Report */}
              <TemplateCard
                label="Executive Plan Report"
                sublabel="Action plan follow-up table"
                preview={<ActionPlanPreview />}
                onClick={() => openActionPlan("sample")}
              />
            </div>
          </section>
        )}

        {/* ── Divider ── */}
        {!search && recentDocs.length > 0 && (
          <div className="h-px bg-white/5" />
        )}

        {/* ── Recent plans ── */}
        <section>
          <div className="mb-5 flex items-center gap-2">
            {search ? (
              <h2 className="text-sm font-semibold text-slate-200">
                Results for &ldquo;{search}&rdquo;
              </h2>
            ) : (
              <>
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-200">Recent plans</h2>
              </>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-white/3">
                <FileText className="h-7 w-7 text-slate-600" />
              </div>
              <p className="text-sm font-medium text-slate-400">
                {search ? "No plans match your search." : "No recent plans yet."}
              </p>
              {!search && (
                <p className="mt-2 text-xs text-slate-600">
                  Pick a template above to create your first strategic plan.
                </p>
              )}
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="mt-4 text-xs text-[#b8922f] hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map(({ doc, lang }) => (
                <RecentDocCard
                  key={lang}
                  doc={doc}
                  lang={lang}
                  onOpen={() => openRecent(lang)}
                  onDelete={() => deleteRecent(lang)}
                />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
