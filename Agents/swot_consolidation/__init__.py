"""
SWOT consolidation pipeline.

Consolidates accumulated agent SWOT emissions (the `swot_items` history) into the
strategic plan's SWOT section: dedup → lifecycle vs previous plan → two salience
scorers → hybrid selection → persist to `swot_consolidation_candidates`.

See docs/SWOT_PIPELINE.md for the architecture and migrations/003_swot_consolidation.sql
for the output table.
"""

from .pipeline import consolidate

__all__ = ["consolidate"]
