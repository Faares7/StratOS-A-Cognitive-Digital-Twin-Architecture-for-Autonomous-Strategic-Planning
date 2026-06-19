// ─── Primitives ────────────────────────────────────────────────────────────────

export type Language  = "en" | "ar";
export type Direction = "ltr" | "rtl"; // derived: ar → rtl, en → ltr

/**
 * Canonical TipTap / ProseMirror JSON node.
 * Allowed marks: bold, italic, link only.
 * No arbitrary inline font/size/color — sizing is template-driven.
 */
export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: Array<{
    type: "bold" | "italic" | "link";
    attrs?: Record<string, unknown>;
  }>;
  text?: string;
}

export type RichText = ProseMirrorNode;

// ─── Provenance ────────────────────────────────────────────────────────────────

export interface AgentProvenance {
  kind:        "agent_signal";
  agent:       "tech" | "sentiment" | "workforce" | "benchmark" | "social" | "meetings";
  category?:   "strength" | "weakness" | "opportunity" | "threat";
  source:      string;
  finding:     string;
  insightId?:  string;
  pillarTag?:  string;
  confidence?: number; // 0–100
  evidence?:   Record<string, unknown>;
}

export interface ReferencePlanProvenance {
  kind:           "reference_plan";
  planId:         string;
  planTitle:      string;
  canonicalKey:   string;
  sectionHeading: string;
  page?:          number;
}

export interface HumanProvenance {
  kind:     "human";
  editedAt: string; // ISO
}

export interface MixedProvenance {
  kind:    "mixed";
  sources: (AgentProvenance | ReferencePlanProvenance | HumanProvenance)[];
}

export type Provenance =
  | AgentProvenance
  | ReferencePlanProvenance
  | HumanProvenance
  | MixedProvenance;

export interface ProvenanceSpan {
  from:       number;
  to:         number;
  provenance: Provenance;
}

// ─── Blocks ────────────────────────────────────────────────────────────────────

interface BlockBase {
  id:         string;
  provenance: Provenance;
}

export interface ParagraphBlock extends BlockBase {
  type:    "paragraph";
  content: RichText;
  spans?:  ProvenanceSpan[];
}

export interface ListBlock extends BlockBase {
  type:    "list";
  ordered: boolean;
  items:   RichText[];
}

export interface TableBlock extends BlockBase {
  type:     "table";
  header:   string[] | null;
  rows:     RichText[][];
  caption?: string;
}

export interface ImageBlock extends BlockBase {
  type:     "image";
  url:      string;
  alt:      string;
  caption?: string;
  width:    "full" | "half";
  align?:   "left" | "center" | "right";
}

export type Block = ParagraphBlock | ListBlock | TableBlock | ImageBlock;

// ─── Document hierarchy (Chapter → Subchapter) ────────────────────────────────

export interface Subchapter {
  id:           string;
  canonicalKey: string | null;
  heading:      string;         // rendered as "X.Y  Heading"
  order:        number;         // position within its chapter
  status:       "auto" | "edited" | "verified";
  generation:   "pending" | "streaming" | "complete";
  userAdded:    boolean;
  blocks:       Block[];
}

export interface Chapter {
  id:           string;
  number:       number;         // 1..N — each chapter gets a full-page cover
  title:        string;
  canonicalKey: string | null;
  intro?:       Block[];        // optional chapter intro before subchapters
  sections:     Subchapter[];
  userAdded:    boolean;
  // status is DERIVED at render (rolled up from intro + sections) — not stored
}

// ─── Cover / Header ────────────────────────────────────────────────────────────

export interface PlanMeta {
  title:           string;
  orgName:         string;
  orgLogoUrl:      string | null;
  periodLabel:     string;
  partnerLogoUrls: string[];
}

// ─── PlanDocument (top level) ──────────────────────────────────────────────────

export interface PlanDocument {
  id:         string;
  orgId:      string;
  meta:       PlanMeta;
  templateId: string;
  language:   Language;
  dir:        Direction;        // derived: ar → rtl, en → ltr
  chapters:   Chapter[];
  docStatus:  "generating" | "draft" | "final";
  createdAt:  string;
  updatedAt:  string;
}
