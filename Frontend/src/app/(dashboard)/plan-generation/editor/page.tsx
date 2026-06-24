"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import {
  Printer, RotateCcw, Globe, Bold, Italic, Link2,
  AlignLeft, List as ListIcon, Table as TableIcon, Image as ImageIcon,
  ArrowLeft, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Template } from "@/templates/plan/formal-gov/Template";
import { OutlinePanel } from "@/components/plan/OutlinePanel";
import { ChatPanel } from "@/components/plan/ChatPanel";
import type { SelectedBlockInfo, ChatPanelHandle } from "@/components/plan/ChatPanel";
import { ActiveEditorCtx } from "@/components/plan/ActiveEditorCtx";
import type { ActiveEditorCtxValue } from "@/components/plan/ActiveEditorCtx";
import { makeSamplePlan, makeBlankPlan } from "@/templates/plan/sample-plan";
import type {
  PlanDocument, Block, Chapter, Subchapter,
  HumanProvenance, PlanMeta,
} from "@/types/plan-document";
import type { EditorApi } from "@/components/plan/EditorApi";
import { blockToText, textToBlock } from "@/lib/blockSerializer";
import type { ApplyDraftFn } from "@/components/plan/ChatPanel";

// ── Helpers ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = (lang: string) => `stratos-plan-draft-v2-${lang}`;

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
    id: `sub-${uid()}`,
    canonicalKey: null,
    heading: "New Section",
    order,
    status: "auto",
    generation: "complete",
    userAdded: true,
    blocks: [newBlock("paragraph")],
  };
}

function newChapter(number: number): Chapter {
  return {
    id: `ch-${uid()}`,
    number,
    title: "New Chapter",
    canonicalKey: null,
    userAdded: true,
    sections: [newSubchapter(0)],
  };
}

