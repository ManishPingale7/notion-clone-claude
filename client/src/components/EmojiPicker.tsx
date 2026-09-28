import React, { useMemo, useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import groups from 'unicode-emoji-json/data-by-group.json';
import { api } from '../api';
import { useApp } from '../store';

interface E {
  emoji: string;
  name: string;
  emoji_version: string;
}
const GROUPS = (groups as unknown as { name: string; emojis: E[] }[]).map((g) => ({
  name: g.name === 'Smileys & Emotion' ? 'People' : g.name,
  emojis: g.emojis.filter((e) => parseFloat(e.emoji_version) <= 14),
}));
const ALL = GROUPS.flatMap((g) => g.emojis);

function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem('recentEmoji') || '[]');
  } catch {
    return [];
  }
}
function pushRecent(e: string) {
  try {
    localStorage.setItem('recentEmoji', JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 24)));
  } catch {
    /* ignore */
  }
}

export function randomEmoji() {
  const pool = GROUPS.filter((g) => ['People', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects'].includes(g.name)).flatMap((g) => g.emojis);
  return pool[Math.floor(Math.random() * pool.length)].emoji;
}

export function EmojiPicker({ onPick, onRemove, allowUpload = true }: { onPick: (emoji: string) => void; onRemove?: () => void; allowUpload?: boolean }) {
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<E | null>(null);
  const [link, setLink] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);
  const pick = (e: string) => {
    pushRecent(e);
    onPick(e);
  };
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return ALL.filter((e) => e.name.includes(s)).slice(0, 300);
  }, [q]);
  const rec = recent();
  return (
    <div className="emoji-picker" data-testid="emoji-picker">
      <div className="ep-tabs">
        <button className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>
          Emoji
        </button>
        {allowUpload && (
          <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>
            Upload
          </button>
        )}
        <div style={{ flex: 1 }} />
        {onRemove && (
          <button className="ep-remove" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {tab === 'emoji' ? (
        <>
          <div className="ep-search">
            <input className="input" autoFocus placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="icon-btn ep-random" title="Random" onClick={() => pick(randomEmoji())}>
              <Shuffle size={16} />
            </button>
          </div>
          <div className="ep-scroll">
            {filtered ? (
              <div className="ep-grid">
                {filtered.map((e) => (
                  <button key={e.emoji} className="ep-cell" onClick={() => pick(e.emoji)} onMouseEnter={() => setHover(e)} title={e.name}>
                    {e.emoji}
                  </button>
                ))}
                {!filtered.length && <div className="faint" style={{ padding: 12 }}>No results</div>}
              </div>
            ) : (
              <>
                {rec.length > 0 && (
                  <>
                    <div className="ep-group">Recent</div>
                    <div className="ep-grid">
                      {rec.map((e) => (
                        <button key={e} className="ep-cell" onClick={() => pick(e)}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {GROUPS.map((g) => (
                  <React.Fragment key={g.name}>
                    <div className="ep-group">{g.name}</div>
                    <div className="ep-grid">
                      {g.emojis.map((e) => (
                        <button key={e.emoji} className="ep-cell" onClick={() => pick(e.emoji)} onMouseEnter={() => setHover(e)}>
                          {e.emoji}
                        </button>
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
          <div className="ep-footer">
            {hover ? (
              <>
                <span style={{ fontSize: 22 }}>{hover.emoji}</span>
                <span className="muted">{hover.name}</span>
              </>
            ) : (
              <span className="faint">Pick an emoji</span>
            )}
          </div>
        </>
      ) : (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn-outline btn-block" onClick={() => fileRef.current?.click()}>
            Upload an image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const r = await api.upload(f);
                onPick(r.url);
              } catch (err: any) {
                toast(err.message, { kind: 'error' });
              }
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (/^https?:\/\//.test(link)) onPick(link);
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input className="input" placeholder="Paste link to an image…" value={link} onChange={(e) => setLink(e.target.value)} />
            <button className="btn btn-primary" type="submit">
              Submit
            </button>
          </form>
          <div className="faint" style={{ fontSize: 12, textAlign: 'center' }}>Recommended size is 280 × 280 pixels</div>
        </div>
      )}
    </div>
  );
}
