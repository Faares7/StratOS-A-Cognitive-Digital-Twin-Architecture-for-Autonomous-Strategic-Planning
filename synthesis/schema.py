"""
Pydantic schema for PlanDocument and the intermediate Gemini output models.

Mirrors Frontend/src/types/plan-document.ts exactly so that Gemini's synthesis
output can be validated server-side before storage.
"""
from __future__ import annotations

from typing import Any, Literal, Union
from pydantic import BaseModel, Field


# ── Provenance ────────────────────────────────────────────────────────────────

class AgentProvenance(BaseModel):
    kind: Literal["agent_signal"]
    agent: str
    category: Literal["strength", "weakness", "opportunity", "threat"] | None = None
    source: str
    finding: str
    insight_id: str | None = None
    pillar_tag: str | None = None
    confidence: int | None = None
    evidence: dict[str, Any] = Field(default_factory=dict)


class ReferencePlanProvenance(BaseModel):
    kind: Literal["reference_plan"]
    plan_id: str
    plan_title: str
    canonical_key: str
    section_heading: str
    page: int | None = None


class HumanProvenance(BaseModel):
    kind: Literal["human"]
    edited_at: str


class MixedProvenance(BaseModel):
    kind: Literal["mixed"]
    sources: list[Union[AgentProvenance, ReferencePlanProvenance, HumanProvenance]]


Provenance = Union[AgentProvenance, ReferencePlanProvenance, HumanProvenance, MixedProvenance]


class ProvenanceSpan(BaseModel):
    from_: int = Field(alias="from")
    to: int
    provenance: Provenance


# ── Blocks ────────────────────────────────────────────────────────────────────
# ProseMirrorNode is recursive — represented as a plain dict.

ProseMirrorNode = dict[str, Any]


class BlockBase(BaseModel):
    id: str
    provenance: Provenance


class ParagraphBlock(BlockBase):
    type: Literal["paragraph"]
    content: ProseMirrorNode
    spans: list[ProvenanceSpan] | None = None


class ListBlock(BlockBase):
    type: Literal["list"]
    ordered: bool
    items: list[ProseMirrorNode]


class ListRow(BaseModel):
    cells: list[ProseMirrorNode]


class TableBlock(BlockBase):
    type: Literal["table"]
    header: list[str] | None = None
    rows: list[list[ProseMirrorNode]]
    caption: str | None = None


class ImageBlock(BlockBase):
    type: Literal["image"]
    url: str
    alt: str
    caption: str | None = None
    width: Literal["full", "half"] = "full"


Block = Union[ParagraphBlock, ListBlock, TableBlock, ImageBlock]


# ── Document structure ────────────────────────────────────────────────────────

class Subchapter(BaseModel):
    id: str
    canonical_key: str | None = None
    heading: str
    order: int
    status: Literal["auto", "edited", "verified"] = "auto"
    generation: Literal["pending", "streaming", "complete"] = "complete"
    user_added: bool = False
    blocks: list[Block]


class Chapter(BaseModel):
    id: str
    number: int
    title: str
    canonical_key: str | None = None
    intro: list[Block] | None = None
    sections: list[Subchapter]
    user_added: bool = False


class PlanMeta(BaseModel):
    title: str
    org_name: str
    org_logo_url: str | None = None
    period_label: str
    partner_logo_urls: list[str] = Field(default_factory=list)


class PlanDocument(BaseModel):
    id: str
    org_id: str
    meta: PlanMeta
    template_id: str = "formal-gov"
    language: Literal["en", "ar"] = "en"
    dir: Literal["ltr", "rtl"] = "ltr"
    chapters: list[Chapter]
    doc_status: Literal["generating", "draft", "final"] = "draft"
    created_at: str
    updated_at: str

    def to_frontend_dict(self) -> dict[str, Any]:
        """Serialize to the camelCase shape that matches the TypeScript PlanDocument."""
        d = self.model_dump(by_alias=False)
        return _snake_to_camel_deep(d)


# ── Intermediate Gemini output models ─────────────────────────────────────────

class GenParagraph(BaseModel):
    type: Literal["paragraph"]
    text: str
    source_ids: list[str] = Field(default_factory=list)


class GenList(BaseModel):
    type: Literal["list"]
    ordered: bool = False
    items: list[str]
    source_ids: list[str] = Field(default_factory=list)


class GenTable(BaseModel):
    type: Literal["table"]
    header: list[str] | None = None
    rows: list[list[str]]
    caption: str | None = None
    source_ids: list[str] = Field(default_factory=list)


GenBlock = Union[GenParagraph, GenList, GenTable]


class GenSubchapter(BaseModel):
    blocks: list[GenBlock]


# ── Helpers ───────────────────────────────────────────────────────────────────

def text_to_prosemirror(text: str) -> ProseMirrorNode:
    """Wrap a plain string in a minimal ProseMirror doc node."""
    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
        ],
    }


def _snake_to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _snake_to_camel_deep(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {_snake_to_camel(k): _snake_to_camel_deep(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_snake_to_camel_deep(i) for i in obj]
    return obj
