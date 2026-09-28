import React from 'react';
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, ChevronRight, FileText, MessageSquareQuote,
  Quote, Minus, Link2, Image, Video, Music, Code2, Paperclip, Bookmark, Globe, Table2, KanbanSquare, LayoutGrid,
  Rows3, CalendarDays, GanttChart, Database, ListTree, Sigma, Navigation, Columns2, Columns3, Columns4, AtSign,
  CalendarClock, FileSymlink, Table,
} from 'lucide-react';
import type { BlockType } from '../types';

export type SlashAction =
  | { kind: 'block'; type: BlockType; content?: Record<string, any> }
  | { kind: 'page' }
  | { kind: 'database'; view: string; inline: boolean }
  | { kind: 'columns'; count: number }
  | { kind: 'mention'; what: 'person' | 'page' | 'date' }
  | { kind: 'link_to_page' }
  | { kind: 'color'; color: string };

export interface SlashItem {
  id: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  keywords?: string;
  hint?: string;
  action: SlashAction;
}

const ic = (C: any) => <C size={18} strokeWidth={1.6} />;

export const BLOCK_LABELS: Partial<Record<BlockType, string>> = {
  text: 'Text',
  heading_1: 'Heading 1',
  heading_2: 'Heading 2',
  heading_3: 'Heading 3',
  bulleted_list: 'Bulleted list',
  numbered_list: 'Numbered list',
  to_do: 'To-do list',
  toggle: 'Toggle list',
  quote: 'Quote',
  callout: 'Callout',
  code: 'Code',
  page: 'Page',
};

