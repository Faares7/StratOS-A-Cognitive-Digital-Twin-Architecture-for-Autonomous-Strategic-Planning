import React from "react";
import type { Editor } from "@tiptap/react";

export interface ActiveEditorCtxValue {
  activeEditor: Editor | null;
  activeChapterId: string | null;
  activeSubId: string | null | undefined;
  setActiveEditor: (editor: Editor | null, chapterId?: string, subId?: string | null) => void;
}

export const ActiveEditorCtx = React.createContext<ActiveEditorCtxValue>({
  activeEditor: null,
  activeChapterId: null,
  activeSubId: undefined,
  setActiveEditor: () => {},
});
