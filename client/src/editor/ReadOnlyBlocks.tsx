import React, { useMemo, useRef } from 'react';
import { EditorContext, type EditorCtx } from './context';
import { EditorStore } from './EditorStore';
import { BlockChildren } from './BlockView';
import type { Block, PageMeta, User } from '../types';

/** Renders blocks read-only (page history previews, published pages). */
export function ReadOnlyBlocks({
  blocks,
  pages,
  people = [],
  pageId,
  workspaceId,
  navigate,
  publicMode,
  ancestors = [],
  self,
}: {
  blocks: Block[];
  pages: Record<string, PageMeta>;
  people?: User[];
  pageId: string;
  workspaceId: string;
  navigate: (id: string) => void;
  publicMode?: boolean;
  ancestors?: PageMeta[];
  self?: PageMeta;
}) {
  const store = useMemo(() => new EditorStore(pageId, blocks, true), [pageId, blocks]);
  const menuKey = useRef(null);
  const ctx: EditorCtx = {
    store,
    pageId,
    workspaceId,
    readOnly: true,
    canComment: false,
    publicMode,
    pages,
    people,
    ancestors,
    pageMetaSelf: self || { id: pageId },
    navigate,
    menu: null,
    setMenu: () => {},
    menuKey,
    createSubpage: async () => {},
    createDatabase: async () => {},
    linkPage: () => {},
    discussionsByBlock: {},
    openDiscussion: () => {},
    startInlineComment: () => {},
    focusTitle: () => {},
    presenceByBlock: {},
    commitText: () => {},
  };
  return (
    <EditorContext.Provider value={ctx}>
      <div className="editor read-only">
        <BlockChildren parentId={null} />
      </div>
    </EditorContext.Provider>
  );
}
