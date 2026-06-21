"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import {
  Printer, RotateCcw, Globe, Bold, Italic, Link2,
  AlignLeft, List as ListIcon, Table as TableIcon, Image as ImageIcon,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Template } from "@/templates/plan/formal-gov/Template";
import { OutlinePanel } from "@/components/plan/OutlinePanel";
import { ChatPanel } from "@/components/plan/ChatPanel";
import type { SelectedBlockInfo, ChatPanelHandle } from "@/components/plan/ChatPanel";
import { ActiveEditorCtx } from "@/components/plan/ActiveEditorCtx";
import type { ActiveEditorCtxValue } from "@/components/plan/ActiveEditorCtx";
import { makeBlankPlan } from "@/templates/plan/sample-plan";
import type {
  PlanDocument, Block, Chapter, Subchapter, HumanProvenance, PlanMeta,
} from "@/types/plan-document";
import type { EditorApi } from "@/components/plan/EditorApi";
import { blockToText } from "@/lib/blockSerializer";

// ── Storage ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = (lang: string) => `stratos-blank-draft-${lang}`;

// ── Logo inheritance from strategic plan ───────────────────────────────────────

function inheritLogo(doc: PlanDocument): PlanDocument {
  if (doc.meta.orgLogoUrl) return doc;
  try {
    for (const l of ["en", "ar"]) {
      const raw = localStorage.getItem(`stratos-plan-draft-v2-${l}`);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as PlanDocument;
      if (parsed?.meta?.orgLogoUrl) {
        return { ...doc, meta: { ...doc.meta, orgLogoUrl: parsed.meta.orgLogoUrl } };
      }
    }
  } catch { /* ignore */ }
  return doc;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function humanProv(): HumanProvenance {
  return { kind: "human", editedAt: new Date().toISOString() };
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function newBlock(kind: Block["type"]): Block {
  const id = `b-${uid()}`;
  const prov = humanProv();
  switch (kind) {
    case "paragraph":
      return { id, type: "paragraph", provenance: prov, content: { type: "doc", content: [{ type: "paragraph", content: [] }] } };
    case "list":
      return { id, type: "list", provenance: prov, ordered: false, items: [{ type: "text", text: "" }] };
    case "table":
      return { id, type: "table", provenance: prov, header: ["Column 1", "Column 2"], rows: [[{ type: "text", text: "" }, { type: "text", text: "" }]] };
    case "image":
      return { id, type: "image", provenance: prov, url: "", alt: "", width: "full" };
  }
}

function newSubchapter(order: number): Subchapter {
  return {
    id: `sub-${uid()}`, canonicalKey: null, heading: "New Section",
    order, status: "auto", generation: "complete", userAdded: true,
    blocks: [newBlock("paragraph")],
  };
}

function newChapter(number: number): Chapter {
  return {
    id: `ch-${uid()}`, number, title: "New Chapter",
    canonicalKey: null, userAdded: true, sections: [newSubchapter(0)],
  };
}

function findBlockInfo(doc: PlanDocument, blockId: string): SelectedBlockInfo | null {
  for (const sub of (doc.preface ?? [])) {
    for (const b of sub.blocks) {
      if (b.id === blockId) return {
        blockId, chapterId: "preface", subId: sub.id,
        heading: sub.heading, blockType: b.type,
        rawContent: blockToText(b), provenance: b.provenance,
      };
    }
  }
  for (const ch of doc.chapters) {
    for (const b of (ch.intro ?? [])) {
      if (b.id === blockId) return {
        blockId, chapterId: ch.id, subId: null,
        heading: ch.title, blockType: b.type,
        rawContent: blockToText(b), provenance: b.provenance,
      };
    }
    for (const sub of ch.sections) {
      for (const b of sub.blocks) {
        if (b.id === blockId) return {
          blockId, chapterId: ch.id, subId: sub.id,
          heading: sub.heading, blockType: b.type,
          rawContent: blockToText(b), provenance: b.provenance,
        };
      }
    }
  }
  return null;
}

// ── EditorApi hook ─────────────────────────────────────────────────────────────

function useEditorApi(setDoc: React.Dispatch<React.SetStateAction<PlanDocument>>): EditorApi {
  return useMemo<EditorApi>(() => ({

    updateBlock(chapterId, subId, blockId, next) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          if (subId === null) return { ...ch, intro: (ch.intro ?? []).map(b => b.id === blockId ? next : b) };
          return { ...ch, sections: ch.sections.map(sub => sub.id !== subId ? sub : { ...sub, status: sub.status === "auto" ? "edited" : sub.status, blocks: sub.blocks.map(b => b.id === blockId ? next : b) }) };
        }),
      }));
    },

    addBlock(chapterId, subId, kind, afterBlockId) {
      const nb = newBlock(kind);
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          const insertInto = (blocks: Block[]): Block[] => {
            if (!afterBlockId) return [...blocks, nb];
            const idx = blocks.findIndex(b => b.id === afterBlockId);
            const next = [...blocks]; next.splice(idx + 1, 0, nb); return next;
          };
          if (subId === null) return { ...ch, intro: insertInto(ch.intro ?? []) };
          return { ...ch, sections: ch.sections.map(sub => sub.id !== subId ? sub : { ...sub, status: sub.status === "auto" ? "edited" : sub.status, blocks: insertInto(sub.blocks) }) };
        }),
      }));
    },

    deleteBlock(chapterId, subId, blockId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          if (subId === null) return { ...ch, intro: (ch.intro ?? []).filter(b => b.id !== blockId) };
          return { ...ch, sections: ch.sections.map(sub => sub.id !== subId ? sub : { ...sub, blocks: sub.blocks.filter(b => b.id !== blockId) }) };
        }),
      }));
    },

    moveBlock(chapterId, subId, blockId, dir) {
      const swap = (arr: Block[]) => {
        const i = arr.findIndex(b => b.id === blockId);
        if (i === -1) return arr;
        const j = dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= arr.length) return arr;
        const next = [...arr]; [next[i], next[j]] = [next[j], next[i]]; return next;
      };
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          if (subId === null) return { ...ch, intro: swap(ch.intro ?? []) };
          return { ...ch, sections: ch.sections.map(sub => sub.id !== subId ? sub : { ...sub, blocks: swap(sub.blocks) }) };
        }),
      }));
    },

    setHeading(chapterId, subId, text) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          if (subId === null) return { ...ch, title: text };
          return { ...ch, sections: ch.sections.map(sub => sub.id !== subId ? sub : { ...sub, heading: text, status: sub.status === "auto" ? "edited" : sub.status }) };
        }),
      }));
    },

    approveSubchapter(chapterId, subId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => ch.id !== chapterId ? ch : { ...ch, sections: ch.sections.map(sub => sub.id !== subId ? sub : { ...sub, status: "verified" }) }),
      }));
    },

    addSubchapter(chapterId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => ch.id !== chapterId ? ch : { ...ch, sections: [...ch.sections, newSubchapter(ch.sections.length)] }),
      }));
    },

    deleteSubchapter(chapterId, subId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => ch.id !== chapterId ? ch : { ...ch, sections: ch.sections.filter(s => s.id !== subId) }),
      }));
    },

    moveSubchapter(chapterId, subId, dir) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          const arr = [...ch.sections];
          const i = arr.findIndex(s => s.id === subId);
          const j = dir === "up" ? i - 1 : i + 1;
          if (i === -1 || j < 0 || j >= arr.length) return ch;
          [arr[i], arr[j]] = [arr[j], arr[i]];
          return { ...ch, sections: arr };
        }),
      }));
    },

    addChapter() {
      setDoc(doc => {
        const maxNum = doc.chapters.reduce((m, c) => Math.max(m, c.number), 0);
        return { ...doc, chapters: [...doc.chapters, newChapter(maxNum + 1)] };
      });
    },

    deleteChapter(chapterId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.filter(ch => ch.id !== chapterId).map((ch, i) => ({ ...ch, number: i + 1 })),
      }));
    },

    moveChapter(chapterId, dir) {
      setDoc(doc => {
        const arr = [...doc.chapters];
        const i = arr.findIndex(c => c.id === chapterId);
        const j = dir === "up" ? i - 1 : i + 1;
        if (i === -1 || j < 0 || j >= arr.length) return doc;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        return { ...doc, chapters: arr.map((ch, idx) => ({ ...ch, number: idx + 1 })) };
      });
    },

    updateMeta(patch: Partial<PlanMeta>) {
      setDoc(doc => ({ ...doc, meta: { ...doc.meta, ...patch } }));
    },

  }), [setDoc]);
}

