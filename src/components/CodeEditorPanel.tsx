import { ArrowRight, ArrowLeft, Code2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CodeGenOptions, FlowNode } from '../types/flow';

interface CodeEditorPanelProps {
  code: string;
  onChangeCode: (newCode: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  options: CodeGenOptions;
  onChangeOptions: (newOpts: CodeGenOptions) => void;
  onGenerateFromCpp: () => void;
  onSynthesizeCppFromGraph: () => void;
  onLoadSample: (sampleKey: 'loop_if' | 'triangle' | 'switch' | 'example1' | 'complex' | 'reset') => void;
  nodes: FlowNode[];
  selectedNodeIds: Set<string>;
  activeEditorLine: number | null;
  onSelectEditorLine: (line: number | null, focusCanvas?: boolean) => void;
}

const ZOOM_STORAGE_KEY = 'cpp_gost_code_zoom_v1';
const WIDTH_STORAGE_KEY = 'cpp_gost_left_width_v1';
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.0;
const DEFAULT_WIDTH = 375;
const MIN_WIDTH = 260;
const MAX_WIDTH = 750;

function tokenizeCppLine(line: string): React.ReactNode[] {
  const commentIdx = (() => {
    let inStr = false;
    let q = '';
    for (let i = 0; i < line.length - 1; i++) {
      const ch = line[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === q) inStr = false;
      } else {
        if (ch === '"' || ch === "'") {
          inStr = true;
          q = ch;
        } else if (ch === '/' && line[i + 1] === '/') {
          return i;
        }
      }
    }
    return -1;
  })();

  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : '';

  if (/^\s*#\s*(?:include|define|pragma|ifdef|ifndef|endif)\b/.test(codePart)) {
    return [
      <span key="prep" className="syn-preproc">
        {codePart}
      </span>,
      commentPart ? (
        <span key="c" className="syn-comment">
          {commentPart}
        </span>
      ) : null,
    ];
  }

  const tokens: React.ReactNode[] = [];
  const tokenRegex =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:if|else|for|while|do|switch|case|default|break|continue|return|using|namespace)\b|\b(?:int|double|float|char|bool|void|long|short|unsigned|const|string|size_t|auto|std|cin|cout|cerr|endl|setlocale|LC_ALL)\b|\b\d+(?:\.\d+)?\b)/g;

  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = tokenRegex.exec(codePart)) !== null) {
    if (m.index > lastIdx) {
      tokens.push(codePart.slice(lastIdx, m.index));
    }
    const tok = m[0];
    if (tok.startsWith('"') || tok.startsWith("'")) {
      tokens.push(
        <span key={k++} className="syn-string">
          {tok}
        </span>
      );
    } else if (
      /^(?:if|else|for|while|do|switch|case|default|break|continue|return|using|namespace)$/.test(tok)
    ) {
      tokens.push(
        <span key={k++} className="syn-keyword">
          {tok}
        </span>
      );
    } else if (/^\d/.test(tok)) {
      tokens.push(
        <span key={k++} className="syn-number">
          {tok}
        </span>
      );
    } else {
      tokens.push(
        <span key={k++} className="syn-type">
          {tok}
        </span>
      );
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < codePart.length) {
    tokens.push(codePart.slice(lastIdx));
  }

  if (commentPart) {
    tokens.push(
      <span key="comm" className="syn-comment">
        {commentPart}
      </span>
    );
  }

  return tokens;
}

