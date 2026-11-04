import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

interface AiResponseRendererProps {
  text: string;
  isError?: boolean;
  showStatusBanner?: boolean;
  intentLabel?: string;
}

type ParsedBlock =
  | { type: 'heading'; level: 1 | 2 | 3; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'divider' }
  | { type: 'callout'; tone: 'missing' | 'error'; content: string }
  | { type: 'paragraph'; content: string };

const UNMATCHED_RESPONSE_PATTERNS = [
  /no matching .* found/i,
  /could not find any/i,
  /no records? found/i,
  /no .* (were )?recorded in/i,
  /not recorded in the school database/i,
  /no student record found/i,
  /no teacher record found/i,
  /no admissions? (were )?found/i,
  /0 admissions/i,
  /please specify which (student|teacher|class|child)/i,
];

const MISSING_PATTERNS = [
  ...UNMATCHED_RESPONSE_PATTERNS,
  /not available in (the )?database/i,
];

export function classifyAiResponseTone(
  text: string,
  isError?: boolean
): 'error' | 'missing' | 'verified' {
  if (isError || /^\s*(error:|⚠️\s*error|system error|unable to process)/i.test(text)) {
    return 'error';
  }
  const trimmed = text.trim();
  if (
    UNMATCHED_RESPONSE_PATTERNS.some(rx => rx.test(trimmed)) ||
    (trimmed.length < 180 && /not available in (the )?database/i.test(trimmed))
  ) {
    return 'missing';
  }
  return 'verified';
}

function isNumericCell(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  return /^(PKR\s*)?[-+]?[\d,]+(\.\d+)?%?(\s*\/\s*[\d,]+(\.\d+)?)?$/i.test(trimmed);
}

function parseInlineSegments(line: string): React.ReactNode {
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|Not available in (?:the )?database\.?)/gi;
  const parts = line.split(tokenRegex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-neutral-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 font-mono text-[11px] text-emerald-950"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^not available in (the )?database\.?$/i.test(part)) {
      return (
        <span key={idx} className="italic text-amber-800 font-medium">
          {part}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function splitTableRow(raw: string): string[] {
  const trimmed = raw.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cell => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c.trim()));
}

function parseMarkdownBlocks(rawText: string): ParsedBlock[] {
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal divider
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'heading', level: 3, content: trimmed.slice(4).trim() });
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'heading', level: 2, content: trimmed.slice(3).trim() });
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'heading', level: 1, content: trimmed.slice(2).trim() });
      i++;
      continue;
    }

    // Markdown pipe table block
    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().includes('|', 1)) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const parsedRows = tableLines.map(splitTableRow);
        const headers = parsedRows[0];
        const bodyStartIndex = isSeparatorRow(parsedRows[1]) ? 2 : 1;
        const rows = parsedRows
          .slice(bodyStartIndex)
          .filter(r => !isSeparatorRow(r) && r.some(cell => cell.length > 0));

        if (headers.length > 0) {
          blocks.push({ type: 'table', headers, rows });
          continue;
        }
      }
      // Fallback if single pipe line
      tableLines.forEach(tl => blocks.push({ type: 'paragraph', content: tl }));
      continue;
    }

    // Unordered list block
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list block
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Missing-data single-line callout
    if (MISSING_PATTERNS.some(rx => rx.test(trimmed)) && trimmed.length < 220) {
      blocks.push({ type: 'callout', tone: 'missing', content: trimmed });
      i++;
      continue;
    }

    blocks.push({ type: 'paragraph', content: trimmed });
    i++;
  }

  return blocks;
}

export const AiResponseRenderer: React.FC<AiResponseRendererProps> = ({
  text,
  isError = false,
  showStatusBanner = false,
  intentLabel,
}) => {
  const tone = classifyAiResponseTone(text, isError);
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="space-y-2.5 text-xs sm:text-[13px] leading-relaxed text-neutral-800 break-words">
      {showStatusBanner && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-medium ${
            tone === 'error'
              ? 'bg-rose-50/80 border-rose-200 text-rose-800'
              : tone === 'missing'
              ? 'bg-amber-50/80 border-amber-200 text-amber-900'
              : 'bg-emerald-50/70 border-emerald-200/80 text-emerald-900'
          }`}
        >
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {tone === 'error' ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>Request Error</span>
              </>
            ) : tone === 'missing' ? (
              <>
                <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>Missing or Unmatched Database Record</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>Verified School Database Result</span>
              </>
            )}
          </span>
          {intentLabel && (
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
              {intentLabel.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      )}

      {blocks.map((block, idx) => {
        if (block.type === 'divider') {
          return <hr key={idx} className="border-neutral-200 my-2" />;
        }

        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h3
                key={idx}
                className="text-sm sm:text-base font-bold text-neutral-950 pt-1 pb-1 border-b border-neutral-200"
              >
                {parseInlineSegments(block.content)}
              </h3>
            );
          }
          if (block.level === 2) {
            return (
              <h4
                key={idx}
                className="text-xs sm:text-sm font-bold text-emerald-950 pt-1.5 flex items-center gap-1.5"
              >
                {parseInlineSegments(block.content)}
              </h4>
            );
          }
          return (
            <h5
              key={idx}
              className="text-[11px] font-bold uppercase tracking-wider text-neutral-600 pt-1"
            >
              {parseInlineSegments(block.content)}
            </h5>
          );
        }

        if (block.type === 'table') {
          return (
            <div
              key={idx}
              className="my-2 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-2xs"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-700">
                  <tr>
                    {block.headers.map((header, hIdx) => (
                      <th
                        key={hIdx}
                        scope="col"
                        className="py-2.5 px-3 font-semibold whitespace-nowrap text-[11px] uppercase tracking-wider"
                      >
                        {parseInlineSegments(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-neutral-50/80 transition-colors">
                      {block.headers.map((_, cIdx) => {
                        const cellVal = row[cIdx] ?? '';
                        const numeric = isNumericCell(cellVal);
                        return (
                          <td
                            key={cIdx}
                            className={`py-2 px-3 align-top ${
                              numeric
                                ? 'font-mono tabular-nums whitespace-nowrap text-neutral-900 font-medium'
                                : 'text-neutral-700'
                            }`}
                          >
                            {parseInlineSegments(cellVal)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={idx}
              className={`space-y-1.5 pl-4 ${
                block.ordered ? 'list-decimal marker:text-neutral-500 marker:font-mono' : 'list-disc marker:text-emerald-700'
              }`}
            >
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="pl-1 text-neutral-800 leading-relaxed">
                  {parseInlineSegments(item)}
                </li>
              ))}
            </ListTag>
          );
        }

        if (block.type === 'callout') {
          return (
            <div
              key={idx}
              className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-950 flex items-start gap-2"
            >
              <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>{parseInlineSegments(block.content)}</span>
            </div>
          );
        }

        return (
          <p key={idx} className="text-neutral-800 leading-relaxed">
            {parseInlineSegments(block.content)}
          </p>
        );
      })}
    </div>
  );
};
