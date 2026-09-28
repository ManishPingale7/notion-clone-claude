import React, { useState } from 'react';
import { Bookmark, Globe } from 'lucide-react';
import type { Block } from '../../types';
import { useEditor } from '../context';
import { api } from '../../api';
import { Popover } from '../../components/ui';
import { InlineEditable } from './InlineEditable';
import { videoEmbedUrl, useAutoOpen } from './MediaBlock';

function UrlForm({ label, onSubmit }: { label: string; onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState('');
  return (
    <form
      style={{ padding: 12, width: 460, maxWidth: 'calc(100vw - 40px)' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onSubmit(/^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://' + url.trim());
      }}
    >
      <input className="input" autoFocus placeholder="Paste in https://…" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="url-input" />
      <button className="btn btn-primary" type="submit" style={{ margin: '10px auto 0', display: 'flex', width: 240 }}>
        {label}
      </button>
    </form>
  );
}

export function BookmarkBlock({ block }: { block: Block }) {
  const { store, readOnly } = useEditor();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const c = block.content;
  const phRef = useAutoOpen(block.id, setAnchor);
  if (!c.url) {
    return (
      <>
        <div ref={phRef} className="media-placeholder" onClick={(e) => !readOnly && setAnchor(e.currentTarget)}>
          <Bookmark size={20} strokeWidth={1.6} />
          <span>Add a web bookmark</span>
        </div>
        {anchor && (
          <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-center">
            <UrlForm
              label="Create bookmark"
              onSubmit={async (url) => {
                setAnchor(null);
                store.setContent(block.id, { url });
                try {
                  const meta = await api.post('/api/link-preview', { url });
                  const cur = store.get(block.id);
                  if (cur) store.setContent(block.id, { title: meta.title || undefined, description: meta.description || undefined, image: meta.image || undefined });
                } catch {
                  /* offline: keep plain url */
                }
              }}
            />
          </Popover>
        )}
      </>
    );
  }
  let host = c.url;
  try {
    host = new URL(c.url).hostname;
  } catch {
    /* ignore */
  }
  return (
    <div>
      <a className="bookmark" href={c.url} target="_blank" rel="noreferrer">
        <div className="bookmark-text">
          <div className="bookmark-title">{c.title || host}</div>
          {c.description && <div className="bookmark-desc">{c.description}</div>}
          <div className="bookmark-url">
            <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" width={16} height={16} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            <span className="ellipsis">{c.url}</span>
          </div>
        </div>
        {c.image && (
          <div className="bookmark-image">
            <img src={c.image} alt="" onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = 'none')} />
          </div>
        )}
      </a>
      {c.caption !== undefined && (
        <InlineEditable className="caption" html={c.caption || ''} placeholder="Write a caption…" readOnly={readOnly} onChange={(h) => store.setContent(block.id, { caption: h }, 'caption:' + block.id)} />
      )}
    </div>
  );
}

export function EmbedBlock({ block }: { block: Block }) {
  const { store, readOnly } = useEditor();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const c = block.content;
  const phRef = useAutoOpen(block.id, setAnchor);
  if (!c.url) {
    return (
      <>
        <div ref={phRef} className="media-placeholder" onClick={(e) => !readOnly && setAnchor(e.currentTarget)}>
          <Globe size={20} strokeWidth={1.6} />
          <span>Add an embed</span>
        </div>
        {anchor && (
          <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-center">
            <UrlForm
              label="Embed link"
              onSubmit={(url) => {
                setAnchor(null);
                store.setContent(block.id, { url });
              }}
            />
          </Popover>
        )}
      </>
    );
  }
  const src = videoEmbedUrl(c.url) || c.url;
  return (
    <div className="embed-block">
      <iframe src={src} title="Embed" style={{ height: c.height || 400 }} sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" loading="lazy" />
      <a className="embed-link faint" href={c.url} target="_blank" rel="noreferrer">
        {c.url}
      </a>
    </div>
  );
}
