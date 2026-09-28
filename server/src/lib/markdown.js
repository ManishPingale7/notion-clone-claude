import { htmlToText } from './richtext.js';

// Converts stored blocks into Markdown (used by "Export" and copy as Markdown).

function inlineToMd(html) {
  if (!html) return '';
  let s = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(b|strong)[^>]*>(.*?)<\/\1>/gis, '**$2**')
    .replace(/<(i|em)[^>]*>(.*?)<\/\1>/gis, '*$2*')
    .replace(/<(s|del|strike)[^>]*>(.*?)<\/\1>/gis, '~~$2~~')
    .replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, '[$2]($1)');
  s = s.replace(/<span[^>]*data-type="date"[^>]*data-id="([^"]*)"[^>]*>.*?<\/span>/gis, '@$1');
  return htmlToText(s);
}

export function blocksToMarkdown(title, blocks, pageTitles = new Map()) {
  const children = new Map();
  for (const b of blocks) {
    const k = b.parentId || 'root';
    if (!children.has(k)) children.set(k, []);
    children.get(k).push(b);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position);
  const lines = [`# ${title || 'Untitled'}`, ''];
  const walk = (parentKey, depth) => {
    const list = children.get(parentKey) || [];
    let n = 0;
    for (const b of list) {
      const pad = '    '.repeat(depth);
      const c = b.content || {};
      const t = inlineToMd(c.text);
      n = b.type === 'numbered_list' ? n + 1 : 0;
      switch (b.type) {
        case 'heading_1': lines.push(`${pad}# ${t}`, ''); break;
        case 'heading_2': lines.push(`${pad}## ${t}`, ''); break;
        case 'heading_3': lines.push(`${pad}### ${t}`, ''); break;
        case 'bulleted_list': lines.push(`${pad}- ${t}`); break;
        case 'numbered_list': lines.push(`${pad}${n}. ${t}`); break;
        case 'to_do': lines.push(`${pad}- [${c.checked ? 'x' : ' '}] ${t}`); break;
        case 'toggle': lines.push(`${pad}- ${t}`); break;
        case 'quote': lines.push(`${pad}> ${t}`, ''); break;
        case 'callout': lines.push(`${pad}> ${c.icon || ''} ${t}`, ''); break;
        case 'divider': lines.push(`${pad}---`, ''); break;
        case 'code': lines.push(`${pad}\`\`\`${c.language && c.language !== 'plain text' ? c.language : ''}`, ...String(c.text || '').split('\n').map((l) => pad + l), `${pad}\`\`\``, ''); break;
        case 'image': lines.push(`${pad}![${htmlToText(c.caption || '')}](${c.url})`, ''); break;
        case 'bookmark':
        case 'embed':
        case 'video':
        case 'audio':
        case 'file': lines.push(`${pad}[${c.title || c.name || c.url}](${c.url})`, ''); break;
        case 'equation': lines.push(`${pad}$$${c.expression || ''}$$`, ''); break;
        case 'page':
        case 'child_database':
        case 'link_to_page': lines.push(`${pad}[${pageTitles.get(c.pageId) || 'Untitled'}](${c.pageId})`, ''); break;
        case 'table': {
          const rows = c.rows || [];
          rows.forEach((r, i) => {
            lines.push(pad + '| ' + r.map((cell) => inlineToMd(cell).replace(/\|/g, '\\|')).join(' | ') + ' |');
            if (i === 0) lines.push(pad + '|' + r.map(() => ' --- ').join('|') + '|');
          });
          lines.push('');
          break;
        }
        case 'text': lines.push(`${pad}${t}`, ''); break;
        default: break;
      }
      if (b.type !== 'column_list' && b.type !== 'column') walk(b.id, depth + (['bulleted_list', 'numbered_list', 'to_do', 'toggle'].includes(b.type) ? 1 : 0));
      else walk(b.id, depth);
    }
  };
  walk('root', 0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
