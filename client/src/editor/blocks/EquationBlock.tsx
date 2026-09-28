import React, { useMemo, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Sigma } from 'lucide-react';
import type { Block } from '../../types';
import { useEditor } from '../context';
import { Popover } from '../../components/ui';
import { useAutoOpen } from './MediaBlock';

export function renderTex(expr: string, display = true) {
  try {
    return { html: katex.renderToString(expr, { displayMode: display, throwOnError: true }), error: null };
  } catch (e: any) {
    return { html: '', error: e.message as string };
  }
}

export function EquationBlock({ block }: { block: Block }) {
  const { store, readOnly } = useEditor();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(block.content.expression || '');
  const expr: string = block.content.expression || '';
  const rendered = useMemo(() => renderTex(expr), [expr]);
  const phRef = useAutoOpen(block.id, (el) => {
    setDraft(expr);
    setAnchor(el);
  });
  const open = (e: React.MouseEvent<HTMLElement>) => {
    if (readOnly) return;
    setDraft(expr);
    setAnchor(e.currentTarget);
  };
  const save = () => {
    store.setContent(block.id, { expression: draft });
    setAnchor(null);
  };
  return (
    <>
      {expr ? (
        <div className="equation-block" onClick={open}>
          {rendered.error ? <span className="eq-error">Invalid equation: {expr}</span> : <div dangerouslySetInnerHTML={{ __html: rendered.html }} />}
        </div>
      ) : (
        <div ref={phRef} className="media-placeholder" onClick={open}>
          <Sigma size={20} strokeWidth={1.6} />
          <span>Add a TeX equation</span>
        </div>
      )}
      {anchor && (
        <Popover anchor={anchor} onClose={save} placement="bottom-center">
          <div style={{ padding: 10, width: 380, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <textarea
              className="input"
              autoFocus
              style={{ fontFamily: 'var(--font-code)', fontSize: 13, minHeight: 60 }}
              value={draft}
              placeholder="E = mc^2"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <button className="btn btn-primary" onClick={save}>
              Done ↵
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}
