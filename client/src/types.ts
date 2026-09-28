export type Role = 'full' | 'edit' | 'comment' | 'view';

export interface User {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
  color: string;
  role?: string;
  settings?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  role: 'owner' | 'member' | 'guest';
  createdBy: string;
}

export interface Cover {
  type: 'color' | 'image';
  value: string;
  position: number;
}

export interface PageFormat {
  fullWidth?: boolean;
  smallText?: boolean;
  font?: 'default' | 'serif' | 'mono';
  locked?: boolean;
  showBacklinks?: boolean;
  pageOpen?: 'side' | 'center' | 'full';
}

export interface Page {
  id: string;
  workspaceId: string;
  parentId: string | null;
  parentType: 'workspace' | 'page' | 'database';
  type: 'page' | 'database';
  title: string;
  icon: string | null;
  cover: Cover | null;
  properties: Record<string, any>;
  schema: DbSchema | null;
  format: PageFormat;
  isInline: boolean;
  visibility: 'private' | 'workspace';
  position: number;
  public: boolean;
  createdBy: string;
  createdAt: number;
  updatedBy: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

export interface PageMeta {
  id: string;
  title?: string;
  icon?: string | null;
  type?: 'page' | 'database';
  parentId?: string | null;
  parentType?: string;
  isInline?: boolean;
  deleted?: boolean;
  noAccess?: boolean;
  accessible?: boolean;
}

export type BlockType =
  | 'text' | 'heading_1' | 'heading_2' | 'heading_3' | 'bulleted_list' | 'numbered_list' | 'to_do' | 'toggle'
  | 'quote' | 'callout' | 'code' | 'divider' | 'image' | 'video' | 'audio' | 'file' | 'bookmark' | 'embed'
  | 'page' | 'child_database' | 'link_to_page' | 'equation' | 'table_of_contents' | 'table' | 'column_list'
  | 'column' | 'breadcrumb';

export interface Block {
  id: string;
  pageId: string;
  parentId: string | null;
  type: BlockType;
  content: Record<string, any>;
  position: number;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

export type Op =
  | { type: 'insert'; block: Block }
  | { type: 'update'; id: string; set: Partial<Pick<Block, 'type' | 'content' | 'parentId' | 'position'>> }
  | { type: 'delete'; id: string; keepPage?: boolean };

export interface SidebarPage {
  id: string;
  title: string;
  icon: string | null;
  type: 'page' | 'database';
  parentId: string | null;
  position: number;
  isInline: boolean;
  section: 'workspace' | 'private' | 'shared' | null;
  role: Role;
}

export type PropertyType =
  | 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'person' | 'files' | 'checkbox'
  | 'url' | 'email' | 'phone' | 'formula' | 'relation' | 'rollup' | 'created_time' | 'created_by'
  | 'last_edited_time' | 'last_edited_by' | 'unique_id';

export interface SelectOption {
  id: string;
  name: string;
  color: string;
  group?: 'todo' | 'in_progress' | 'complete';
}

export interface PropertyDef {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  format?: string;
  expression?: string;
  prefix?: string;
  next?: number;
  databaseId?: string | null;
  relation?: string | null;
  target?: string | null;
  fn?: string;
  dateFormat?: string;
  wrap?: boolean;
}

export interface DbSchema {
  properties: Record<string, PropertyDef>;
  order: string[];
}

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';

export interface Filter {
  id: string;
  property: string;
  operator: string;
  value?: any;
}

export interface Sort {
  property: string;
  direction: 'asc' | 'desc';
}

export interface ViewConfig {
  properties?: { id: string; visible: boolean; width?: number }[];
  filters?: Filter[];
  filterOp?: 'and' | 'or';
  sorts?: Sort[];
  groupBy?: string | null;
  hiddenGroups?: string[];
  groupOrder?: string[];
  dateBy?: string | null;
  endDateBy?: string | null;
  cardPreview?: 'none' | 'cover' | 'content';
  cardSize?: 'small' | 'medium' | 'large';
  wrap?: boolean;
  calcs?: Record<string, string>;
  openIn?: 'side' | 'center' | 'full';
  showIcons?: boolean;
  hideEmptyGroups?: boolean;
}

export interface DbView {
  id: string;
  databaseId: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  position: number;
}

export interface DatabaseData {
  database: Page;
  role: Role;
  views: DbView[];
  rows: Page[];
  previews: Record<string, { type: string; content: any }[]>;
  related: Record<string, { database: { id: string; title: string; icon: string | null; schema: DbSchema }; rows: Page[] }>;
  people: User[];
  parent?: PageMeta | null;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  author: User;
}

export interface Discussion {
  id: string;
  pageId: string;
  blockId: string | null;
  anchorText: string | null;
  resolved: boolean;
  createdAt: number;
  createdBy: User;
  comments: Comment[];
}

export interface Notification {
  id: string;
  type: string;
  read: boolean;
  archived: boolean;
  createdAt: number;
  actor: User | null;
  page: PageMeta | null;
  workspace: { id: string; name: string; icon: string | null } | null;
  data: Record<string, any>;
}

export interface PresenceUser {
  clientId: string;
  userId: string;
  name: string;
  color: string;
  blockId: string | null;
}
