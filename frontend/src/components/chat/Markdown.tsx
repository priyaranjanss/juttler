import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  content: string;
  isDark?: boolean;
}

/**
 * Renders AI chat replies as formatted markdown — headings, lists, tables,
 * code blocks, links, and inline emphasis — instead of raw source text.
 * User-entered text is left untouched (rendered as pre-wrapped text).
 */
export const Markdown: React.FC<MarkdownProps> = ({ content, isDark = false }) => {
  const components: Components = {
    p: ({ children }) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>,

    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="opacity-60">{children}</del>,

    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#1d9bf0] underline underline-offset-2 hover:opacity-80 transition"
      >
        {children}
      </a>
    ),

    code: ({ className, children, node }) => {
      // A fenced code block always spans more than one source line; inline code
      // is a single line. (A language hint alone isn't enough — plain fences
      // come without one.)
      const spansLines = node?.position
        ? node.position.start.line !== node.position.end.line
        : false;

      if (spansLines) {
        return <code className="block font-mono text-[11px] leading-relaxed bg-transparent p-0">{children}</code>;
      }
      return (
        <code
          className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
            isDark ? 'bg-[#202327] text-[#e7e9ea]' : 'bg-[#eff3f4] text-[#0f1419]'
          }`}
        >
          {children}
        </code>
      );
    },

    pre: ({ children }) => (
      <pre
        className={`my-2 overflow-x-auto rounded-lg border p-3 no-scrollbar ${
          isDark ? 'border-[#26292d] bg-black text-[#e7e9ea]' : 'border-[#e5e7eb] bg-[#f7f9f9] text-[#0f1419]'
        }`}
      >
        {children}
      </pre>
    ),

    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,

    h1: ({ children }) => <h1 className="mb-1.5 mt-2.5 text-base font-extrabold first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-1.5 mt-2.5 text-sm font-extrabold first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1 mt-2 text-xs font-bold first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mb-1 mt-2 text-xs font-bold opacity-80 first:mt-0">{children}</h4>,

    blockquote: ({ children }) => (
      <blockquote
        className={`my-2 border-l-2 pl-3 italic opacity-85 ${
          isDark ? 'border-[#2f3336]' : 'border-[#cfd9de]'
        }`}
      >
        {children}
      </blockquote>
    ),

    hr: () => <hr className={`my-3 border-0 border-t ${isDark ? 'border-[#26292d]' : 'border-[#e5e7eb]'}`} />,

    table: ({ children }) => (
      <div className="my-2 overflow-x-auto no-scrollbar">
        <table className={`w-full border-collapse text-[11px] ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className={isDark ? 'bg-[#202327]' : 'bg-[#f0f2f5]'}>{children}</thead>
    ),
    th: ({ children }) => (
      <th className={`border px-2 py-1.5 text-left font-bold ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className={`border px-2 py-1.5 ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>{children}</td>
    ),
  };

  return (
    <div className="text-xs sm:text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;