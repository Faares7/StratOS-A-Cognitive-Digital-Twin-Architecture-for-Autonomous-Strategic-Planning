"""Provenance builder helpers — thin wrappers over schema models."""
from __future__ import annotations
from typing import Any, Optional

from .schema import (
    AgentProvenanceModel,
    MixedProvenanceModel,
    ReferencePlanProvenanceModel,
)


def ref_plan_prov(
    section_key: str,
    section_heading: str,
    plan_title: str = "ITCS Strategic Plan 2020–2024",
    plan_id:    str = "itcs-2020-2024",
    page: Optional[int] = None,
) -> ReferencePlanProvenanceModel:
    return ReferencePlanProvenanceModel(
        planId=plan_id,
        planTitle=plan_title,
        canonicalKey=section_key,
        sectionHeading=section_heading,
        page=page,
    )


def agent_prov(
    agent:      str,
    finding:    str,
    source:     str = "database",
    category:   Optional[str]           = None,
    pillar_tag: Optional[str]           = None,
    evidence:   Optional[dict[str, Any]] = None,
) -> AgentProvenanceModel:
    return AgentProvenanceModel(
        agent=agent,
        finding=finding,
        source=source,
        category=category,      # type: ignore[arg-type]
        pillarTag=pillar_tag,
        evidence=evidence,
    )


def mixed_prov(
    sources: list[AgentProvenanceModel | ReferencePlanProvenanceModel],
) -> MixedProvenanceModel:
    return MixedProvenanceModel(sources=sources)   # type: ignore[arg-type]