export const CodeEditorPanel: React.FC<CodeEditorPanelProps> = ({
  code,
  onChangeCode,
  collapsed,
  onToggleCollapse,
  options,
  onChangeOptions,
  onGenerateFromCpp,
  onSynthesizeCppFromGraph,
  onLoadSample,
  nodes,
  selectedNodeIds,
  activeEditorLine,
  onSelectEditorLine,
}) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Code zoom state (0.7 .. 2.0)
  const [codeZoom, setCodeZoom] = useState<number>(() => {
    try {
      const saved = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY) || '');
      if (!isNaN(saved) && saved >= MIN_ZOOM && saved <= MAX_ZOOM) {
        return Math.round(saved * 10) / 10;
      }
    } catch {}
    return 1.0;
  });

  // Resizable panel width state (260px .. 750px)
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem(WIDTH_STORAGE_KEY) || '', 10);
      if (!isNaN(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
        return saved;
      }
    } catch {}
    return DEFAULT_WIDTH;
  });

  const [isResizingPanel, setIsResizingPanel] = useState<boolean>(false);
  const resizeStartRef = useRef<{ startX: number; startW: number } | null>(null);

  const changeZoom = useCallback((nextZoom: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoom * 10) / 10));
    setCodeZoom(clamped);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {}
  }, []);

  // Non-passive Ctrl + Wheel handler over the code editor container
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        setCodeZoom((prev) => {
          const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((prev + delta) * 10) / 10));
          try {
            localStorage.setItem(ZOOM_STORAGE_KEY, String(next));
          } catch {}
          return next;
        });
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Drag resizer for left panel width
  useEffect(() => {
    if (!isResizingPanel) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const dx = e.clientX - resizeStartRef.current.startX;
      const nextW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartRef.current.startW + dx));
      setPanelWidth(nextW);
    };
    const handleMouseUp = () => {
      setIsResizingPanel(false);
      resizeStartRef.current = null;
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(panelWidth));
      } catch {}
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingPanel, panelWidth]);

  const handleScroll = () => {
    if (!textareaRef.current) return;
    const st = textareaRef.current.scrollTop;
    const sl = textareaRef.current.scrollLeft;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = st;
      highlightRef.current.scrollLeft = sl;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = st;
    }
  };

  const updateCursorLine = () => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart || 0;
    const lineNum = code.slice(0, pos).split('\n').length;
    onSelectEditorLine(lineNum, false);
  };

  const lines = code.split('\n');

  // Synchronized scaled geometry so textarea cursor & syntax highlight align pixel-for-pixel
  const scaledFontSize = Math.round(12 * codeZoom * 10) / 10;
  const scaledLineHeight = Math.round(19 * codeZoom);
  const scaledGutterWidth = Math.max(44, Math.round(44 * codeZoom));

  // Compute which lines are linked to currently selected canvas nodes
  const selectedSourceLines = new Set<number>();
  nodes.forEach((n) => {
    if (selectedNodeIds.has(n.id) && n.sourceLines) {
      n.sourceLines.forEach((ln) => selectedSourceLines.add(ln));
    }
  });

  // Compute which lines have any GOST node mapped to them
  const mappedLines = new Set<number>();
  nodes.forEach((n) => {
    if (n.type !== 'brace' && n.sourceLines) {
      n.sourceLines.forEach((ln) => mappedLines.add(ln));
    }
  });

  return (
    <aside
      className={`left-panel ${collapsed ? 'collapsed' : ''} ${
        isResizingPanel ? 'resizing-active' : ''
      }`}
      style={collapsed ? undefined : { width: panelWidth, minWidth: MIN_WIDTH }}
    >
      <div className="panel-header code-panel-header">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-400 border border-slate-700">
            C++17
          </span>
          <span>Исходный код</span><span className="source-filename">main.cpp</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            className="btn-sample btn-sample-emerald"
            onClick={() => onLoadSample('loop_if')}
            title="Загрузить пример с циклом for, условием if, скобками {} и return 0 в овале"
          >
            Цикл + if
          </button>
          <button
            className="btn-sample btn-sample-amber"
            onClick={() => onLoadSample('triangle')}
            title="Загрузить пример с тройным вложенным if-else (проверка треугольника)"
          >
            Вложенные if
          </button>
          <button
            className="btn-sample btn-sample-sky"
            onClick={() => onLoadSample('switch')}
            title="Загрузить пример switch (a) с объединением общих case 1..3 через соединитель, блоками break; и скобками {}"
          >
            Switch
          </button>
          <button
            className="btn-sample"
            onClick={() => onLoadSample('example1')}
            title="Загрузить линейный пример"
          >
            Образец 1
          </button>
          <button
            className="btn-sample btn-sample-sky"
            onClick={() => onLoadSample('complex')}
            title="Загрузить пример с функциями, switch-case и вложенными ветвлениями"
          >
            Сложный C++
          </button>
          <button
            className="btn-sample btn-sample-danger"
            onClick={() => onLoadSample('reset')}
            title="Очистить и код, и весь холст"
          >
            Сброс
          </button>
          <button
            className="btn-sample"
            onClick={onToggleCollapse}
            title="Свернуть панель кода влево (Ctrl+B)"
          >
            ◀
          </button>
        </div>
      </div>

      {/* Synchronized Line-Numbered Syntax Editor with Line <-> Node Link */}
      <div ref={editorContainerRef} className="code-editor-container">
        <div
          ref={gutterRef}
          className="code-gutter"
          aria-hidden="true"
          style={{
            width: scaledGutterWidth,
            fontSize: `${scaledFontSize}px`,
            lineHeight: `${scaledLineHeight}px`,
          }}
        >
          {lines.map((_, idx) => {
            const ln = idx + 1;
            const isLinkedToSelection = selectedSourceLines.has(ln);
            const isActiveLine = activeEditorLine === ln;
            const hasMappedNode = mappedLines.has(ln);
            return (
              <div
                key={ln}
                onClick={() => onSelectEditorLine(ln, true)}
                onMouseEnter={() => onSelectEditorLine(ln, false)}
                title={
                  hasMappedNode
                    ? `Строка ${ln} связана с блоком ГОСТ (клик — найти блок на чертеже)`
                    : `Строка ${ln}`
                }
                className={`gutter-line ${isLinkedToSelection ? 'gutter-linked' : ''} ${
                  isActiveLine ? 'gutter-active' : ''
                }`}
                style={{ height: `${scaledLineHeight}px` }}
              >
                <span className="gutter-dot">{hasMappedNode ? '▪' : ''}</span>
                <span className="tabular-nums">{ln}</span>
              </div>
            );
          })}
        </div>

        <div className="code-stage">
          <pre
            ref={highlightRef}
            className="code-highlight-layer"
            aria-hidden="true"
            style={{
              fontSize: `${scaledFontSize}px`,
              lineHeight: `${scaledLineHeight}px`,
            }}
          >
            {lines.map((lineText, idx) => {
              const ln = idx + 1;
              const isLinkedToSelection = selectedSourceLines.has(ln);
              const isActiveLine = activeEditorLine === ln;
              return (
                <div
                  key={ln}
                  className={`code-line-row ${
                    isLinkedToSelection ? 'code-line-linked' : isActiveLine ? 'code-line-active' : ''
                  }`}
                  style={{
                    minHeight: `${scaledLineHeight}px`,
                    lineHeight: `${scaledLineHeight}px`,
                  }}
                >
                  {tokenizeCppLine(lineText)}
                  {'\n'}
                </div>
              );
            })}
          </pre>

          <textarea
            ref={textareaRef}
            id="codeEditor"
            aria-label="Исходный код C++"
            value={code}
            onChange={(e) => onChangeCode(e.target.value)}
            onScroll={handleScroll}
            onClick={updateCursorLine}
            onKeyUp={updateCursorLine}
            placeholder="// Вставьте сюда ваш код на C++ (поддерживаются функции, вложенные if-else, for, while, do-while, switch-case)..."
            spellCheck={false}
            style={{
              fontSize: `${scaledFontSize}px`,
              lineHeight: `${scaledLineHeight}px`,
            }}
          />
        </div>
      </div>

      {/* Информационная полоса и пульт масштабирования кода (- / 100% / +) */}
      <div className="code-sync-strip">
        <span className="text-[10.5px] text-slate-400 truncate" title="Клик по номеру строки подсвечивает блок на чертеже">
          Номера строк ↔ блоки ГОСТ
        </span>

        <div className="code-zoom-controls" title="Масштаб текста кода C++ (также Ctrl + колесо мыши)">
          <span className="text-[10px] text-slate-400 mr-0.5">Масштаб:</span>
          <button
            type="button"
            className="code-zoom-btn"
            disabled={codeZoom <= MIN_ZOOM}
            onClick={() => changeZoom(codeZoom - 0.1)}
            title="Уменьшить шрифт кода C++ (Ctrl + колесо вниз)"
          >
            −
          </button>
          <button
            type="button"
            className="code-zoom-value tabular-nums"
            onClick={() => changeZoom(1.0)}
            title="Сбросить масштаб кода на 100%"
          >
            {Math.round(codeZoom * 100)}%
          </button>
          <button
            type="button"
            className="code-zoom-btn"
            disabled={codeZoom >= MAX_ZOOM}
            onClick={() => changeZoom(codeZoom + 0.1)}
            title="Увеличить шрифт кода C++ (Ctrl + колесо вверх)"
          >
            +
          </button>
        </div>
      </div>

      <details className="generation-settings"><summary>Настройки построения</summary><div className="code-options">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={options.exampleStyle}
            onChange={(e) => onChangeOptions({ ...options, exampleStyle: e.target.checked })}
          />
          <span>Показывать скобки &#123; &#125; у вложенных конструкций</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={options.showKeywords}
            onChange={(e) => onChangeOptions({ ...options, showKeywords: e.target.checked })}
          />
          <span>Показывать if, for, while внутри блоков</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={options.gostLoopBounds}
            onChange={(e) => onChangeOptions({ ...options, gostLoopBounds: e.target.checked })}
          />
          <span>Циклы через «Границы цикла» (п. 3.2.2.6 ГОСТ)</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={options.groupStmts}
            onChange={(e) => onChangeOptions({ ...options, groupStmts: e.target.checked })}
          />
          <span>Группировать подряд идущие блоки</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={options.gostNumbers}
            onChange={(e) => onChangeOptions({ ...options, gostNumbers: e.target.checked })}
          />
          <span>Нумерация блоков сверху слева (п. 4.1.5 ГОСТ)</span>
        </label>
        <label className="checkbox-row text-sky-300">
          <input
            type="checkbox"
            checked={options.autoSyncCpp}
            onChange={(e) => onChangeOptions({ ...options, autoSyncCpp: e.target.checked })}
          />
          <span>Авто-синхронизация кода C++ при правке блоков</span>
        </label>

      </div></details>
        <div className="generation-actions">
          <button
            className="btn btn-primary justify-center py-1.5"
            onClick={onGenerateFromCpp}
            title="Построить чертёж блок-схемы по коду C++"
          >
            <ArrowRight size={15} />Построить схему
          </button>
          <button
            className="btn btn-secondary-accent justify-center py-1.5"
            onClick={onSynthesizeCppFromGraph}
            title="Обратная генерация: собрать структурный код C++ из текущей блок-схемы на холсте"
          >
            <ArrowLeft size={15} />Получить C++
          </button>
        </div>

      {/* Интерактивный разделитель для растягивания ширины левой панели мышью */}
      {!collapsed && (
        <div
          className={`left-panel-resizer ${isResizingPanel ? 'active' : ''}`}
          title="Потяните мышью, чтобы изменить ширину панели кода (двойной клик — сброс)"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            resizeStartRef.current = { startX: e.clientX, startW: panelWidth };
            setIsResizingPanel(true);
          }}
          onDoubleClick={() => {
            setPanelWidth(DEFAULT_WIDTH);
            try {
              localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH));
            } catch {}
          }}
        />
      )}
    </aside>
  );
};

