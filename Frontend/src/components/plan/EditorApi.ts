import React from "react";
import type { Block, PlanMeta } from "@/types/plan-document";

export interface EditorApi {
  // Block ops — subId null targets chapter intro
  updateBlock(chapterId: string, subId: string | null, blockId: string, next: Block): void;
  addBlock(chapterId: string, subId: string | null, kind: Block["type"], afterBlockId?: string, atStart?: boolean): void;
  deleteBlock(chapterId: string, subId: string | null, blockId: string): void;
  moveBlock(chapterId: string, subId: string | null, blockId: string, dir: "up" | "down"): void;
  // Heading edit — subId null = chapter title
  setHeading(chapterId: string, subId: string | null, text: string): void;
  // Subchapter lifecycle
  approveSubchapter(chapterId: string, subId: string): void;
  addSubchapter(chapterId: string): void;
  deleteSubchapter(chapterId: string, subId: string): void;
  moveSubchapter(chapterId: string, subId: string, dir: "up" | "down"): void;
  // Chapter lifecycle
  addChapter(): void;
  deleteChapter(chapterId: string): void;
  moveChapter(chapterId: string, dir: "up" | "down"): void;
  // Document meta
  updateMeta(patch: Partial<PlanMeta>): void;
}

export interface EditCtxValue {
  editorApi: EditorApi | null;
  chapterId: string;
  subId: string | null;
}

export const EditCtx = React.createContext<EditCtxValue>({
  editorApi: null,
  chapterId: "",
  subId: null,
});
