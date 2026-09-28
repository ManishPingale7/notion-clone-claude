import React, { useLayoutEffect, useRef } from 'react';
import { getSelectionOffsets, setCaret, cleanupHtml } from '../../lib/caret';
import { sanitize, escapeHtml } from '../../lib/format';

/** A small uncontrolled rich-text field (captions, table cells, comments). */
export function InlineEditable({
  html,
  onChange,
  placeholder,
  className = '',
  readOnly,
  onKeyDown,
  plain,
  autoFocus,
  testId,
  onBlur,
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  plain?: boolean;
  autoFocus?: boolean;
  testId?: string;
  onBlur?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const display = plain ? escapeHtml(html || '') : html || '';
  useLayoutEffect(() => {
    const el = ref.current!;
    if (el.innerHTML !== display) {
      const sel = document.activeElement === el ? getSelectionOffsets(el) : null;
      el.innerHTML = display;
      if (sel) setCaret(el, sel.start, sel.end);
    }
  }, [display]);
  useLayoutEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      setCaret(ref.current!, 1e9);
    }
  }, [autoFocus]);
  return (
    <div
      ref={ref}
      className={'inline-editable ' + className}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-testid={testId}
      onInput={() => {
        const el = ref.current!;
        if (el.innerHTML === '<br>') el.innerHTML = '';
        onChange(plain ? el.textContent || '' : sanitize(cleanupHtml(el.innerHTML)));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase()) && !plain) {
          e.preventDefault();
          document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline');
          onChange(sanitize(cleanupHtml(ref.current!.innerHTML)));
        }
        onKeyDown?.(e);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const t = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, t);
      }}
      onBlur={onBlur}
    />
  );
}