export const TURN_INTO: { type: BlockType; label: string; icon: React.ReactNode; content?: Record<string, any> }[] = [
  { type: 'text', label: 'Text', icon: ic(Type) },
  { type: 'heading_1', label: 'Heading 1', icon: ic(Heading1) },
  { type: 'heading_2', label: 'Heading 2', icon: ic(Heading2) },
  { type: 'heading_3', label: 'Heading 3', icon: ic(Heading3) },
  { type: 'bulleted_list', label: 'Bulleted list', icon: ic(List) },
  { type: 'numbered_list', label: 'Numbered list', icon: ic(ListOrdered) },
  { type: 'to_do', label: 'To-do list', icon: ic(CheckSquare) },
  { type: 'toggle', label: 'Toggle list', icon: ic(ChevronRight) },
  { type: 'code', label: 'Code', icon: ic(Code2) },
  { type: 'quote', label: 'Quote', icon: ic(Quote) },
  { type: 'callout', label: 'Callout', icon: ic(MessageSquareQuote) },
  { type: 'heading_1', label: 'Toggle heading 1', icon: ic(Heading1), content: { toggleable: true } },
  { type: 'heading_2', label: 'Toggle heading 2', icon: ic(Heading2), content: { toggleable: true } },
  { type: 'heading_3', label: 'Toggle heading 3', icon: ic(Heading3), content: { toggleable: true } },
];

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: 'Text', group: 'Basic blocks', icon: ic(Type), keywords: 'plain paragraph', action: { kind: 'block', type: 'text' } },
  { id: 'h1', label: 'Heading 1', group: 'Basic blocks', icon: ic(Heading1), hint: '#', keywords: 'h1 title big', action: { kind: 'block', type: 'heading_1' } },
  { id: 'h2', label: 'Heading 2', group: 'Basic blocks', icon: ic(Heading2), hint: '##', keywords: 'h2 subtitle', action: { kind: 'block', type: 'heading_2' } },
  { id: 'h3', label: 'Heading 3', group: 'Basic blocks', icon: ic(Heading3), hint: '###', keywords: 'h3', action: { kind: 'block', type: 'heading_3' } },
  { id: 'bullet', label: 'Bulleted list', group: 'Basic blocks', icon: ic(List), hint: '-', keywords: 'bullet unordered ul', action: { kind: 'block', type: 'bulleted_list' } },
  { id: 'number', label: 'Numbered list', group: 'Basic blocks', icon: ic(ListOrdered), hint: '1.', keywords: 'ordered ol', action: { kind: 'block', type: 'numbered_list' } },
  { id: 'todo', label: 'To-do list', group: 'Basic blocks', icon: ic(CheckSquare), hint: '[]', keywords: 'todo checkbox task', action: { kind: 'block', type: 'to_do' } },
  { id: 'toggle', label: 'Toggle list', group: 'Basic blocks', icon: ic(ChevronRight), hint: '>', keywords: 'collapse', action: { kind: 'block', type: 'toggle' } },
  { id: 'page', label: 'Page', group: 'Basic blocks', icon: ic(FileText), keywords: 'subpage new', action: { kind: 'page' } },
  { id: 'callout', label: 'Callout', group: 'Basic blocks', icon: ic(MessageSquareQuote), keywords: 'note info tip', action: { kind: 'block', type: 'callout' } },
  { id: 'quote', label: 'Quote', group: 'Basic blocks', icon: ic(Quote), hint: '"', keywords: 'blockquote citation', action: { kind: 'block', type: 'quote' } },
  { id: 'table', label: 'Table', group: 'Basic blocks', icon: ic(Table), keywords: 'simple table grid', action: { kind: 'block', type: 'table', content: { rows: [['', '', ''], ['', '', ''], ['', '', '']], headerRow: true } } },
  { id: 'divider', label: 'Divider', group: 'Basic blocks', icon: ic(Minus), hint: '---', keywords: 'hr line separator', action: { kind: 'block', type: 'divider' } },
  { id: 'linkpage', label: 'Link to page', group: 'Basic blocks', icon: ic(FileSymlink), keywords: 'reference', action: { kind: 'link_to_page' } },
  { id: 'th1', label: 'Toggle heading 1', group: 'Basic blocks', icon: ic(Heading1), keywords: 'collapsible', action: { kind: 'block', type: 'heading_1', content: { toggleable: true } } },
  { id: 'th2', label: 'Toggle heading 2', group: 'Basic blocks', icon: ic(Heading2), keywords: 'collapsible', action: { kind: 'block', type: 'heading_2', content: { toggleable: true } } },
  { id: 'th3', label: 'Toggle heading 3', group: 'Basic blocks', icon: ic(Heading3), keywords: 'collapsible', action: { kind: 'block', type: 'heading_3', content: { toggleable: true } } },

  { id: 'mention-person', label: 'Mention a person', group: 'Inline', icon: ic(AtSign), keywords: 'user @', action: { kind: 'mention', what: 'person' } },
  { id: 'mention-page', label: 'Mention a page', group: 'Inline', icon: ic(FileText), keywords: 'link @', action: { kind: 'mention', what: 'page' } },
  { id: 'date', label: 'Date or reminder', group: 'Inline', icon: ic(CalendarClock), keywords: 'today time', action: { kind: 'mention', what: 'date' } },

  { id: 'db-table', label: 'Table view', group: 'Database', icon: ic(Table2), keywords: 'database inline spreadsheet', action: { kind: 'database', view: 'table', inline: true } },
  { id: 'db-board', label: 'Board view', group: 'Database', icon: ic(KanbanSquare), keywords: 'kanban database', action: { kind: 'database', view: 'board', inline: true } },
  { id: 'db-gallery', label: 'Gallery view', group: 'Database', icon: ic(LayoutGrid), keywords: 'cards database', action: { kind: 'database', view: 'gallery', inline: true } },
  { id: 'db-list', label: 'List view', group: 'Database', icon: ic(Rows3), keywords: 'database', action: { kind: 'database', view: 'list', inline: true } },
  { id: 'db-calendar', label: 'Calendar view', group: 'Database', icon: ic(CalendarDays), keywords: 'database month', action: { kind: 'database', view: 'calendar', inline: true } },
  { id: 'db-timeline', label: 'Timeline view', group: 'Database', icon: ic(GanttChart), keywords: 'database gantt roadmap', action: { kind: 'database', view: 'timeline', inline: true } },
  { id: 'db-inline', label: 'Database - Inline', group: 'Database', icon: ic(Database), keywords: 'table', action: { kind: 'database', view: 'table', inline: true } },
  { id: 'db-full', label: 'Database - Full page', group: 'Database', icon: ic(Database), keywords: 'table page', action: { kind: 'database', view: 'table', inline: false } },

  { id: 'image', label: 'Image', group: 'Media', icon: ic(Image), keywords: 'picture photo upload', action: { kind: 'block', type: 'image' } },
  { id: 'video', label: 'Video', group: 'Media', icon: ic(Video), keywords: 'youtube vimeo movie', action: { kind: 'block', type: 'video' } },
  { id: 'audio', label: 'Audio', group: 'Media', icon: ic(Music), keywords: 'sound mp3', action: { kind: 'block', type: 'audio' } },
  { id: 'code', label: 'Code', group: 'Media', icon: ic(Code2), hint: '```', keywords: 'snippet programming', action: { kind: 'block', type: 'code' } },
  { id: 'file', label: 'File', group: 'Media', icon: ic(Paperclip), keywords: 'upload attachment', action: { kind: 'block', type: 'file' } },
  { id: 'bookmark', label: 'Web bookmark', group: 'Media', icon: ic(Bookmark), keywords: 'link url preview', action: { kind: 'block', type: 'bookmark' } },
  { id: 'embed', label: 'Embed', group: 'Media', icon: ic(Globe), keywords: 'iframe website', action: { kind: 'block', type: 'embed' } },

  { id: 'toc', label: 'Table of contents', group: 'Advanced blocks', icon: ic(ListTree), keywords: 'toc outline headings', action: { kind: 'block', type: 'table_of_contents' } },
  { id: 'equation', label: 'Block equation', group: 'Advanced blocks', icon: ic(Sigma), keywords: 'math latex katex formula', action: { kind: 'block', type: 'equation' } },
  { id: 'breadcrumb', label: 'Breadcrumb', group: 'Advanced blocks', icon: ic(Navigation), keywords: 'path', action: { kind: 'block', type: 'breadcrumb' } },
  { id: 'col2', label: '2 columns', group: 'Advanced blocks', icon: ic(Columns2), keywords: 'layout side', action: { kind: 'columns', count: 2 } },
  { id: 'col3', label: '3 columns', group: 'Advanced blocks', icon: ic(Columns3), keywords: 'layout', action: { kind: 'columns', count: 3 } },
  { id: 'col4', label: '4 columns', group: 'Advanced blocks', icon: ic(Columns4), keywords: 'layout', action: { kind: 'columns', count: 4 } },
];

