import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Video, Music, Paperclip, ExternalLink, RefreshCw, MessageSquareText } from 'lucide-react';
import type { Block } from '../../types';
import { useEditor } from '../context';
import { api } from '../../api';
import { useApp } from '../../store';
import { Popover } from '../../components/ui';
import { InlineEditable } from './InlineEditable';
import { fileSize } from '../../lib/format';

const LABELS: Record<string, { add: string; icon: React.ReactNode; accept: string; embed: string }> = {
  image: { add: 'Add an image', icon: <ImageIcon size={20} strokeWidth={1.6} />, accept: 'image/*', embed: 'Embed image' },
  video: { add: 'Embed or upload a video', icon: <Video size={20} strokeWidth={1.6} />, accept: 'video/*', embed: 'Embed video' },
  audio: { add: 'Add an audio file', icon: <Music size={20} strokeWidth={1.6} />, accept: 'audio/*', embed: 'Embed audio' },
  file: { add: 'Upload or embed a file', icon: <Paperclip size={20} strokeWidth={1.6} />, accept: '*/*', embed: 'Embed file' },
};

export function videoEmbedUrl(url: string): string | null {
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  m = url.match(/loom\.com\/share\/(\w+)/);
  if (m) return `https://www.loom.com/embed/${m[1]}`;
  return null;
}

export function MediaUploader({ kind, onDone, onClose }: { kind: string; onDone: (c: Record<string, any>) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'upload' | 'link'>('upload');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);
  const L = LABELS[kind] || LABELS.file;
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const r = await api.upload(file);
      onDone({ url: r.url, name: r.name, size: r.size });
    } catch (e: any) {
      toast(e.message || 'Upload failed', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="media-uploader" style={{ width: 540, maxWidth: 'calc(100vw - 40px)' }}>
      <div className="tabs">
        <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>Upload</button>
        <button className={tab === 'link' ? 'on' : ''} onClick={() => setTab('link')}>Embed link</button>
      </div>
      <div style={{ padding: 12 }}>
        {tab === 'upload' ? (
          <>
            <button className="btn btn-outline btn-block" style={{ height: 32 }} disabled={busy} onClick={() => fileRef.current?.click()} data-testid="upload-button">
              {busy ? 'Uploading…' : 'Upload file'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={L.accept}
              hidden
              data-testid="upload-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <div className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>The maximum size per file is 20 MB.</div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) onDone({ url: url.trim() });
            }}
          >
            <input className="input" autoFocus placeholder="Paste in https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-primary" style={{ margin: '10px auto 0', display: 'flex', width: 240 }} type="submit">
              {L.embed}
            </button>
            <div className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>Works with any link on the web</div>
          </form>
        )}
      </div>
      <button className="hidden" onClick={onClose} />
    </div>
  );
}

export function MediaBlock({ block }: { block: Block }) {
  const { store, readOnly } = useEditor();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [resizing, setResizing] = useState<number | null>(null);
  const c = block.content;
  const L = LABELS[block.type] || LABELS.file;
  const phRef = useAutoOpen(block.id, setAnchor);

  if (!c.url) {
    return (
      <>
        <div ref={phRef} className="media-placeholder" onClick={(e) => !readOnly && setAnchor(e.currentTarget)} data-testid="media-placeholder">
          {L.icon}
          <span>{L.add}</span>
        </div>
        {anchor && (
          <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-center">
            <MediaUploader
              kind={block.type}
              onClose={() => setAnchor(null)}
              onDone={(content) => {
                store.setContent(block.id, content);
                setAnchor(null);
              }}
            />
          </Popover>
        )}
      </>
    );
  }

  const caption =
    c.caption !== undefined || c.showCaption ? (
      <InlineEditable className="caption" html={c.caption || ''} placeholder="Write a caption…" readOnly={readOnly} onChange={(h) => store.setContent(block.id, { caption: h }, 'caption:' + block.id)} />
    ) : null;

  const startResize = (e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    const fig = (e.currentTarget as HTMLElement).closest('.media-frame') as HTMLElement;
    const startW = fig.getBoundingClientRect().width;
    const startX = e.clientX;
    const maxW = (fig.closest('.block-content') as HTMLElement).getBoundingClientRect().width;
    let w = startW;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) * (side === 'right' ? 2 : -2);
      w = Math.max(80, Math.min(maxW, startW + dx));
      setResizing(w);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setResizing(null);
      store.setContent(block.id, { width: Math.round(w) });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const overlay = !readOnly && (
    <div className="media-overlay" contentEditable={false}>
      <button title="Caption" onClick={() => store.setContent(block.id, { caption: c.caption || ' ' })}>
        <MessageSquareText size={14} />
      </button>
      <button title="Replace" onClick={(e) => setAnchor(e.currentTarget)}>
        <RefreshCw size={14} />
      </button>
      <a title="Original" href={c.url} target="_blank" rel="noreferrer">
        <ExternalLink size={14} />
      </a>
    </div>
  );

  const replacePopover = anchor && (
    <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-end">
      <MediaUploader
        kind={block.type}
        onClose={() => setAnchor(null)}
        onDone={(content) => {
          store.setContent(block.id, { ...content, caption: c.caption });
          setAnchor(null);
        }}
      />
    </Popover>
  );

  if (block.type === 'image') {
    const width = resizing ?? c.width;
    return (
      <figure className="media-figure" style={{ alignItems: c.align === 'left' ? 'flex-start' : 'center' }}>
        <div className="media-frame" style={{ width: width ? width : undefined, maxWidth: '100%' }} onClick={() => store.setSelected([block.id])}>
          <img src={c.url} alt={c.name || ''} draggable={false} />
          {!readOnly && (
            <>
              <div className="resize-handle left" onMouseDown={(e) => startResize(e, 'left')} />
              <div className="resize-handle right" onMouseDown={(e) => startResize(e, 'right')} />
            </>
          )}
          {overlay}
        </div>
        {caption}
        {replacePopover}
      </figure>
    );
  }
  if (block.type === 'video') {
    const embed = videoEmbedUrl(c.url);
    return (
      <figure className="media-figure">
        <div className="media-frame video" style={{ width: '100%' }}>
          {embed ? (
            <iframe src={embed} title="Video" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" />
          ) : (
            <video src={c.url} controls preload="metadata" />
          )}
          {overlay}
        </div>
        {caption}
        {replacePopover}
      </figure>
    );
  }
  if (block.type === 'audio') {
    return (
      <figure className="media-figure">
        <div className="media-frame" style={{ width: '100%' }}>
          <audio src={c.url} controls preload="metadata" style={{ width: '100%' }} />
        </div>
        {caption}
        {replacePopover}
      </figure>
    );
  }
  const name = c.name || decodeURIComponent(c.url.split('/').pop() || 'File');
  return (
    <div>
      <a className="file-block" href={c.url} target="_blank" rel="noreferrer" download={c.url.startsWith('/uploads/') ? name : undefined}>
        <Paperclip size={16} strokeWidth={1.6} />
        <span className="file-name">{name}</span>
        {c.size ? <span className="faint" style={{ fontSize: 12 }}>{fileSize(c.size)}</span> : null}
      </a>
      {caption}
    </div>
  );
}

/** Opens a block's picker popover right after it was inserted from the slash menu. */
export function useAutoOpen(blockId: string, open: (el: HTMLElement) => void) {
  const { store } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (store.autoOpen === blockId && ref.current) {
      store.autoOpen = null;
      open(ref.current);
    }
  });
  return ref;
}
