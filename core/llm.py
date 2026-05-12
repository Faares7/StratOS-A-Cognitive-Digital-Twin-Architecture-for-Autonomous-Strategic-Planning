"""
Centralised LLM configuration for all StratOS agents.

All agents import `local_brain` from here so every model switch, temperature
tweak, or endpoint change is made in exactly one place.

Requires Ollama running locally:
    ollama run llama3.1:8b
"""
from langchain_openai import ChatOpenAI

local_brain: ChatOpenAI = ChatOpenAI(
    model="llama3.1:8b",
    api_key="ollama",
    base_url="http://localhost:11434/v1",
    temperature=0.2,
)

# Guardrail appended to every agent's system prompt so the local model
# stays inside its JSON schema even when it would otherwise wrap output
# in markdown fences.
JSON_GUARDRAIL = (
    "\nYou must respond ONLY with valid JSON matching the exact schema provided. "
    "Do not include markdown formatting like ```json or any introductory text."
)
