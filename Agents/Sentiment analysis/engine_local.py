import os
import asyncio
import numpy as np
import pandas as pd
from typing import List, Dict, Any
from typing_extensions import TypedDict
from pydantic import BaseModel, Field
from langchain_ollama import OllamaEmbeddings
from langgraph.graph import StateGraph, END
from core.llm import JSON_GUARDRAIL, local_brain

# ==========================================
# 1. DEFINE SCHEMAS (Strict Pydantic Guards)
# ==========================================
class ThemeSnippet(BaseModel):
    label: str = Field(description="A concise 2-4 word theme label")
    quote_sample: str = Field(description="A direct quote justifying this theme")

class ExtractedThemes(BaseModel):
    strengths: List[ThemeSnippet]
    weaknesses: List[ThemeSnippet]

# ==========================================
# 2. DEFINE THE GRAPH STATE
# ==========================================
class SentimentState(TypedDict):
    raw_data: List[Dict[str, Any]]
    total_students: int
    all_extracted_themes: List[Dict]
    aggregated_report: Dict[str, Any]
    institution_id: str

# ==========================================
# 3. THE NODES (Map-Reduce Logic)
# ==========================================
def ingest_node(state: SentimentState):
    total = len(state['raw_data'])
    print(f"📥 [Ingest] Ingested {total} stakeholder records locally.")
    return {"total_students": total}

_SENTIMENT_SYSTEM = (
    "You are a qualitative analyst. Extract key strategic themes (strengths and "
    "weaknesses) from the stakeholder feedback provided. For each theme return a "
    "concise 2-4 word label and a direct quote that justifies it."
    + JSON_GUARDRAIL
)

async def llm_processing_node(state: SentimentState):
    print("🧠 [LLM Node] Processing batches via local Ollama...")

    structured_llm = local_brain.with_structured_output(ExtractedThemes)

    # Max 2 students per prompt to protect VRAM
    batch_size = 2
    raw_data = state['raw_data']
    batches = [raw_data[i:i + batch_size] for i in range(0, len(raw_data), batch_size)]

    # Process one batch at a time to avoid overloading the local model
    gpu_limit = asyncio.Semaphore(1)

    async def process_batch(batch):
        async with gpu_limit:
            from langchain_core.messages import SystemMessage, HumanMessage
            human_text = "Analyze the following stakeholder feedback and extract key strategic themes:\n\n"
            for student in batch:
                human_text += "- Stakeholder Record:\n"
                for column_name, value in student.items():
                    if pd.notna(value) and str(value).strip() != "":
                        human_text += f"  * {column_name}: {value}\n"
                human_text += "\n"
            return await structured_llm.ainvoke([
                SystemMessage(content=_SENTIMENT_SYSTEM),
                HumanMessage(content=human_text),
            ])
            
    tasks = [process_batch(b) for b in batches]
    results = await asyncio.gather(*tasks)
    
    all_themes = [r.model_dump() for r in results]
    print(f"✅ [LLM Node] Extracted themes locally without crashing the GPU.")
    return {"all_extracted_themes": all_themes}

def aggregate_node(state: SentimentState):
    print("⚙️ [Aggregate Node] Running Semantic Vector clustering (Local CPU)...")
    embeddings_model = OllamaEmbeddings(model="nomic-embed-text")
    
    #embeddings_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    
    raw_strengths, raw_weaknesses = [], []
    for batch_result in state['all_extracted_themes']:
        raw_strengths.extend(batch_result['strengths'])
        raw_weaknesses.extend(batch_result['weaknesses'])
        
    def semantic_merge(theme_list, threshold=0.75):
        if not theme_list: return []
        labels = [item['label'] for item in theme_list]
        vector_embeddings = embeddings_model.embed_documents(labels)
        
        merged_clusters = []
        for i, item in enumerate(theme_list):
            label, quote, emb = item['label'], item['quote_sample'], np.array(vector_embeddings[i])
            found_match = False
            for cluster in merged_clusters:
                cluster_emb = cluster['embedding']
                similarity = np.dot(emb, cluster_emb) / (np.linalg.norm(emb) * np.linalg.norm(cluster_emb))
                if similarity >= threshold:
                    cluster['value'] += 1
                    cluster['quotes'].append(quote)
                    found_match = True
                    break
            if not found_match:
                merged_clusters.append({"label": label, "value": 1, "quotes": [quote], "embedding": emb})
        for c in merged_clusters: del c['embedding']
        return merged_clusters

    grouped_strengths = semantic_merge(raw_strengths)
    grouped_weaknesses = semantic_merge(raw_weaknesses)
    
    total_strength_comments = sum(item['value'] for item in grouped_strengths)
    for item in grouped_strengths:
        item['percentage'] = str(round((item['value'] / total_strength_comments) * 100, 1)) if total_strength_comments else "0"
    grouped_strengths.sort(key=lambda x: x['value'], reverse=True)

    total_weakness_comments = sum(item['value'] for item in grouped_weaknesses)
    for item in grouped_weaknesses:
        item['percentage'] = str(round((item['value'] / total_weakness_comments) * 100, 1)) if total_weakness_comments else "0"
    grouped_weaknesses.sort(key=lambda x: x['value'], reverse=True)
    
    final_report = {
        "summary": {
            "total_students_analyzed": state['total_students'],
            "total_unique_strengths": len(grouped_strengths),
            "total_unique_weaknesses": len(grouped_weaknesses)
        },
        "top_strengths": grouped_strengths[:10],
        "top_weaknesses": grouped_weaknesses[:10]
    }
    print("📊 [Aggregate Node] Semantic aggregation complete.")
    return {"aggregated_report": final_report}

