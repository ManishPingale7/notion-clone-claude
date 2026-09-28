import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Block } from '../../types';
import { useEditor } from '../context';
import { InlineEditable } from './InlineEditable';
import { Popover, MenuItem } from '../../components/ui';

/** Notion's "simple table" block: a grid of rich-text cells. */
export function TableBlock({ block }: { block: Block }) {
  const { store, readOnly } = useEditor();
  const rows: string[][] = block.content.rows || [['']];
  const [menu, setMenu] = useState<{ x: number; y: number; r: number; c: number } | null>(null);
  const width = rows[0]?.length || 1;

  const update = (next: string[][], extra: Record<string, any> = {}) => store.setContent(block.id, { rows: next, ...extra });
  const setCell = (r: number, c: number, html: string) => {
    const cur = (store.get(block.id)?.content.rows as string[][]) || rows;
    const next = cur.map((row) => [...row]);
    next[r][c] = html;
    store.setContent(block.id, { rows: next }, 'cell:' + block.id);
  };
  const addRow = (at = rows.length) => update([...rows.slice(0, at), Array(width).fill(''), ...rows.slice(at)]);
  const addCol = (at = width) => update(rows.map((row) => [...row.slice(0, at), '', ...row.slice(at)]));
  const delRow = (r: number) => rows.length > 1 && update(rows.filter((_, i) => i !== r));
  const delCol = (c: number) => width > 1 && update(rows.map((row) => row.filter((_, i) => i !== c)));

  const focusCell = (r: number, c: number) => {
    const el = document.querySelector(`[data-block-id="${block.id}"] [data-cell="${r}-${c}"] .inline-editable`) as HTMLElement | null;
    el?.focus();
  };

  return (
    <div className="simple-table-wrap">
      <div className="simple-table-scroll">
        <table className={'simple-table ' + (block.content.headerRow ? 'header-row ' : '') + (block.content.headerCol ? 'header-col' : '')}>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    data-cell={`${r}-${c}`}
                    onContextMenu={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, r, c });
                    }}
                  >
                    <InlineEditable
                      html={cell}
                      readOnly={readOnly}
                      onChange={(h) => setCell(r, c, h)}
                      onKeyDown={(e) => {
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          const idx = r * width + c + (e.shiftKey ? -1 : 1);
                          if (idx >= rows.length * width) {
                            addRow();
                            setTimeout(() => focusCell(r + 1, 0), 30);
                          } else if (idx >= 0) focusCell(Math.floor(idx / width), idx % width);
                        } else if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (r + 1 < rows.length) focusCell(r + 1, c);
                        } else if (e.key === 'ArrowDown' && r + 1 < rows.length) {
                          e.preventDefault();
                          focusCell(r + 1, c);
                        } else if (e.key === 'ArrowUp' && r > 0) {
                          e.preventDefault();
                          focusCell(r - 1, c);
                        }
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <button className="table-add-col" onClick={() => addCol()} title="Add column" data-testid="table-add-col">
            <Plus size={14} />
          </button>
        )}
      </div>
      {!readOnly && (
        <button className="table-add-row" onClick={() => addRow()} title="Add row" data-testid="table-add-row">
          <Plus size={14} />
        </button>
      )}
      {menu && (
        <Popover anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)}>
          <div className="menu">
            <MenuItem label="Insert row above" onClick={() => (addRow(menu.r), setMenu(null))} />
            <MenuItem label="Insert row below" onClick={() => (addRow(menu.r + 1), setMenu(null))} />
            <MenuItem label="Insert column left" onClick={() => (addCol(menu.c), setMenu(null))} />
            <MenuItem label="Insert column right" onClick={() => (addCol(menu.c + 1), setMenu(null))} />
            <div className="menu-divider" />
            <MenuItem label="Header row" checked={!!block.content.headerRow} onClick={() => (update(rows, { headerRow: !block.content.headerRow }), setMenu(null))} />
            <MenuItem label="Header column" checked={!!block.content.headerCol} onClick={() => (update(rows, { headerCol: !block.content.headerCol }), setMenu(null))} />
            <div className="menu-divider" />
            <MenuItem label="Delete row" danger disabled={rows.length <= 1} onClick={() => (delRow(menu.r), setMenu(null))} />
            <MenuItem label="Delete column" danger disabled={width <= 1} onClick={() => (delCol(menu.c), setMenu(null))} />
          </div>
        </Popover>
      )}
    </div>
  );
}
