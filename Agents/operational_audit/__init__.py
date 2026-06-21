"""
Operational Audit agent.

Mines multi-year execution trends from the executive action plan and 1..N annual
monitoring reports, then writes strengths/weaknesses to swot_items under
agent_id = "operational_audit" so the goals planner consumes them automatically.
"""
from .config import AGENT_ID
from .graph import RUN_CONFIG, build_initial_state, compile_and_run, get_graph

__all__ = [
    "AGENT_ID",
    "compile_and_run",
    "get_graph",
    "build_initial_state",
    "RUN_CONFIG",
]
