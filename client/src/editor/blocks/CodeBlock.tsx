import React, { useLayoutEffect, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-r';
import { ChevronDown, Copy, Check, WrapText } from 'lucide-react';
import type { Block } from '../../types';
import { useEditor } from '../context';
import { getSelectionOffsets, setCaret, caretOnEdgeLine, isCaretAtStart } from '../../lib/caret';
import { escapeHtml } from '../../lib/format';
import { Popover, MenuItem } from '../../components/ui';
import { InlineEditable } from './InlineEditable';

export const LANGUAGES: [string, string][] = [
  ['plain text', 'Plain text'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['css', 'CSS'],
  ['diff', 'Diff'], ['docker', 'Docker'], ['go', 'Go'], ['graphql', 'GraphQL'], ['markup', 'HTML'], ['java', 'Java'],
  ['javascript', 'JavaScript'], ['json', 'JSON'], ['jsx', 'JSX'], ['kotlin', 'Kotlin'], ['lua', 'Lua'], ['markdown', 'Markdown'],
  ['php', 'PHP'], ['python', 'Python'], ['r', 'R'], ['ruby', 'Ruby'], ['rust', 'Rust'], ['scss', 'SCSS'], ['sql', 'SQL'],
  ['swift', 'Swift'], ['tsx', 'TSX'], ['typescript', 'TypeScript'], ['yaml', 'YAML'],
];

function highlight(text: string, lang: string) {
  const grammar = Prism.languages[lang];
  const body = grammar ? Prism.highlight(text, grammar, lang) : escapeHtml(text);
  return body + (text.endsWith('\n') || text === '' ? '\n' : '');
}

function readText(el: HTMLElement) {
  let t = el.textContent || '';
  if (t.endsWith('\n')) t = t.slice(0, -1);
  return t;
}

export function CodeBlock({ block }: { block: Block }) {
  const ctx = useEditor();
  const { store, readOnly } = ctx;
  const ref = useRef<HTMLElement>(null);
  const [langAnchor, setLangAnchor] = useState<HTMLElement | null>(null);
  const [langQuery, setLangQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const text: string = block.content.text || '';
  const lang: string = block.content.language || 'plain text';
  const html = highlight(text, lang);

  useLayoutEffect(() => {
    const el = ref.current!;
    store.editables.set(block.id, el);
    return () => {
      if (store.editables.get(block.id) === el) store.editables.delete(block.id);
    };
  }, [block.id, store]);

  useLayoutEffect(() => {
    const el = ref.current!;
    if (el.innerHTML !== html) {
      const sel = document.activeElement === el ? getSelectionOffsets(el) : null;
      el.innerHTML = html;
      if (sel) setCaret(el, sel.start, sel.end);
    }
  }, [html]);

  const commit = () => {
    const el = ref.current!;
    const t = readText(el);
    if (t !== text) store.setContent(block.id, { text: t }, 'text:' + block.id);
    // re-highlight immediately to keep colours in sync while typing
    const sel = getSelectionOffsets(el);
    const next = highlight(t, lang);
    if (el.innerHTML !== next) {
      el.innerHTML = next;
      if (sel) setCaret(el, sel.start, sel.end);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = ref.current!;
    if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      // keep indentation of current line
      const o = getSelectionOffsets(el);
      const t = readText(el);
      const lineStart = t.lastIndexOf('\n', (o?.start ?? 0) - 1) + 1;
      const indent = t.slice(lineStart).match(/^[ \t]*/)![0];
      document.execCommand('insertText', false, '\n' + indent);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
      store.setSelected([block.id]);
      return;
    }
    if (e.key === 'Backspace' && isCaretAtStart(el) && !readText(el)) {
      e.preventDefault();
      store.transact((tx) => tx.update(block.id, { type: 'text', content: { text: '' } }), { focusAfter: { id: block.id, at: 0 } });
      return;
    }
    if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || (e.key === 'ArrowDown' && caretOnEdgeLine(el, 'last') && !e.shiftKey)) {
      const next = store.nextVisible(block.id);
      if (next) {
        e.preventDefault();
        store.requestFocus({ id: next.id, at: 'start' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        let nid = '';
        store.transact((tx) => (nid = tx.insert({ type: 'text', content: { text: '' } }, { after: block.id }).id));
        store.requestFocus({ id: nid, at: 0 });
      }
      return;
    }
    if (e.key === 'ArrowUp' && caretOnEdgeLine(el, 'first') && !e.shiftKey) {
      const prev = store.prevVisible(block.id);
      if (prev) {
        e.preventDefault();
        store.requestFocus({ id: prev.id, at: 'end' });
      }
    }
  };

  const filtered = LANGUAGES.filter(([, label]) => label.toLowerCase().includes(langQuery.toLowerCase()));
  const langLabel = LANGUAGES.find(([k]) => k === lang)?.[1] || lang;

  return (
    <div className="code-block">
      <div className="code-toolbar" contentEditable={false}>
        <button className="code-lang" onClick={(e) => !readOnly && setLangAnchor(e.currentTarget)} data-testid="code-language">
          {langLabel}
          {!readOnly && <ChevronDown size={12} />}
        </button>
        <div className="code-actions">
          {!readOnly && (
            <button className={'code-action ' + (block.content.wrap ? 'on' : '')} onClick={() => store.setContent(block.id, { wrap: !block.content.wrap })} title="Wrap code">
              <WrapText size={14} />
            </button>
          )}
          <button
            className="code-action"
            onClick={() => {
              navigator.clipboard?.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre className={'code-pre ' + (block.content.wrap ? 'wrap' : '')}>
        <code
          ref={ref}
          className={`language-${lang.replace(/\s/g, '-')}`}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          spellCheck={false}
          data-editable-id={block.id}
          onInput={commit}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
          onFocus={() => store.clearSelection()}
        />
      </pre>
      {(block.content.caption || !readOnly) && (block.content.caption !== undefined || false) && (
        <InlineEditable className="caption" html={block.content.caption || ''} placeholder="Write a caption" readOnly={readOnly} onChange={(h) => store.setContent(block.id, { caption: h }, 'caption:' + block.id)} />
      )}
      {langAnchor && (
        <Popover anchor={langAnchor} onClose={() => setLangAnchor(null)} width={220}>
          <div className="menu-search">
            <input className="input" autoFocus placeholder="Search for a language…" value={langQuery} onChange={(e) => setLangQuery(e.target.value)} />
          </div>
          <div className="menu" style={{ maxHeight: 300 }}>
            {filtered.map(([k, label]) => (
              <MenuItem
                key={k}
                label={label}
                checked={k === lang}
                onClick={() => {
                  store.setContent(block.id, { language: k });
                  setLangAnchor(null);
                  setLangQuery('');
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
