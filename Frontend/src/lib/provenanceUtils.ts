/**
 * Shared provenance utilities — used by the plan viewer and template-preview.
 */
import type { Provenance, PlanDocument } from "@/types/plan-document";

/** Human-readable description of a provenance record. */
export function describeProvenance(p: Provenance): string {
  switch (p.kind) {
    case "agent_signal":
      return (
        `From the ${p.agent} agent via ${p.source}: "${p.finding}"` +
        (p.confidence != null ? ` (confidence ${p.confidence}%)` : "") +
        (p.pillarTag ? ` [Pillar: ${p.pillarTag}]` : "")
      );
    case "reference_plan":
      return (
        `Based on ${p.planTitle} — "${p.sectionHeading}"` +
        (p.page ? `, p.${p.page}` : "")
      );
    case "human":
      return "Written by you";
    case "mixed":
      return `Multiple sources (${p.sources.length}) — click to expand`;
  }
}

/** Walk the document tree to find a block's provenance by id. */
export function findBlockProvenance(
  doc: PlanDocument,
  blockId: string,
): Provenance | null {
  for (const ch of doc.chapters) {
    for (const b of ch.intro ?? []) {
      if (b.id === blockId) return b.provenance;
    }
    for (const sub of ch.sections) {
      for (const b of sub.blocks) {
        if (b.id === blockId) return b.provenance;
      }
    }
  }
  return null;
}

/** Walk the document tree to find a block's subchapter heading by id. */
export function findBlockHeading(doc: PlanDocument, blockId: string): string | null {
  for (const ch of doc.chapters) {
    for (const b of ch.intro ?? []) {
      if (b.id === blockId) return ch.title;
    }
    for (const sub of ch.sections) {
      for (const b of sub.blocks) {
        if (b.id === blockId) return sub.heading;
      }
    }
  }
  return null;
}
