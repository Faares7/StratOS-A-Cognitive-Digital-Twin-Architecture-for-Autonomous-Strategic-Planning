# Project Overview: StratOS

**StratOS** is defined as a "Cognitive Digital Twin Architecture for Autonomous Strategic Planning".  
Traditionally, digital twins simulate physical assets (like a robotic arm or a factory line). StratOS evolves this concept by simulating the strategic reasoning of a human decision-maker to manage the operational systems of an entire organization.  

## The Core Problem it Solves:

* **Cognitive Latency:** Organizations suffer from a state where decision-making is out of sync with data. Market realities change daily, but strategic planning occurs in slow 3-5 year cycles.  
* **The Execution Gap:** Because human leaders are bottlenecked by a flood of unstructured data (PDFs, CSVs), decisions are often based on intuition rather than evidence. This leads to a massive 87.5% failure rate in executing strategic visions.  

## The Solution:
StratOS acts as a universal strategic operating system that closes this gap by sensing real-time data, reasoning over it securely, and synthesizing actionable plans. It is specifically built for highly regulated B2B/B2G environments (like Higher Education under NAQAAE accreditation) where "Chatbots" fail due to hallucinations and "Calculators" fail due to their inability to read unstructured text.  

## The 4-Phase Architecture & The Agent Ecosystem
StratOS operates on a 4-Phase Architecture. Instead of one giant, unpredictable AI model, it relies on a highly governed network of specialized "micro-service" agents.  

Here is the detailed breakdown of every agent and its exact role:

### Phase 1: The Context Layer (Governance & Memory)   
This phase acts as the institutional long-term memory.  

* **The Knowledge Custodian:** This agent manages the ingestion of immutable documents (like University Bylaws, Charters, and Strategic Plans) and converts them into a searchable Vector Database.  
* **The Compliance Officer:** Acting as a regulatory firewall, this agent strictly validates all downstream reasoning against the institution's rules to prevent the AI from generating policy violations.  

### Phase 2: The Signal Layer (Perception & Monitoring)   
This phase captures real-time reality.  

* **The Sentiment Engine:** Ingests raw, unstructured data (like student survey CSVs) and uses fast extraction (via models like Gemini 2.5 Flash) to filter noise, unify synonyms, and output clean, structured JSON themes.  
* **The Benchmarking Agent:** Automates external market analysis by fetching competitor publications, citations, and metrics to build a structured benchmarking database.  
* **The Survey Agent (Grad 2 Addition):** Dynamically pulls current system weaknesses and generates highly targeted, NAQAAE-compliant questions, publishing them directly to Google Forms to gather fresh signal data.

### Phase 3: Processing & Reasoning (The Brain)   
This is where the actual intelligence happens.

* **The Orchestrator:** The central hub that manages data feeds, triggers analysis, and routes information between the different agents using a LangGraph setup.  
* **The Gap Engine:** Continuously measures the variance between the initial Strategic Vision (Phase 1) and the Current Reality (Phase 2) to trigger necessary alerts.  
* **The SWOT Synthesizer:** Merges the internal sentiment data, external benchmarking data, and institutional context to actively formulate real-time Strengths, Weaknesses, Opportunities, and Threats.  
* **The Boardroom Simulator:** Before a strategy is proposed, this agent enters a "deliberation phase." It uses Dialectic Debate and Monte Carlo simulations to stress-test ideas in a safe environment.  

### Phase 4: Plan Synthesis (The Output)   

* **The Chief Editor:** Synthesizes the final simulation results and decisions into a concrete, human-readable "Strategic Roadmap" or PDF draft.  

## The Human-in-the-Loop
Crucially, StratOS does not execute strategy completely blindly. It operates on a Human-in-the-Loop philosophy. The system ingests data, applies values, and recommends options, but the human C-Suite Executive is required to ratify the final decision. StratOS is an exoskeleton for the strategic leader, not their replacement.  

***
*Now that you have this holistic view, how confident do you feel about explaining the LangGraph routing between these specific agents if the panel asks you a highly technical question during the defense?*
