import { KeyboardEvent, useEffect, useMemo, useRef } from 'react';
import { Diagnostic } from '../types';
import { useI18n } from '../i18n';

const LINE_H = 20;

interface Props {
  file: string;
  content: string;
  dirty: boolean;
  gotoLine?: number;
  gotoNonce: number;
  diagnostics: Diagnostic[];
  onChange: (value: string) => void;
  onSave: () => void;
}

export default function CodeEditor({ file, content, dirty, gotoLine, gotoNonce, diagnostics, onChange, onSave }: Props) {
  const { t: tr } = useI18n();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const marks = useMemo(() => {
    const m = new Map<number, 'error' | 'warning'>();
    diagnostics.filter((d) => d.file === file).forEach((d) => {
      if (m.get(d.line) !== 'error') m.set(d.line, d.severity);
    });
    return m;
  }, [diagnostics, file]);

  const sync = () => {
    const ta = taRef.current;
    if (!ta) return;
    const t = `translateY(${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = t;
    if (overlayRef.current) overlayRef.current.style.transform = t;
  };

  useEffect(() => {
    const ta = taRef.current;
    if (!ta || !gotoLine) return;
    ta.scrollTop = Math.max(0, (gotoLine - 5) * LINE_H);
    const lines = content.split('\n');
    const pos = lines.slice(0, gotoLine - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(pos, pos + (lines[gotoLine - 1]?.length ?? 0));
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoNonce]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      onChange(content.slice(0, s) + '  ' + content.slice(en));
      requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
    }
  };

  const lineStyle = { height: LINE_H, lineHeight: `${LINE_H}px` };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-700 text-xs text-gray-400 bg-dark">
        <span className="font-mono text-gray-200">{file}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono uppercase">
          {file.toLowerCase().endsWith('.vhd') || file.toLowerCase().endsWith('.vhdl') ? 'VHDL' : file.toLowerCase().endsWith('.v') ? 'Verilog' : 'SystemVerilog'}
        </span>
        {dirty && <span className="text-yellow-400">{tr.unsaved}</span>}
        <button
          onClick={onSave}
          disabled={!dirty}
          className="ml-auto px-2 py-0.5 rounded bg-primary text-white disabled:opacity-30"
        >
          {tr.save}
        </button>
      </div>
      <div className="flex-1 relative overflow-hidden bg-darker font-mono text-[13px]">
        <div className="absolute inset-y-0 left-0 w-12 overflow-hidden bg-dark border-r border-slate-800 text-right text-slate-500 pr-2">
          <div ref={gutterRef}>
            {Array.from({ length: lineCount }, (_, i) => {
              const sev = marks.get(i + 1);
              return (
                <div
                  key={i}
                  style={lineStyle}
                  className={sev === 'error' ? 'text-red-400 font-bold' : sev === 'warning' ? 'text-yellow-400 font-bold' : ''}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>
        <div className="absolute inset-y-0 left-12 right-0 overflow-hidden pointer-events-none">
          <div ref={overlayRef}>
            {Array.from({ length: lineCount }, (_, i) => {
              const sev = marks.get(i + 1);
              const isGoto = gotoLine === i + 1;
              return (
                <div
                  key={i}
                  style={lineStyle}
                  className={
                    isGoto
                      ? 'bg-sky-500/25 border-l-2 border-sky-400'
                      : sev === 'error'
                      ? 'bg-red-500/15'
                      : sev === 'warning'
                      ? 'bg-yellow-500/10'
                      : ''
                  }
                />
              );
            })}
          </div>
        </div>
        <textarea
          ref={taRef}
          value={content}
          spellCheck={false}
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onKeyDown={onKeyDown}
          style={{ lineHeight: `${LINE_H}px`, tabSize: 2 }}
          className="absolute inset-y-0 left-12 right-0 pl-3 bg-transparent text-gray-100 outline-none resize-none whitespace-pre overflow-auto"
        />
      </div>
    </div>
  );
}