// ── Format toolbar button ──────────────────────────────────────────────────────

function FmtBtn({ active, disabled, onMouseDown, title, children }: {
  active: boolean; disabled?: boolean; onMouseDown: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={e => { e.preventDefault(); if (!disabled) onMouseDown(); }}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded text-xs transition-colors",
        active ? "bg-[#b8922f]/15 text-[#b8922f]" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
        disabled && "opacity-30 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

const INSERT_KINDS: Array<{ kind: Block["type"]; Icon: React.ComponentType<{ className?: string }>; label: string }> = [
  { kind: "paragraph", Icon: AlignLeft,  label: "Paragraph" },
  { kind: "list",      Icon: ListIcon,   label: "List"      },
  { kind: "table",     Icon: TableIcon,  label: "Table"     },
  { kind: "image",     Icon: ImageIcon,  label: "Image"     },
];

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BlankDocPage() {
  const router = useRouter();
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [doc,  setDoc]  = useState<PlanDocument>(() => makeBlankPlan("en"));
  const [exportMode,    setExportMode]    = useState(false);
  const [marginPreset,  setMarginPreset]  = useState<"narrow" | "normal">("normal");
  const [selectedBlock, setSelectedBlock] = useState<SelectedBlockInfo | null>(null);

  const chatPanelRef = useRef<ChatPanelHandle>(null);
  const canvasRef    = useRef<HTMLDivElement>(null);
  const docRef       = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const [selectionBubble, setSelectionBubble] = useState<{ x: number; y: number; prompt: string } | null>(null);

  const [activeEditorState, setActiveEditorState] = useState<{
    editor: Editor | null; chapterId: string | null; subId: string | null | undefined;
  }>({ editor: null, chapterId: null, subId: undefined });

  const setActiveEditor = useCallback((editor: Editor | null, chapterId?: string, subId?: string | null) => {
    setActiveEditorState({ editor: editor ?? null, chapterId: chapterId ?? null, subId });
  }, []);

  const activeEditorCtxValue = useMemo<ActiveEditorCtxValue>(() => ({
    activeEditor: activeEditorState.editor,
    activeChapterId: activeEditorState.chapterId,
    activeSubId: activeEditorState.subId,
    setActiveEditor,
  }), [activeEditorState, setActiveEditor]);

  const editorApi = useEditorApi(setDoc);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Try to restore from localStorage (same lang as saved)
    try {
      for (const l of ["en", "ar"] as const) {
        const raw = localStorage.getItem(STORAGE_KEY(l));
        if (!raw) continue;
        const parsed = JSON.parse(raw) as PlanDocument;
        if (parsed?.meta?.title && Array.isArray(parsed.chapters)) {
          setDoc(inheritLogo(parsed));
          setLang(parsed.language as "en" | "ar");
          return;
        }
      }
    } catch { /* ignore */ }
    setDoc(inheritLogo(makeBlankPlan("en")));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.classList.add("plan-editor-open");
    return () => document.body.classList.remove("plan-editor-open");
  }, []);

  // ── Auto-save ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY(doc.language), JSON.stringify(doc)); } catch { /* quota */ }
    }, 500);
    return () => clearTimeout(t);
  }, [doc]);

  // ── Language switch ─────────────────────────────────────────────────────────
  const switchLang = useCallback((l: "en" | "ar") => {
    setLang(l);
    setDoc(d => ({ ...d, language: l, dir: l === "ar" ? "rtl" : "ltr" }));
  }, []);

  // keep logo in sync if strategic plan logo changes after mount
  useEffect(() => {
    setDoc(d => (d.meta.orgLogoUrl ? d : inheritLogo(d)));
  }, []);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (!confirm("Clear this document? All content will be removed.")) return;
    localStorage.removeItem(STORAGE_KEY(lang));
    setDoc(makeBlankPlan(lang));
    setSelectedBlock(null);
  }, [lang]);

  // ── Export PDF ──────────────────────────────────────────────────────────────
  const handleExportPdf = useCallback(() => setExportMode(true), []);

  useEffect(() => {
    if (!exportMode) return;
    const t = setTimeout(() => {
      const planEl = document.querySelector(".plan-doc") as HTMLElement | null;
      if (!planEl) { setExportMode(false); return; }

      const planHtml   = planEl.outerHTML;
      const styleLinks = Array.from(
        document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>("link[rel=\"stylesheet\"], style")
      ).map(el => el.outerHTML).join("\n");

      setExportMode(false);
      const d   = docRef.current;
      const win = window.open("", "_blank");
      if (!win) { alert("Popup blocked — please allow popups for this site and try again."); return; }

      win.document.open();
      win.document.write(`<!DOCTYPE html>
<html lang="${d.language}" dir="${d.dir}">
<head><meta charset="UTF-8"><title>${d.meta.title}</title>${styleLinks}</head>
<body>
${planHtml}
<style>
@page { size: A4; margin: 1.35in 0 0.45in 0; }
@page { @bottom-center { content: counter(page); font-family: Georgia,serif; font-size: 10pt; color: #334155; } }
a.toc-pg > span { display: none; }
a.toc-pg::after { content: target-counter(attr(href url), page); font-family: Georgia,serif; font-size: inherit; font-weight: inherit; color: inherit; }
.pagedjs_page, .pagedjs_page_content { background: #f5f4ef !important; }
html, body { height: auto !important; overflow: visible !important; background: #f5f4ef !important; }
.h-screen,.h-full,.overflow-hidden,.overflow-y-auto { height: auto !important; overflow: visible !important; }
.no-print,.edit-toolbar,.add-block-affordance,.block-approve-btn,.block-hover-ring,.status-chip,.plan-chat-panel,button:not(.toc-pg) { display: none !important; }
</style>
<script>window.PagedConfig = { auto: false };<\/script>
<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"><\/script>
<script>
(function(){
  if(typeof Paged==='undefined'){setTimeout(window.print.bind(window),200);return;}
  var printed=false;
  function doPrint(){if(printed)return;printed=true;setTimeout(window.print.bind(window),300);}
  class AfterRender extends Paged.Handler{afterRendered(){doPrint();}}
  Paged.registerHandlers(AfterRender);
  new Paged.Previewer().preview(document.body,[],document.body).catch(function(){doPrint();});
  setTimeout(doPrint,15000);
})();
<\/script>
</body></html>`);
      win.document.close();
    }, 150);
    return () => clearTimeout(t);
  }, [exportMode]);

  // ── Selection → chat bubble ─────────────────────────────────────────────────
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let selectedText = "", anchorNode: Node | Element | null = null;
      let x = e.clientX, y = e.clientY;

      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        if (canvas.contains(range.commonAncestorContainer)) {
          const t = sel.toString().trim();
          if (t.length >= 3) {
            selectedText = t; anchorNode = range.commonAncestorContainer;
            const rect = range.getBoundingClientRect();
            x = rect.left + rect.width / 2; y = rect.bottom;
          }
        }
      }
      if (!selectedText) {
        const el = document.activeElement;
        if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && canvas.contains(el)) {
          const s = el.selectionStart ?? 0, e2 = el.selectionEnd ?? 0;
          if (e2 > s) { const t = el.value.slice(s, e2).trim(); if (t.length >= 3) { selectedText = t; anchorNode = el; x = e.clientX; y = e.clientY; } }
        }
      }
      if (!selectedText) { setSelectionBubble(null); return; }

      const snippet = selectedText.length > 300 ? selectedText.slice(0, 300) + "…" : selectedText;
      setSelectionBubble({ x, y, prompt: `"${snippet}"\n\nCan you help me with this content?` });
    };

    const onSelChange = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const el = document.activeElement;
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && canvasRef.current?.contains(el)) {
        if ((el.selectionEnd ?? 0) > (el.selectionStart ?? 0)) return;
      }
      setSelectionBubble(null);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelChange);
    return () => { document.removeEventListener("mouseup", onMouseUp); document.removeEventListener("selectionchange", onSelChange); };
  }, []);

  const { editor: activeEditor, chapterId: activeChapterId, subId: activeSubId } = activeEditorState;

  const handleSetLink = useCallback(() => {
    if (!activeEditor) return;
    const prev = activeEditor.getAttributes("link").href as string | undefined;
    const url  = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") activeEditor.chain().focus().unsetLink().run();
    else activeEditor.chain().focus().setLink({ href: url }).run();
  }, [activeEditor]);

  // ── Export mode ──────────────────────────────────────────────────────────────
  if (exportMode) {
    return (
      <ActiveEditorCtx.Provider value={activeEditorCtxValue}>
        <Template doc={doc} mode="print" editorApi={editorApi} marginPreset={marginPreset} />
      </ActiveEditorCtx.Provider>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <ActiveEditorCtx.Provider value={activeEditorCtxValue}>
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Top bar ── */}
        <div className="no-print flex shrink-0 items-center justify-between border-b border-white/5 bg-[#0b0e1a] px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/plan-generation")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="text-xs">Plans</span>
            </button>

            <div className="h-3.5 w-px bg-white/10" />

            <span className="max-w-[220px] truncate text-xs font-semibold text-slate-300">
              {doc.meta.title || "Untitled Document"}
            </span>

            {/* Margin presets */}
            <div className="flex items-center gap-0.5 rounded-md border border-white/5 bg-[#080a14] p-0.5">
              <span className="px-1 text-[10px] text-slate-600">Margins:</span>
              {(["narrow", "normal"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMarginPreset(m)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors",
                    marginPreset === m ? "bg-[#b8922f]/15 text-[#b8922f]" : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Language toggle */}
            <div className="flex items-center gap-0.5 rounded-md border border-white/5 bg-[#080a14] p-0.5">
              <Globe className="ms-1 h-3 w-3 text-slate-500" />
              {(["en", "ar"] as const).map(l => (
                <button
                  key={l}
                  onClick={() => switchLang(l)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                    lang === l ? "bg-cyan-500/10 text-cyan-300" : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  {l === "en" ? "EN" : "AR"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleReset} className="gap-1.5 text-xs text-slate-400">
              <RotateCcw className="h-3 w-3" /> Clear
            </Button>
            <Button size="sm" onClick={handleExportPdf} className="gap-1.5 bg-[#b8922f] text-xs font-semibold text-[#0b1220] hover:bg-[#c9a340]">
              <Printer className="h-3 w-3" /> Export PDF
            </Button>
          </div>
        </div>

        {/* ── Format toolbar ── */}
        <div className="no-print flex shrink-0 items-center gap-1 border-b border-white/5 bg-[#0d1020] px-3 py-1.5">
          <FmtBtn active={activeEditor?.isActive("bold") ?? false} disabled={!activeEditor} onMouseDown={() => activeEditor?.chain().focus().toggleBold().run()} title="Bold">
            <Bold className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn active={activeEditor?.isActive("italic") ?? false} disabled={!activeEditor} onMouseDown={() => activeEditor?.chain().focus().toggleItalic().run()} title="Italic">
            <Italic className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn active={activeEditor?.isActive("link") ?? false} disabled={!activeEditor} onMouseDown={handleSetLink} title="Link">
            <Link2 className="h-3.5 w-3.5" />
          </FmtBtn>

          <div className="mx-1 h-4 w-px bg-white/10" />

          <span className="px-1 text-[10px] text-slate-600">Insert:</span>
          {INSERT_KINDS.map(({ kind, Icon, label }) => (
            <FmtBtn
              key={kind}
              active={false}
              disabled={!activeChapterId}
              onMouseDown={() => { if (activeChapterId) editorApi.addBlock(activeChapterId, activeSubId as string | null ?? null, kind); }}
              title={`Insert ${label}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </FmtBtn>
          ))}

          {!activeEditor && (
            <span className="ms-2 text-[10px] italic text-slate-700">
              Add a chapter then click a section to enable formatting
            </span>
          )}
        </div>

        {/* ── 3-zone layout ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left — Outline */}
          <div className="no-print shrink-0">
            <OutlinePanel doc={doc} editorApi={editorApi} />
          </div>

          {/* Center — Canvas */}
          <div ref={canvasRef} className="flex-1 overflow-y-auto bg-[#f5f4ef]">
            <Template
              doc={doc}
              mode="edit"
              onSelectBlock={id => setSelectedBlock(findBlockInfo(doc, id))}
              editorApi={editorApi}
              marginPreset={marginPreset}
            />
          </div>

          {/* Right — Chat */}
          <div className="no-print shrink-0 h-full">
            <ChatPanel ref={chatPanelRef} selectedBlock={selectedBlock} doc={doc} />
          </div>

        </div>
      </div>

      {/* Selection → chat bubble */}
      {selectionBubble && (
        <button
          onMouseDown={e => {
            e.preventDefault();
            chatPanelRef.current?.injectText(selectionBubble.prompt);
            window.getSelection()?.removeAllRanges();
            setSelectionBubble(null);
          }}
          className="no-print fixed z-[9999] -translate-x-1/2 rounded-full border border-cyan-500/40 bg-[#0b0e1a] px-3 py-1.5 text-[11px] font-medium text-cyan-400 shadow-xl hover:bg-cyan-500/10 transition-colors"
          style={{ left: selectionBubble.x, top: selectionBubble.y + 6 }}
        >
          Send to chat ↗
        </button>
      )}
    </ActiveEditorCtx.Provider>
  );
}
