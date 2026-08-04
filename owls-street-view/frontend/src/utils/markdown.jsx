/**
 * Markdown renderer for Owl Speaks answers.
 *
 * Returns React elements rather than an HTML string. The previous renderer was a chain of
 * regex replacements feeding `dangerouslySetInnerHTML`, which had two problems:
 *
 *  - It could not see block structure. `---` was rewritten to `<hr>` everywhere, including
 *    inside a table's `|-----|-----|` separator, and then every newline became `<br>`. A
 *    table came out as a handful of stray pipes and dashes on separate lines. Headings,
 *    ordered lists and tables were not supported at all.
 *  - Building HTML from model output meant the only thing standing between a response and
 *    script injection was one entity-escaping pass at the top.
 *
 * Parsing blocks first, then inline spans within them, fixes the structural problems; going
 * through React removes the injection surface, since text nodes are never parsed as HTML.
 *
 * Styling lives in markdown.css against theme variables, so it follows light and dark mode.
 */
import React from 'react';

/** Inline: `code`, **bold**, *italic*, [text](url). Applied to leaf text only. */
function renderInline(text, keyPrefix = 'i') {
  const nodes = [];
  // One pass, alternating on whichever marker comes first, so a ** run is never split by
  // the single-* rule — the bug that let an italic span swallow two bullet lines.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let match;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;

    if (token.startsWith('`')) {
      nodes.push(<code key={key} className="md-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      const safe = /^(https?:|mailto:)/i.test(href) ? href : undefined;
      nodes.push(
        safe
          ? <a key={key} href={safe} target="_blank" rel="noopener noreferrer" className="md-link">{label}</a>
          : <span key={key}>{label}</span>
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = pattern.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}

const isTableSeparator = (line) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
const isHorizontalRule = (line) => /^\s*([-*_])\1{2,}\s*$/.test(line.trim());
const splitRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

/** Column alignment from a separator row: |:--|--:|:-:| */
function columnAlignments(separator) {
  return splitRow(separator).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return undefined;
  });
}

export default function renderMarkdown(text) {
  if (!text) return null;

  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — block separator.
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code. Consume to the closing fence, or to the end if it never closes, so an
    // unterminated fence degrades to a code block rather than eating the rest as prose.
    const fence = line.match(/^\s*```+\s*([a-zA-Z0-9+#-]*)\s*$/);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push(
        <pre key={key++} className="md-pre">
          <code>{body.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Table: a pipe row followed by a separator row. Checked before the horizontal-rule and
    // paragraph rules, which is what the old renderer got wrong.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const align = columnAlignments(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        // Wrapped so a wide table scrolls inside the bubble instead of stretching it.
        <div key={key++} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th key={c} style={{ textAlign: align[c] }}>{renderInline(cell, `th${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {header.map((_, c) => (
                    <td key={c} style={{ textAlign: align[c] }}>{renderInline(row[c] ?? '', `td${r}${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Horizontal rule — only a line that is nothing but rule characters.
    if (isHorizontalRule(line)) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i += 1;
      continue;
    }

    // ATX heading.
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      // Headings inside a chat bubble should read as emphasis, not page structure, so they
      // are rendered at a consistent size and separated by class rather than by <h1>-<h6>
      // scale. The tag still carries the right level for assistive tech.
      const Tag = `h${level}`;
      blocks.push(
        <Tag key={key++} className={`md-h md-h${level}`}>
          {renderInline(heading[2].replace(/\s*:?\s*$/, ''), `h${key}`)}
        </Tag>
      );
      i += 1;
      continue;
    }

    // Blockquote.
    if (/^\s*>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={key++} className="md-quote">{renderInline(body.join(' '), `q${key}`)}</blockquote>
      );
      continue;
    }

    // Lists. Consecutive items collapse into one list — the old renderer gave every bullet
    // its own <ul>, which is where the ragged vertical gaps came from.
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items = [];
      while (i < lines.length) {
        const b = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
        const n = lines[i].match(/^(\s*)(\d+)[.)]\s+(.*)$/);
        if (!b && !n) {
          // A plain indented line continues the previous item rather than starting a block.
          if (items.length && /^\s{2,}\S/.test(lines[i]) && lines[i].trim()) {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        if (Boolean(n) !== ordered) break; // a different list type starts a new block
        items.push((b ? b[2] : n[3]));
        i += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      const start = ordered ? Number(numbered[2]) : undefined;
      blocks.push(
        <Tag key={key++} className="md-list" start={start !== 1 ? start : undefined}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li${idx}`)}</li>
          ))}
        </Tag>
      );
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const para = [];
    while (i < lines.length && lines[i].trim()) {
      const next = lines[i];
      const startsBlock =
        /^\s*(#{1,6})\s+/.test(next) ||
        /^\s*```+/.test(next) ||
        /^\s*>\s?/.test(next) ||
        /^(\s*)[-*+]\s+/.test(next) ||
        /^(\s*)\d+[.)]\s+/.test(next) ||
        isHorizontalRule(next) ||
        (next.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]));
      if (para.length && startsBlock) break;
      para.push(next.trim());
      i += 1;
    }
    if (para.length) {
      blocks.push(<p key={key++} className="md-p">{renderInline(para.join(' '), `p${key}`)}</p>);
    }
  }

  return <div className="md">{blocks}</div>;
}
