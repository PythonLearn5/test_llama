/**
 * HTML table → Markdown table converter.
 *
 * Supports:
 *   - <th>/<td> text extraction (strips all inline tags with textContent)
 *   - colspan / rowspan spanning cells
 *   - <thead>/<tbody>/<tfoot> semantic groupings (thead → Markdown header row)
 *
 * Used to convert MinerU's raw HTML table output into compact Markdown tables
 * so SentenceSplitter can keep them intact and the LLM can format answers easily.
 */
export function htmlTableToMarkdown(html: string): string {
  if (!/<table/i.test(html)) return html;

  // Find and replace each <table>...</table> block in order (non-greedy)
  let out = "";
  let rest = html;
  while (true) {
    const start = searchTag(rest, "table", true);
    if (start === -1) { out += rest; break; }
    out += rest.slice(0, start);
    const end = findClosingTable(rest, start);
    const tableHtml = rest.slice(start, end);
    rest = rest.slice(end);
    const md = convertOneTable(tableHtml);
    out += "\n\n" + md + "\n\n";
  }
  return out;
}

// Locate <table ...> start offset (accounting for attributes).
// Returns offset of the '<' char.
function searchTag(s: string, tag: string, openOnly = false): number {
  const re = new RegExp(`<${openOnly ? '' : '/?'}\\s*${tag}[\\s>]`, "i");
  const m = s.match(re);
  return m ? (m.index ?? -1) : -1;
}

function findClosingTable(s: string, openStart: number): number {
  // Find `<` of the opening <table
  let depth = 0;
  let i = openStart;
  while (i < s.length) {
    if (s[i] !== "<") { i++; continue; }
    const tagMatch = s.slice(i).match(/^<\s*(\/?)\s*table[\s>]/i);
    if (tagMatch) {
      const isClose = tagMatch[1] === "/";
      if (isClose) {
        depth--;
        if (depth === 0) {
          // return index after closing `</table ...>`
          const endAngle = s.indexOf(">", i);
          return endAngle === -1 ? s.length : endAngle + 1;
        }
      } else {
        depth++;
      }
      const nextLt = s.indexOf(">", i);
      i = (nextLt === -1 ? s.length : nextLt + 1);
    } else {
      i++;
    }
  }
  return s.length;
}

// Parse rows inside <table>...</table>
interface Cell { text: string; colspan: number; rowspan: number; consumed?: boolean }

function convertOneTable(tableHtml: string): string {
  // Extract all <tr> blocks
  const rows: string[] = [];
  let rest = tableHtml;
  while (true) {
    const o = searchTr(rest, true);
    if (o === -1) break;
    const c = findClosingTr(rest, o);
    rows.push(rest.slice(o, c));
    rest = rest.slice(c);
  }
  if (rows.length === 0) return tableHtml;

  const grid: (Cell | null)[][] = [];
  let maxCols = 0;

  for (let r = 0; r < rows.length; r++) {
    grid[r] = grid[r] || [];
    const rowHtml = rows[r];
    const cells = extractCells(rowHtml);
    let colIdx = 0;
    for (const cell of cells) {
      // Skip slots carried over from rowspan above
      while (grid[r][colIdx]) colIdx++;
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          // The cell itself (first slot) is the "real" one; the rest are placeholders (consumed)
          grid[r + dr][colIdx + dc] = (dr === 0 && dc === 0) ? cell : { ...cell, consumed: true };
        }
      }
      colIdx += cell.colspan;
    }
    maxCols = Math.max(maxCols, colIdx);
  }

  // Determine header row: if first row contains any `<th` use that; else first row (no header).
  const hasThead = /<th[\s>]/i.test(rows[0]);
  const headerRow = hasThead ? 0 : -1;

  // Build Markdown lines
  const lines: string[] = [];
  for (let r = 0; r < grid.length; r++) {
    const rowCells: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const cell = grid[r]?.[c];
      // Span placeholders — skip (the first cell above/left already rendered its text for merged cells,
      // but for Markdown we still need a real cell in every slot for alignment).
      // Use same text (safe repetition for rowspan/colspan) — rowspan cells inherit text so content isn't lost.
      if (cell) {
        rowCells.push(cell.text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim());
      } else {
        rowCells.push("");
      }
    }
    lines.push("| " + rowCells.join(" | ") + " |");
    if (r === headerRow) {
      lines.push("|" + rowCells.map(() => "---").join("|") + "|");
    }
  }
  return lines.join("\n");
}

function searchTr(s: string, _openOnly: boolean): number {
  const m = s.match(/<\s*tr[\s>]/i);
  return m ? (m.index ?? -1) : -1;
}
function findClosingTr(s: string, openStart: number): number {
  let depth = 0;
  let i = openStart;
  while (i < s.length) {
    if (s[i] !== "<") { i++; continue; }
    const tagMatch = s.slice(i).match(/^<\s*(\/?)\s*tr[\s>]/i);
    if (tagMatch) {
      const isClose = tagMatch[1] === "/";
      if (isClose) {
        depth--;
        if (depth === 0) {
          const endAngle = s.indexOf(">", i);
          return endAngle === -1 ? s.length : endAngle + 1;
        }
      } else {
        depth++;
      }
      const nextLt = s.indexOf(">", i);
      i = (nextLt === -1 ? s.length : nextLt + 1);
    } else {
      i++;
    }
  }
  return s.length;
}

function extractCells(rowHtml: string): Cell[] {
  const cells: Cell[] = [];
  let rest = rowHtml;
  while (true) {
    const m = rest.match(/<\s*(td|th)[\s>]/i);
    if (!m) break;
    const openOffset = m.index as number;
    // find matching </td|/th>
    const tagName = (m[1] || "td").toLowerCase();
    // parse attrs from <td ...> before >
    const attrsStart = openOffset;
    const openEnd = rest.indexOf(">", attrsStart);
    if (openEnd === -1) break;
    const attrStr = rest.slice(attrsStart, openEnd + 1);
    const colspan = parseInt((attrStr.match(/\scolspan\s*=\s*["']?(\d+)/i) || [])[1] || "1", 10) || 1;
    const rowspan = parseInt((attrStr.match(/\srowspan\s*=\s*["']?(\d+)/i) || [])[1] || "1", 10) || 1;
    // find closing </tagname>
    const closeRe = new RegExp(`<\\s*\\/\\s*${tagName}[\\s>]`, "i");
    const closeMatch = rest.slice(openEnd).match(closeRe);
    const closeOffset = closeMatch ? (openEnd + (closeMatch.index as number)) : rest.length;
    const inner = rest.slice(openEnd + 1, closeOffset);
    const text = stripTags(inner);
    cells.push({ text, colspan, rowspan });
    rest = rest.slice(closeOffset + 1);
  }
  return cells;
}

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/p\s*>/gi, " ")
    .replace(/<\/div\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, `"`)
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
