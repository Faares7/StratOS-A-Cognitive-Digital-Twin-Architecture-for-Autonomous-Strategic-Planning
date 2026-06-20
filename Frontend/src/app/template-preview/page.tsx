"use client";

/**
 * Throwaway visual harness for the formal-gov plan template.
 * Visit /template-preview. Toggle language (EN/AR), mode (view/print),
 * and click any block to see its provenance (preview of the future XAI panel).
 */
import { useEffect, useMemo, useState } from "react";
import { Template } from "@/templates/plan/formal-gov/Template";
import { makeSamplePlan, findBlockProvenance } from "@/templates/plan/sample-plan";
import type { Provenance } from "@/types/plan-document";

function describe(p: Provenance): string {
  switch (p.kind) {
    case "agent_signal":
      return `From the ${p.agent} agent via ${p.source}: "${p.finding}"${
        p.confidence != null ? ` (confidence ${p.confidence}%)` : ""
      }`;
    case "reference_plan":
      return `Based on ${p.planTitle} — "${p.sectionHeading}"${p.page ? `, p.${p.page}` : ""}`;
    case "human":
      return "Written by you";
    case "mixed":
      return `Multiple sources (${p.sources.length})`;
  }
}

export default function TemplatePreviewPage() {
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [mode, setMode] = useState<"view" | "print">("view");
  const [sel, setSel] = useState<{ id: string; prov: Provenance } | null>(null);
  const [printing, setPrinting] = useState(false);

  const doc = useMemo(() => makeSamplePlan(lang), [lang]);

  // Export PDF: render in print mode (strips links, hides chips) then open the print dialog.
  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
    setMode("view");
  }, [printing]);

  function handleSelect(id: string) {
    const prov = findBlockProvenance(doc, id);
    setSel(prov ? { id, prov } : null);
  }

  const btn = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: active ? "#22d3ee" : "transparent",
    color: active ? "#0b1220" : "#cbd5e1",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <Template doc={doc} mode={mode} onSelectBlock={handleSelect} pageNumbers={{}} />

      {/* Dev control bar — fixed, above the template's running header/footer */}
      <div
        className="no-print"
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 1000,
          background: "rgba(13,17,23,0.95)",
          border: "1px solid #334155",
          borderRadius: 10,
          padding: 12,
          width: 300,
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 8 }}>
          Template preview (dev)
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "#94a3b8", alignSelf: "center", width: 48 }}>Lang</span>
          <button style={btn(lang === "en")} onClick={() => setLang("en")}>English</button>
          <button style={btn(lang === "ar")} onClick={() => setLang("ar")}>عربى (RTL)</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#94a3b8", alignSelf: "center", width: 48 }}>Mode</span>
          <button style={btn(mode === "view")} onClick={() => setMode("view")}>View</button>
          <button style={btn(mode === "print")} onClick={() => setMode("print")}>Print</button>
        </div>

        <button
          onClick={() => { setMode("print"); setPrinting(true); }}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: "#b8922f", color: "#0b1220", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 10 }}
        >
          ⬇ Export PDF
        </button>

        <div style={{ borderTop: "1px solid #334155", paddingTop: 8, fontSize: 12, minHeight: 56 }}>
          <div style={{ color: "#64748b", marginBottom: 4 }}>
            {sel ? `Source · ${sel.id}` : "Click any block to trace its source →"}
          </div>
          {sel && <div style={{ color: "#e2e8f0", lineHeight: 1.4 }}>{describe(sel.prov)}</div>}
        </div>
      </div>
    </div>
  );
}
