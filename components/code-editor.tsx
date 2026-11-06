"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CodeHighlighter } from "@/lib/code-highlighter";

type CodeEditorProps = {
  value: string;
  language: string;
  editing: boolean;
  onChange: (value: string) => void;
  onFinish: () => void;
  onRun?: () => void;
};

export function CodeEditor({
  value,
  language,
  editing,
  onChange,
  onFinish,
  onRun,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const [highlighter, setHighlighter] = useState<{
    language: string;
    highlight: CodeHighlighter;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/code-highlighter")
      .then(({ loadCodeHighlighter }) => loadCodeHighlighter(language))
      .then((highlight) => {
        if (!cancelled) {
          setHighlighter({ language, highlight });
        }
      })
      .catch(() => {
        // Keep the editable text visible if a highlighting chunk fails to load.
        if (!cancelled) {
          setHighlighter(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const tokens = useMemo(() => {
    if (highlighter?.language !== language) {
      return null;
    }
    return highlighter.highlight(value);
  }, [highlighter, language, value]);

  const syncScroll = useCallback(() => {
    const editor = editorRef.current;
    const highlight = highlightRef.current;
    if (editor && highlight) {
      // Match the textarea's viewport, including space taken by its scrollbars.
      highlight.style.width = `${editor.clientWidth}px`;
      highlight.style.height = `${editor.clientHeight}px`;
      highlight.scrollTop = editor.scrollTop;
      highlight.scrollLeft = editor.scrollLeft;
    }
  }, []);

  useLayoutEffect(syncScroll, [editing, tokens, value, syncScroll]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editing || !editor) {
      return;
    }
    const observer = new ResizeObserver(syncScroll);
    observer.observe(editor);
    return () => observer.disconnect();
  }, [editing, syncScroll]);

  const content = tokens
    ? tokens.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 ? "\n" : null}
          {line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={token.htmlStyle as CSSProperties}>
              {token.content}
            </span>
          ))}
        </Fragment>
      ))
    : value;

  if (!editing) {
    return (
      <pre className="code-editor-preview shiki" tabIndex={0}>
        <code>{content}</code>
      </pre>
    );
  }

  return (
    <div className="code-editor-shell" data-highlighted={tokens !== null}>
      <pre
        ref={highlightRef}
        className="code-editor-highlight shiki"
        aria-hidden="true"
      >
        <code>
          {content}
          {value.endsWith("\n") ? " " : null}
        </code>
      </pre>
      <textarea
        ref={editorRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
            requestAnimationFrame(() => {
              target.selectionStart = start + 2;
              target.selectionEnd = start + 2;
              syncScroll();
            });
            return;
          }

          if (onRun && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onRun();
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            onFinish();
          }
        }}
        rows={Math.min(30, Math.max(6, value.split("\n").length))}
        className="code-editor"
        aria-label="Edit code block"
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        wrap="off"
      />
    </div>
  );
}
