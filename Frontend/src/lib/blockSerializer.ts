/**
 * blockSerializer.ts
 *
 * blockToText  — converts any Block to a plain-text string the LLM can read and rewrite.
 * textToBlock  — converts a plain-text LLM reply back into a Block of the same type.
 *
 * These are the two seams that keep the chat ↔ document loop lossless:
 * the LLM sees real content, its reply is inserted back in the correct shape.
 */

import type { Block, ProseMirrorNode, Provenance } from "@/types/plan-document";

// ── ProseMirror tree → plain text ──────────────────────────────────────────────

function pmNodeToText(node: ProseMirrorNode): string {
  if (node.type === "text") return node.text ?? "";
  const children = (node.content ?? []).map(pmNodeToText);
  if (node.type === "doc") return children.join("\n").trim();
  if (node.type === "paragraph") return children.join("");
  return children.join("");
}

// ── Block → text ───────────────────────────────────────────────────────────────

export function blockToText(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return pmNodeToText(block.content);

    case "list":
      return block.items
        .map((item, i) =>
          block.ordered
            ? `${i + 1}. ${pmNodeToText(item)}`
            : `- ${pmNodeToText(item)}`
        )
        .join("\n");

    case "table": {
      const header = block.header
        ? block.header.join(" | ") +
          "\n" +
          block.header.map(() => "---").join(" | ") +
          "\n"
        : "";
      const rows = block.rows
        .map((row) => row.map((cell) => pmNodeToText(cell)).join(" | "))
        .join("\n");
      return (header + rows).trim();
    }

    case "image":
      return block.caption
        ? `[Image: ${block.alt} — ${block.caption}]`
        : `[Image: ${block.alt}]`;
  }
}

// ── Text → Block ───────────────────────────────────────────────────────────────

function uid(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Convert a plain-text LLM reply back into a Block, preserving the original type.
 * Tables are downgraded to paragraph (restructuring a table from prose is error-prone).
 */
export function textToBlock(
  text: string,
  originalType: Block["type"],
  prov: Provenance
): Block {
  const id = uid();
  const trimmed = text.trim();

  if (originalType === "list") {
    const lines = trimmed
      .split("\n")
      .map((l) => l.replace(/^(\d+[.)]\s*|[-•*·]\s*)/, "").trim())
      .filter((l) => l.length > 0);

    const items = lines.length > 0 ? lines : [trimmed];
    return {
      id,
      type: "list",
      ordered: false,
      provenance: prov,
      items: items.map((l) => ({ type: "text", text: l })),
    };
  }

  // paragraph (also used as fallback for table / image — don't silently destroy structure)
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return {
    id,
    type: "paragraph",
    provenance: prov,
    content: {
      type: "doc",
      content: paragraphs.map((p) => ({
        type: "paragraph",
        content: [{ type: "text", text: p }],
      })),
    },
  };
}
