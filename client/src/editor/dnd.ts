// Shared drag state for dragging blocks (dataTransfer contents are not readable during dragover).
export const dragState: { blockIds: string[] | null; pageId: string | null; sidebarPageId: string | null; rowIds: string[] | null } = {
  blockIds: null,
  pageId: null,
  sidebarPageId: null,
  rowIds: null,
};

export function clearDrag() {
  dragState.blockIds = null;
  dragState.pageId = null;
  dragState.sidebarPageId = null;
  dragState.rowIds = null;
}
