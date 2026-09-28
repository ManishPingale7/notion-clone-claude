import { createContext, useContext, useSyncExternalStore, useRef } from 'react';
import type { EditorStore } from './EditorStore';
import type { Discussion, PageMeta, User } from '../types';

export interface MenuState {
  kind: 'slash' | 'mention' | 'link';
  blockId: string;
  start: number; // text offset of the trigger character
  rect: DOMRect;
  mentionWhat?: 'person' | 'page' | 'date';
}

export interface EditorCtx {
  store: EditorStore;
  pageId: string;
  workspaceId: string;
  readOnly: boolean;
  canComment: boolean;
  publicMode?: boolean;
  pages: Record<string, PageMeta>;
  people: User[];
  ancestors: PageMeta[];
  pageMetaSelf: PageMeta;
  navigate: (pageId: string) => void;
  menu: MenuState | null;
  setMenu: (m: MenuState | null) => void;
  menuKey: React.MutableRefObject<((e: KeyboardEvent | React.KeyboardEvent) => boolean) | null>;
  createSubpage: (opts: { after?: string | null; replace?: string; parentBlockId?: string | null }) => Promise<void>;
  createDatabase: (opts: { after?: string | null; replace?: string; view: string; inline: boolean }) => Promise<void>;
  linkPage: (blockId: string, replace: boolean) => void;
  discussionsByBlock: Record<string, Discussion[]>;
  openDiscussion: (blockId: string, rect: DOMRect, discussionId?: string) => void;
  startInlineComment: (blockId: string, discussionId: string, anchorText: string, rect: DOMRect) => void;
  focusTitle: () => void;
  presenceByBlock: Record<string, { name: string; color: string }[]>;
  commitText: (blockId: string) => void;
}

export const EditorContext = createContext<EditorCtx>(null as any);
export const useEditor = () => useContext(EditorContext);

/** Subscribe to part of the store; re-render only when the selected value changes. */
export function useStoreValue<T>(store: EditorStore, select: () => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ v: T } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const v = select();
    if (cache.current && eq(cache.current.v, v)) return cache.current.v;
    cache.current = { v };
    return v;
  });
}

export const shallowArrayEq = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