const COLOR_LIST = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
export const COLOR_SLASH: SlashItem[] = [
  { id: 'c-default', label: 'Default', group: 'Color', icon: <span className="color-swatch">A</span>, keywords: 'color', action: { kind: 'color', color: 'default' } },
  ...COLOR_LIST.map((c) => ({
    id: 'c-' + c,
    label: c[0].toUpperCase() + c.slice(1),
    group: 'Color',
    icon: <span className={'color-swatch color-' + c}>A</span>,
    keywords: 'color text',
    action: { kind: 'color', color: c } as SlashAction,
  })),
  ...COLOR_LIST.map((c) => ({
    id: 'b-' + c,
    label: c[0].toUpperCase() + c.slice(1) + ' background',
    group: 'Color',
    icon: <span className={'color-swatch bg-' + c}>A</span>,
    keywords: 'color background highlight',
    action: { kind: 'color', color: c + '_background' } as SlashAction,
  })),
];

export function filterSlash(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  const all = [...SLASH_ITEMS, ...COLOR_SLASH];
  if (!q) return SLASH_ITEMS;
  const scored = all
    .map((it) => {
      const label = it.label.toLowerCase();
      let s = 0;
      if (label.startsWith(q)) s = 3;
      else if (label.split(/\s+/).some((w) => w.startsWith(q))) s = 2;
      else if (label.includes(q) || (it.keywords || '').includes(q) || it.id.includes(q)) s = 1;
      else if (fuzzy(label, q)) s = 0.5;
      return { it, s };
    })
    .filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.it);
}

function fuzzy(text: string, q: string) {
  let i = 0;
  for (const ch of text) if (ch === q[i]) i++;
  return i === q.length && q.length > 2;
}
