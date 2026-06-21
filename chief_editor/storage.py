"""CRUD for the generated_plans table (run migration_generated_plans.sql first)."""
from __future__ import annotations
import json
from typing import Any, Optional

import psycopg2.extras

from .schema import PlanDocumentModel


def insert_plan(conn, doc: PlanDocumentModel) -> str:
    """Insert (or upsert on plan_id) a plan. Returns plan_id."""
    doc_dict = doc.model_dump(mode="json")
    plan_id  = doc.id

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.generated_plans
                (plan_id, org_id, language, template_id, status, document)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (plan_id) DO UPDATE
                SET document   = EXCLUDED.document,
                    status     = EXCLUDED.status,
                    updated_at = NOW()
            """,
            (
                plan_id,
                doc.orgId,
                doc.language,
                doc.templateId,
                doc.docStatus,
                json.dumps(doc_dict),
            ),
        )
    return plan_id


def get_plan(conn, plan_id: str) -> Optional[dict[str, Any]]:
    """Fetch one generated_plans row. Returns None if not found."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM public.generated_plans WHERE plan_id = %s LIMIT 1",
            (plan_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def list_plans(conn, org_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """List plans for an org, newest first."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT plan_id, org_id, language, template_id, status, created_at, updated_at
            FROM   public.generated_plans
            WHERE  org_id = %s
            ORDER  BY created_at DESC
            LIMIT  %s
            """,
            (org_id, limit),
        )
        return [dict(r) for r in cur.fetchall()]
