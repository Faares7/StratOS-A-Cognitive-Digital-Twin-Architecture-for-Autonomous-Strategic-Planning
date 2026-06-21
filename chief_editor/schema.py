"""
Pydantic mirror of the TypeScript PlanDocument contract.
Field names use camelCase to match the TypeScript types exactly —
model_dump(mode="json") produces valid PlanDocument JSON directly.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional, Union
import uuid

from pydantic import BaseModel, ConfigDict, Field


# ── Utilities ─────────────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Provenance ────────────────────────────────────────────────────────────────

class AgentProvenanceModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind:       Literal["agent_signal"] = "agent_signal"
    agent:      str                                              # any agent name
    category:   Optional[Literal["strength", "weakness", "opportunity", "threat"]] = None
    source:     str
    finding:    str                                              # VERBATIM raw text
    insightId:  Optional[str]          = None
    pillarTag:  Optional[str]          = None
    confidence: Optional[float]        = None
    evidence:   Optional[dict[str, Any]] = None


class ReferencePlanProvenanceModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind:           Literal["reference_plan"] = "reference_plan"
    planId:         str
    planTitle:      str
    canonicalKey:   str
    sectionHeading: str
    page:           Optional[int] = None


class HumanProvenanceModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind:     Literal["human"] = "human"
    editedAt: str = Field(default_factory=_now)


class MixedProvenanceModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind:    Literal["mixed"] = "mixed"
    sources: list[Union[AgentProvenanceModel, ReferencePlanProvenanceModel, HumanProvenanceModel]]


ProvenanceModel = Union[
    AgentProvenanceModel,
    ReferencePlanProvenanceModel,
    HumanProvenanceModel,
    MixedProvenanceModel,
]


# ── ProseMirror (RichText) ────────────────────────────────────────────────────

class ProseMirrorMark(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type:  Literal["bold", "italic", "link"]
    attrs: Optional[dict[str, Any]] = None


class ProseMirrorNode(BaseModel):
    """Minimal ProseMirror JSON node — only the fields the template reads."""
    model_config = ConfigDict(populate_by_name=True)

    type:    str
    attrs:   Optional[dict[str, Any]]       = None
    content: Optional[list["ProseMirrorNode"]] = None
    marks:   Optional[list[ProseMirrorMark]]   = None
    text:    Optional[str]                     = None


ProseMirrorNode.model_rebuild()


def make_pm_doc(text: str) -> ProseMirrorNode:
    """Wrap a plain string in a minimal ProseMirror doc node."""
    return ProseMirrorNode(
        type="doc",
        content=[
            ProseMirrorNode(
                type="paragraph",
                content=[ProseMirrorNode(type="text", text=text)],
            )
        ],
    )


def make_pm_text(text: str) -> ProseMirrorNode:
    """A bare inline text node (used as list/table cell)."""
    return ProseMirrorNode(type="text", text=str(text))


def make_pm_bullets(items: list[str]) -> ProseMirrorNode:
    """A doc node containing a bulletList — use for table cells with multiple points."""
    if not items:
        return ProseMirrorNode(type="text", text="—")
    return ProseMirrorNode(
        type="doc",
        content=[
            ProseMirrorNode(
                type="bulletList",
                content=[
                    ProseMirrorNode(
                        type="listItem",
                        content=[
                            ProseMirrorNode(
                                type="paragraph",
                                content=[ProseMirrorNode(type="text", text=item)],
                            )
                        ],
                    )
                    for item in items
                    if item and item.strip()
                ],
            )
        ],
    )


# ── Blocks ────────────────────────────────────────────────────────────────────

class ParagraphBlockModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id:         str            = Field(default_factory=_uid)
    type:       Literal["paragraph"] = "paragraph"
    provenance: ProvenanceModel
    content:    ProseMirrorNode      # must be a "doc" node


class ListBlockModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id:         str            = Field(default_factory=_uid)
    type:       Literal["list"] = "list"
    provenance: ProvenanceModel
    ordered:    bool           = False
    items:      list[ProseMirrorNode]   # one text node per item


class TableBlockModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id:         str            = Field(default_factory=_uid)
    type:       Literal["table"] = "table"
    provenance: ProvenanceModel
    header:     Optional[list[str]]          = None
    rows:       list[list[ProseMirrorNode]]   # cell = text node
    caption:    Optional[str]                = None


class ImageBlockModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id:         str            = Field(default_factory=_uid)
    type:       Literal["image"] = "image"
    provenance: ProvenanceModel
    url:        str
    alt:        str
    caption:    Optional[str]                = None
    width:      Literal["full", "half"]      = "full"


BlockModel = Union[
    ParagraphBlockModel,
    ListBlockModel,
    TableBlockModel,
    ImageBlockModel,
]


# ── Document hierarchy ────────────────────────────────────────────────────────

class SubchapterModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id:           str            = Field(default_factory=_uid)
    canonicalKey: Optional[str]  = None
    heading:      str
    order:        int
    status:       Literal["auto", "edited", "verified"] = "auto"
    generation:   Literal["pending", "streaming", "complete"] = "complete"
    userAdded:    bool           = False
    needsReview:  bool           = False
    textAlign:    Optional[str]  = None   # "left" | "center" | "right"
    blocks:       list[BlockModel]


class ChapterModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id:           str            = Field(default_factory=_uid)
    number:       int
    title:        str
    canonicalKey: Optional[str]  = None
    intro:        Optional[list[BlockModel]] = None
    sections:     list[SubchapterModel]
    userAdded:    bool           = False


class PlanMetaModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title:           str
    orgName:         str
    orgLogoUrl:      Optional[str] = None
    periodLabel:     str
    approvalDate:    Optional[str] = None   # e.g. "June 2026" — set fresh by generator
    partnerLogoUrls: list[str]     = Field(default_factory=list)


class PlanDocumentModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id:         str = Field(default_factory=_uid)
    orgId:      str
    meta:       PlanMetaModel
    templateId: str                                       = "formal-gov"
    language:   Literal["en", "ar"]                      = "en"
    dir:        Literal["ltr", "rtl"]                    = "ltr"
    preface:    list[SubchapterModel]                     = Field(default_factory=list)
    chapters:   list[ChapterModel]
    docStatus:  Literal["generating", "draft", "final"]  = "draft"
    createdAt:  str = Field(default_factory=_now)
    updatedAt:  str = Field(default_factory=_now)