function findBlockInfo(doc: PlanDocument, blockId: string): SelectedBlockInfo | null {
  // Search preface sections
  for (const sub of (doc.preface ?? [])) {
    for (const b of sub.blocks) {
      if (b.id === blockId) return {
        blockId, chapterId: "preface", subId: sub.id,
        heading: sub.heading, blockType: b.type,
        rawContent: blockToText(b), provenance: b.provenance,
      };
    }
  }
  // Search numbered chapters
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

// ── EditorApi implementation ───────────────────────────────────────────────────

function useEditorApi(
  setDoc: React.Dispatch<React.SetStateAction<PlanDocument>>,
): EditorApi {
  return useMemo<EditorApi>(() => ({

    updateBlock(chapterId, subId, blockId, next) {
      setDoc(doc => {
        if (chapterId === "preface") {
          return {
            ...doc,
            preface: (doc.preface ?? []).map(sub => {
              if (sub.id !== subId) return sub;
              return {
                ...sub,
                status: (sub.status === "auto" ? "edited" : sub.status) as Subchapter["status"],
                blocks: sub.blocks.map(b => b.id === blockId ? next : b),
              };
            }),
          };
        }
        return {
          ...doc,
          chapters: doc.chapters.map(ch => {
            if (ch.id !== chapterId) return ch;
            if (subId === null) {
              return { ...ch, intro: (ch.intro ?? []).map(b => b.id === blockId ? next : b) };
            }
            return {
              ...ch,
              sections: ch.sections.map(sub => {
                if (sub.id !== subId) return sub;
                return {
                  ...sub,
                  status: sub.status === "auto" ? "edited" : sub.status,
                  blocks: sub.blocks.map(b => b.id === blockId ? next : b),
                };
              }),
            };
          }),
        };
      });
    },

    addBlock(chapterId, subId, kind, afterBlockId, atStart) {
      const nb = newBlock(kind);
      const insertInto = (blocks: Block[]): Block[] => {
        if (atStart) return [nb, ...blocks];
        if (!afterBlockId) return [...blocks, nb];
        const idx = blocks.findIndex(b => b.id === afterBlockId);
        if (idx === -1) return [...blocks, nb];
        const next = [...blocks];
        next.splice(idx + 1, 0, nb);
        return next;
      };
      setDoc(doc => {
        if (chapterId === "preface") {
          return {
            ...doc,
            preface: (doc.preface ?? []).map(sub => {
              if (sub.id !== subId) return sub;
              return { ...sub, status: (sub.status === "auto" ? "edited" : sub.status) as Subchapter["status"], blocks: insertInto(sub.blocks) };
            }),
          };
        }
        return {
          ...doc,
          chapters: doc.chapters.map(ch => {
            if (ch.id !== chapterId) return ch;
            if (subId === null) return { ...ch, intro: insertInto(ch.intro ?? []) };
            return {
              ...ch,
              sections: ch.sections.map(sub => {
                if (sub.id !== subId) return sub;
                return { ...sub, status: sub.status === "auto" ? "edited" : sub.status, blocks: insertInto(sub.blocks) };
              }),
            };
          }),
        };
      });
    },

    deleteBlock(chapterId, subId, blockId) {
      setDoc(doc => {
        if (chapterId === "preface") {
          return {
            ...doc,
            preface: (doc.preface ?? []).map(sub => {
              if (sub.id !== subId) return sub;
              return { ...sub, status: (sub.status === "auto" ? "edited" : sub.status) as Subchapter["status"], blocks: sub.blocks.filter(b => b.id !== blockId) };
            }),
          };
        }
        return {
          ...doc,
          chapters: doc.chapters.map(ch => {
            if (ch.id !== chapterId) return ch;
            if (subId === null) return { ...ch, intro: (ch.intro ?? []).filter(b => b.id !== blockId) };
            return {
              ...ch,
              sections: ch.sections.map(sub => {
                if (sub.id !== subId) return sub;
                return { ...sub, blocks: sub.blocks.filter(b => b.id !== blockId) };
              }),
            };
          }),
        };
      });
    },

    moveBlock(chapterId, subId, blockId, dir) {
      const swap = (arr: Block[]) => {
        const i = arr.findIndex(b => b.id === blockId);
        if (i === -1) return arr;
        const j = dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= arr.length) return arr;
        const next = [...arr];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      };
      setDoc(doc => {
        if (chapterId === "preface") {
          return {
            ...doc,
            preface: (doc.preface ?? []).map(sub => {
              if (sub.id !== subId) return sub;
              return { ...sub, blocks: swap(sub.blocks) };
            }),
          };
        }
        return {
          ...doc,
          chapters: doc.chapters.map(ch => {
            if (ch.id !== chapterId) return ch;
            if (subId === null) return { ...ch, intro: swap(ch.intro ?? []) };
            return {
              ...ch,
              sections: ch.sections.map(sub => sub.id !== subId ? sub : { ...sub, blocks: swap(sub.blocks) }),
            };
          }),
        };
      });
    },

    setHeading(chapterId, subId, text) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          if (subId === null) return { ...ch, title: text };
          return {
            ...ch,
            sections: ch.sections.map(sub =>
              sub.id !== subId ? sub : { ...sub, heading: text, status: sub.status === "auto" ? "edited" : sub.status },
            ),
          };
        }),
      }));
    },

    approveSubchapter(chapterId, subId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch =>
          ch.id !== chapterId ? ch : {
            ...ch,
            sections: ch.sections.map(sub =>
              sub.id !== subId ? sub : { ...sub, status: "verified" },
            ),
          },
        ),
      }));
    },

    addSubchapter(chapterId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch => {
          if (ch.id !== chapterId) return ch;
          const sub = newSubchapter(ch.sections.length);
          return { ...ch, sections: [...ch.sections, sub] };
        }),
      }));
    },

    deleteSubchapter(chapterId, subId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters.map(ch =>
          ch.id !== chapterId ? ch : { ...ch, sections: ch.sections.filter(s => s.id !== subId) },
        ),
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
        const ch = newChapter(maxNum + 1);
        return { ...doc, chapters: [...doc.chapters, ch] };
      });
    },

    deleteChapter(chapterId) {
      setDoc(doc => ({
        ...doc,
        chapters: doc.chapters
          .filter(ch => ch.id !== chapterId)
          .map((ch, i) => ({ ...ch, number: i + 1 })),
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

function FmtBtn({
  active, disabled, onMouseDown, title, children,
}: {
  active: boolean;
  disabled?: boolean;
  onMouseDown: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onMouseDown(); }}
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
  { kind: "paragraph", Icon: AlignLeft, label: "Paragraph" },
  { kind: "list",      Icon: ListIcon,  label: "List"      },
  { kind: "table",     Icon: TableIcon, label: "Table"     },
  { kind: "image",     Icon: ImageIcon, label: "Image"     },
];

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PlanEditorPage() {
  const router = useRouter();
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [doc, setDoc] = useState<PlanDocument>(() => makeSamplePlan("en"));

  // On mount: check sessionStorage for init instruction (set by landing page),
  // otherwise fall back to localStorage.
  useEffect(() => {
    try {
      const initStr = sessionStorage.getItem("plan-editor-init");
      if (initStr) {
        sessionStorage.removeItem("plan-editor-init");
        const init = JSON.parse(initStr) as {
          kind: "blank" | "template" | "recent" | "from-db";
          lang: "en" | "ar";
          planId?: string;
        };
        const l = init.lang ?? "en";
        setLang(l);
        if (init.kind === "blank") {
          setDoc(makeBlankPlan(l));
        } else if (init.kind === "from-db" && init.planId) {
          // Load PlanDocument directly from the generated_plans table
          fetch(`/api/plan-generation/${init.planId}`, { cache: "no-store" })
            .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
            .then(row => {
              const loaded = row.document as PlanDocument;
              if (loaded?.meta?.title && Array.isArray(loaded.chapters)) {
                setDoc(loaded);
                setLang(loaded.language ?? "en");
              } else {
                setDoc(makeSamplePlan(l));
              }
            })
            .catch(() => setDoc(makeSamplePlan(l)));
        } else if (init.kind === "recent") {
          const saved = localStorage.getItem(STORAGE_KEY(l));
          if (saved) {
            const parsed = JSON.parse(saved) as PlanDocument;
            if (parsed?.meta?.title && Array.isArray(parsed.chapters)) {
              setDoc(parsed);
              return;
            }
          }
          setDoc(makeSamplePlan(l));
        } else {
          setDoc(makeSamplePlan(l));
        }
        return;
      }
    } catch { /* ignore */ }

    // Fall back to localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY("en"));
      if (saved) {
        const parsed = JSON.parse(saved) as PlanDocument;
        if (parsed && Array.isArray(parsed.chapters) && parsed.meta?.title) {
          setDoc(parsed);
          if (parsed.language === "ar") setLang("ar");
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedBlock, setSelectedBlock] = useState<SelectedBlockInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [marginPreset, setMarginPreset] = useState<"narrow" | "normal">("narrow");
  const [chatOpen, setChatOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);

  const chatPanelRef = useRef<ChatPanelHandle>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const [selectionBubble, setSelectionBubble] = useState<{ x: number; y: number; prompt: string } | null>(null);

  const [activeEditorState, setActiveEditorState] = useState<{
    editor: Editor | null;
    chapterId: string | null;
    subId: string | null | undefined;
  }>({ editor: null, chapterId: null, subId: undefined });

  const setActiveEditor = useCallback(
    (editor: Editor | null, chapterId?: string, subId?: string | null) => {
      setActiveEditorState({ editor: editor ?? null, chapterId: chapterId ?? null, subId });
    },
    [],
  );

  const activeEditorCtxValue = useMemo<ActiveEditorCtxValue>(() => ({
    activeEditor: activeEditorState.editor,
    activeChapterId: activeEditorState.chapterId,
    activeSubId: activeEditorState.subId,
    setActiveEditor,
  }), [activeEditorState, setActiveEditor]);

  const editorApi = useEditorApi(setDoc);

  const handleApplyDraft = useCallback<ApplyDraftFn>((
    text, targetBlockId, targetChapterId, targetSubId, originalType
  ) => {
    const prov: HumanProvenance = humanProv();
    const replacement = textToBlock(text, originalType, prov);
    // Preserve the original block ID so updateBlock can find it
    const patched = { ...replacement, id: targetBlockId };
    editorApi.updateBlock(targetChapterId, targetSubId, targetBlockId, patched as Block);
  }, [editorApi]);

  useEffect(() => {
    document.body.classList.add("plan-editor-open");
    return () => document.body.classList.remove("plan-editor-open");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY(doc.language), JSON.stringify(doc)); } catch { /* quota */ }
    }, 500);
    return () => clearTimeout(t);
  }, [doc]);

  const switchLang = useCallback((l: "en" | "ar") => {
    setLang(l);
    setDoc(d => ({ ...d, language: l, dir: l === "ar" ? "rtl" : "ltr" }));
  }, []);

  const handleReset = useCallback(() => {
    if (!confirm("Reset to sample plan? Edits will be lost.")) return;
    localStorage.removeItem(STORAGE_KEY(doc.language));
    setDoc(makeSamplePlan(doc.language));
    setSelectedBlock(null);
  }, [doc.language]);

  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      const resp = await fetch('/api/plan-generation/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docRef.current),
      });

      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({})) as { error?: string };
        alert(`PDF export failed: ${payload.error ?? resp.statusText}`);
        return;
      }

      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${docRef.current.meta.title || 'plan'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`PDF export failed: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  }, []);

  const { editor: activeEditor, chapterId: activeChapterId, subId: activeSubId } = activeEditorState;

  const handleSetLink = useCallback(() => {
    if (!activeEditor) return;
    const prev = activeEditor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") activeEditor.chain().focus().unsetLink().run();
    else activeEditor.chain().focus().setLink({ href: url }).run();
  }, [activeEditor]);

  const findSectionContext = useCallback((anchorNode: Node | Element | null): string => {
    const d = docRef.current;
    let el: Element | null =
      anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
    while (el) {
      if (el.id) {
        for (const ch of d.chapters) {
          if (ch.id === el.id) return `Chapter ${ch.number}: ${ch.title}`;
          for (let si = 0; si < ch.sections.length; si++) {
            const sub = ch.sections[si];
            if (sub.id === el.id) return `Chapter ${ch.number}: ${ch.title}  ›  ${ch.number}.${si + 1} ${sub.heading}`;
          }
        }
      }
      el = el.parentElement;
    }
    return "";
  }, []);

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      let selectedText = "";
      let anchorNode: Node | Element | null = null;
      let x = e.clientX;
      let y = e.clientY;

      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        if (canvas.contains(range.commonAncestorContainer)) {
          const t = sel.toString().trim();
          if (t.length >= 3) {
            selectedText = t;
            anchorNode = range.commonAncestorContainer;
            const rect = range.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.bottom;
          }
        }
      }

      if (!selectedText) {
        const el = document.activeElement;
        if (
          (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
          canvas.contains(el)
        ) {
          const start = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? 0;
          if (end > start) {
            const t = el.value.slice(start, end).trim();
            if (t.length >= 3) {
              selectedText = t;
              anchorNode = el;
              x = e.clientX;
              y = e.clientY;
            }
          }
        }
      }

      if (!selectedText) { setSelectionBubble(null); return; }

      const context = findSectionContext(anchorNode);
      const snippet = selectedText.length > 300 ? selectedText.slice(0, 300) + "…" : selectedText;
      const lines: string[] = [];
      if (context) lines.push(context);
      lines.push(`"${snippet}"`);
      lines.push("Please explain where this content came from and why it is relevant to the strategic plan.");
      const prompt = lines.join("\n\n");

      setSelectionBubble({ x, y, prompt });
    };

    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const el = document.activeElement;
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        canvasRef.current?.contains(el)
      ) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        if (end > start) return;
      }
      setSelectionBubble(null);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [findSectionContext]);

  return (
    <ActiveEditorCtx.Provider value={activeEditorCtxValue}>
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Top bar ── */}
        <div className="no-print flex shrink-0 items-center justify-between border-b border-white/5 bg-[#0b0e1a] px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            {/* Back to landing */}
            <button
              onClick={() => router.push("/plan-generation")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
              title="All plans"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="text-xs">Plans</span>
            </button>

            <button
              onClick={() => setOutlineOpen(v => !v)}
              title={outlineOpen ? "Hide outline" : "Show outline"}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
            >
              {outlineOpen
                ? <PanelLeftClose className="h-3.5 w-3.5" />
                : <PanelLeftOpen className="h-3.5 w-3.5" />}
            </button>

            <div className="h-3.5 w-px bg-white/10" />

            <span className="text-xs font-semibold text-slate-300 truncate max-w-[220px]">
              {doc.meta.title}
            </span>

            {/* Language toggle */}
            <div className="flex items-center gap-0.5 rounded-md border border-white/5 bg-[#080a14] p-0.5">
              <Globe className="ms-1 h-3 w-3 text-slate-500" />
              {(["en", "ar"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => switchLang(l)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                    lang === l
                      ? "bg-cyan-500/10 text-cyan-300"
                      : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  {l === "en" ? "EN" : "AR"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setChatOpen(v => !v)}
              title={chatOpen ? "Hide assistant" : "Show assistant"}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
            >
              {chatOpen
                ? <PanelRightClose className="h-3.5 w-3.5" />
                : <PanelRightOpen className="h-3.5 w-3.5" />}
              <span className="text-xs">Assistant</span>
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReset}
              className="gap-1.5 text-xs text-slate-400"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleExportPdf}
              disabled={exporting}
              className="gap-1.5 bg-[#b8922f] text-xs font-semibold text-[#0b1220] hover:bg-[#c9a340] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Printer className="h-3 w-3" />
              {exporting ? 'Exporting…' : 'Export PDF'}
            </Button>
          </div>
        </div>

        {/* ── Format toolbar ── */}
        <div className="no-print flex shrink-0 items-center gap-1 border-b border-white/5 bg-[#0d1020] px-3 py-1.5">
          <FmtBtn
            active={activeEditor?.isActive("bold") ?? false}
            disabled={!activeEditor}
            onMouseDown={() => activeEditor?.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn
            active={activeEditor?.isActive("italic") ?? false}
            disabled={!activeEditor}
            onMouseDown={() => activeEditor?.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn
            active={activeEditor?.isActive("link") ?? false}
            disabled={!activeEditor}
            onMouseDown={handleSetLink}
            title="Link"
          >
            <Link2 className="h-3.5 w-3.5" />
          </FmtBtn>

          <div className="mx-1 h-4 w-px bg-white/10" />

          <span className="px-1 text-[10px] text-slate-600">Insert:</span>
          {INSERT_KINDS.map(({ kind, Icon, label }) => (
            <FmtBtn
              key={kind}
              active={false}
              disabled={!activeChapterId}
              onMouseDown={() => {
                if (activeChapterId) {
                  editorApi.addBlock(
                    activeChapterId,
                    activeSubId as string | null ?? null,
                    kind,
                    selectedBlock?.blockId,
                  );
                }
              }}
              title={`Insert ${label}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </FmtBtn>
          ))}

          {!activeEditor && (
            <span className="ms-2 text-[10px] text-slate-700 italic">
              Click a paragraph to enable formatting
            </span>
          )}
        </div>

        {/* ── 3-zone layout ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left — Outline (collapsible) */}
          {outlineOpen && (
            <div className="no-print shrink-0 h-full">
              <OutlinePanel doc={doc} editorApi={editorApi} />
            </div>
          )}

          {/* Center — Template canvas */}
          <div ref={canvasRef} className="flex-1 overflow-y-auto bg-[#f5f4ef]">
            <Template
              doc={doc}
              mode="edit"
              onSelectBlock={(id) => setSelectedBlock(findBlockInfo(doc, id))}
              editorApi={editorApi}
              marginPreset={marginPreset}
            />
          </div>

          {/* Right — Chat panel (collapsible) */}
          {chatOpen && (
            <div className="no-print shrink-0 h-full">
              <ChatPanel ref={chatPanelRef} selectedBlock={selectedBlock} doc={doc} onApplyDraft={handleApplyDraft} />
            </div>
          )}

        </div>
      </div>

      {/* Send-to-chat bubble */}
      {selectionBubble && (
        <button
          onMouseDown={(e) => {
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