def supabase_node(state: SentimentState):
    print("☁️ [Database Node] Preparing to save to Supabase...")
    return state

# ==========================================
# 4. WIRE THE GRAPH TOGETHER
# ==========================================
workflow = StateGraph(SentimentState)
workflow.add_node("ingest", ingest_node)
workflow.add_node("llm_process", llm_processing_node)
workflow.add_node("aggregate", aggregate_node)
workflow.add_node("save", supabase_node)

workflow.set_entry_point("ingest")
workflow.add_edge("ingest", "llm_process")
workflow.add_edge("llm_process", "aggregate")
workflow.add_edge("aggregate", "save")
workflow.add_edge("save", END)
sentiment_engine = workflow.compile()

# ==========================================
# 5. EXECUTION BLOCK
# ==========================================
async def main():
    # 1. Get the exact folder pathway where this Python script is currently saved
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 2. Attach the filename to that exact pathway
    file_name = "cleaned_students.csv"
    target_filename = os.path.join(script_dir, file_name)
    
    print(f"\n📂 Reading survey data locally from {target_filename}...")
    
    try:
        _, file_extension = os.path.splitext(target_filename)
        file_extension = file_extension.lower()
        if file_extension == '.csv':
            df = pd.read_csv(target_filename)
        elif file_extension in ['.xlsx', '.xls']:
            df = pd.read_excel(target_filename)
        else:
            return
        real_surveys = df.to_dict(orient='records')
        print(f"✅ Successfully loaded {len(real_surveys)} rows.")
    except Exception as e:
        print(f"\n❌ Error reading data file: {e}")
        return

    initial_state = {"raw_data": real_surveys, "institution_id": "I57629906"}
    print("\n🚀 Starting Local StratOS Sentiment Engine Workflow...")
    final_state = await sentiment_engine.ainvoke(initial_state)

    print("\n================ FINAL JSON OUTPUT ================")
    print("\n--- Summary ---")
    print(final_state['aggregated_report']['summary'])
    print("\n--- Top Strengths ---")
    for item in final_state['aggregated_report']['top_strengths']:
        print(f"• {item['label']} (Count: {item['value']}, Share: {item['percentage']}%)")
    print("\n--- Top Weaknesses ---")
    for item in final_state['aggregated_report']['top_weaknesses']:
        print(f"• {item['label']} (Count: {item['value']}, Share: {item['percentage']}%)")

async def compile_and_run(csv_path: str) -> dict:
    """
    Normalized entry point for API integration.
    Accepts an explicit path to the student CSV file, runs the full pipeline,
    and returns an aggregated sentiment report as a dictionary.
    """
    try:
        _, ext = os.path.splitext(csv_path)
        if ext.lower() in (".xlsx", ".xls"):
            df = pd.read_excel(csv_path)
        else:
            df = pd.read_csv(csv_path)
        records = df.to_dict(orient="records")
    except Exception as e:
        return {"error": str(e), "aggregated_report": None, "total_students": 0}

    initial_state = {"raw_data": records, "institution_id": "I57629906"}
    result = await sentiment_engine.ainvoke(initial_state)

    return {
        "aggregated_report": result.get("aggregated_report"),
        "total_students": result.get("total_students", 0),
        "institution_id": result.get("institution_id", "I57629906"),
        "error": None,
    }


if __name__ == "__main__":
    asyncio.run(main())