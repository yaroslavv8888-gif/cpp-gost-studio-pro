import { Workflow, PanelLeftClose, PanelLeftOpen, Undo2, Redo2, Frame, Pencil, AlignCenter, Clipboard, Download, ZoomIn, ZoomOut, Scan, Check } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasTheme,
  CodeGenOptions,
  COMPLEX_CPP_CODE,
  EdgeStyle,
  EXAMPLE_CODE,
  FlowEdge,
  FlowNode,
  GostIssue,
  GostNodeType,
  GostStampData,
  LaserGuide,
  LOOP_IF_CODE,
  PortSide,
  SWITCH_CASE_CODE,
  TRIANGLE_IF_CODE,
} from './types/flow';
import {
  calcAutoSize,
  computeLaserAlignmentAndSnap,
  computeOrthogonalPoints,
  dragOrthogonalCorner,
  dragOrthogonalSegment,
  findSnapTargetAtPoint,
  getEdgeMidpoint,
  getEdgePoints,
  getPolylineMidpoint,
  getBranchLabelPosition,
  getPortCoords,
  getSubtreeBounds,
  insertBendOnSegment,
  Point,
  removeOrthogonalCorner,
  resetRoutingTracks,
  SnapTargetResult,
} from './engine/orthoRouter';
import { buildFlowFromCpp, synthesizeCppFromGraph } from './engine/cppParserAndBuilder';
import { applyGostAutoFix, validateGostFlowchart } from './engine/gostValidator';
import { remapCopiedControl, numericBranchLabels } from './engine/graphEditing';
import { CodeEditorPanel } from './components/CodeEditorPanel';
import { RightPaletteAndValidator } from './components/RightPaletteAndValidator';

interface HistorySnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
  nextId: number;
  code: string;
  showGostFrame: boolean;
  gostStampData: GostStampData;
}

const STORAGE_KEY = 'cpp_gost_studio_pro_v12';

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function App() {
  // --- Core Diagram & Code State ---
  const [code, setCode] = useState<string>(SWITCH_CASE_CODE);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [nextId, setNextId] = useState<number>(100);

  // --- UI & Studio State ---
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightTab, setRightTab] = useState<'palette' | 'validator'>('palette');
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>('whatman');
  const [showGostFrame, setShowGostFrame] = useState<boolean>(false);
  const [gostStampData, setGostStampData] = useState<GostStampData>({
    title: 'Лабораторная работа №1',
    doc: 'Схема алгоритма программы (ГОСТ 19.701-90)',
    code: 'ЕСПД.01.001.СХ',
    author: 'Иванов И. И.',
    group: 'ИВТ-101',
    teacher: 'Полякова О. А.',
    date: new Date().toLocaleDateString('ru-RU'),
  });

  const [options, setOptions] = useState<CodeGenOptions>({
    exampleStyle: true,
    showKeywords: true,
    gostLoopBounds: false,
    groupStmts: true,
    gostNumbers: false,
    autoSyncCpp: true,
  });

  // --- Selection & Linkage State ---
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [activeEditorLine, setActiveEditorLine] = useState<number | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // --- Viewport & Interactive Canvas State ---
  const [panX, setPanX] = useState<number>(130);
  const [panY, setPanY] = useState<number>(36);
  const [scale, setScale] = useState<number>(0.74);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [activeLaserGuides, setActiveLaserGuides] = useState<LaserGuide[]>([]);

  // --- Modals & Inline Editors ---
  const [inlineEditor, setInlineEditor] = useState<{
    open: boolean;
    x: number;
    y: number;
    text: string;
    targetNodeId: string | null;
    targetEdgeId: string | null;
  }>({ open: false, x: 0, y: 0, text: '', targetNodeId: null, targetEdgeId: null });

  const [stampModalOpen, setStampModalOpen] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // --- History Stack ---
  const [historyStack, setHistoryStack] = useState<HistorySnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // --- Refs for Interactive Dragging ---
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const viewportGroupRef = useRef<SVGGElement>(null);
  const gostFrameLayerRef = useRef<SVGGElement>(null);
  const edgesLayerRef = useRef<SVGGElement>(null);
  const nodesLayerRef = useRef<SVGGElement>(null);
  const manualSpawnCascadeRef = useRef<number>(0);

  const isPanningRef = useRef<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const draggingNodesRef = useRef<{
    primaryNode: FlowNode;
    startPt: Point;
    initialPositions: Map<string, { cx: number; y: number }>;
    moved: boolean;
  } | null>(null);

  const draggingEdgeSegRef = useRef<{
    edgeId: string;
    segIndex: number;
    initialPts: Point[];
    fromPort: PortSide;
    toPort: PortSide;
    moved: boolean;
  } | null>(null);

  const draggingCornerRef = useRef<{
    edgeId: string;
    cornerIndex: number;
    initialPts: Point[];
    style: EdgeStyle;
    startMouseX: number;
    startMouseY: number;
    moved: boolean;
  } | null>(null);

  const resizingNodeRef = useRef<{
    nodeId: string;
    startW: number;
    startH: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string | null;
    edgeId: string | null;
    port: PortSide;
    x: number;
    y: number;
    curX: number;
    curY: number;
  } | null>(null);

  const [reconnectingEdge, setReconnectingEdge] = useState<{
    edgeId: string;
    end: 'from' | 'to';
    fixedX: number;
    fixedY: number;
    fixedPort: PortSide;
    curX: number;
    curY: number;
  } | null>(null);

  const [snapPreview, setSnapPreview] = useState<SnapTargetResult | null>(null);

  const [marquee, setMarquee] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 2400);
  }, []);

  const pushHistory = useCallback(
    (
      newNodes: FlowNode[],
      newEdges: FlowEdge[],
      newNextId: number,
      newCode: string,
      newShowFrame = showGostFrame,
      newStamp = gostStampData
    ) => {
      const snap: HistorySnapshot = {
        nodes: newNodes.map((n) => ({ ...n })),
        edges: newEdges.map((e) => ({ ...e })),
        nextId: newNextId,
        code: newCode,
        showGostFrame: newShowFrame,
        gostStampData: { ...newStamp },
      };

      setHistoryStack((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        sliced.push(snap);
        if (sliced.length > 40) sliced.shift();
        setHistoryIndex(sliced.length - 1);
        return sliced;
      });

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
      } catch {}
    },
    [gostStampData, historyIndex, showGostFrame]
  );

  // Sync C++ code when canvas changes if autoSyncCpp is enabled
  const commitCanvasChange = useCallback(
    (
      updatedNodes: FlowNode[],
      updatedEdges: FlowEdge[],
      updatedNextId = nextId,
      triggerReverseCpp = false
    ) => {
      if (triggerReverseCpp && options.autoSyncCpp && updatedNodes.length > 0) {
        const { code: synthCode, updatedNodes: linkedNodes } = synthesizeCppFromGraph(
          updatedNodes,
          updatedEdges
        );
        setNodes(linkedNodes);
        setEdges(updatedEdges);
        setNextId(updatedNextId);
        setCode(synthCode);
        pushHistory(linkedNodes, updatedEdges, updatedNextId, synthCode);
        showToast('Код C++ синхронизирован со схемой');
      } else {
        setNodes(updatedNodes);
        setEdges(updatedEdges);
        setNextId(updatedNextId);
        pushHistory(updatedNodes, updatedEdges, updatedNextId, code);
      }
    },
    [code, nextId, options.autoSyncCpp, pushHistory, showToast]
  );

  // Center diagram helper
  const centerDiagram = useCallback((targetNodes: FlowNode[], targetEdges: FlowEdge[]) => {
    const wrap = canvasWrapRef.current;
    if (!targetNodes || targetNodes.length === 0 || !wrap) {
      setPanX(130);
      setPanY(36);
      setScale(0.74);
      return;
    }

    const bounds = getSubtreeBounds(targetNodes, targetEdges, targetNodes, targetEdges);
    if (!bounds) return;

    const wrapW = wrap.clientWidth || 820;
    const wrapH = wrap.clientHeight || 620;
    const pad = 72;

    const fitScaleX = (wrapW - pad * 2) / Math.max(200, bounds.width);
    const fitScaleY = (wrapH - pad * 2) / Math.max(200, bounds.height);
    const newScale = Math.min(0.88, Math.max(0.01, Math.min(fitScaleX, fitScaleY)));

    const diagramMidX = (bounds.minX + bounds.maxX) / 2;
    setScale(newScale);
    setPanX(Math.round(wrapW / 2 - diagramMidX * newScale));
    setPanY(Math.round(38 - bounds.minY * newScale));
  }, []);

  // Generate Flowchart from C++ code
  const runGenerateFromCpp = useCallback(
    (sourceCode: string, genOpts: CodeGenOptions, shouldCenter = false) => {
      setInlineEditor((prev) => ({ ...prev, open: false }));
      const built = buildFlowFromCpp(sourceCode, genOpts);
      setNodes(built.nodes);
      setEdges(built.edges);
      setNextId(built.nextId);
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(null);
      pushHistory(built.nodes, built.edges, built.nextId, sourceCode);
      if (shouldCenter) {
        setTimeout(() => centerDiagram(built.nodes, built.edges), 20);
      }
    },
    [centerDiagram, pushHistory]
  );

  // Initial load from embedded PC snapshot, localStorage, or default Triangle If example
  useEffect(() => {
    const embeddedSnap = (window as unknown as { __INITIAL_GOST_SNAPSHOT__?: HistorySnapshot })
      .__INITIAL_GOST_SNAPSHOT__;
    const saved = localStorage.getItem(STORAGE_KEY);
    const candidate = embeddedSnap || (saved ? (() => {
      try {
        return JSON.parse(saved) as HistorySnapshot;
      } catch {
        return null;
      }
    })() : null);

    if (candidate && candidate.nodes && candidate.nodes.length > 0) {
      candidate.edges = numericBranchLabels(candidate.edges || []);
      setCode(candidate.code || SWITCH_CASE_CODE);
      setNodes(candidate.nodes);
      setEdges(candidate.edges || []);
      setNextId(candidate.nextId || 100);
      if (typeof candidate.showGostFrame === 'boolean') setShowGostFrame(candidate.showGostFrame);
      if (candidate.gostStampData) setGostStampData(candidate.gostStampData);
      setHistoryStack([candidate]);
      setHistoryIndex(0);
      setTimeout(() => centerDiagram(candidate.nodes, candidate.edges || []), 30);
      return;
    }
    const initial = buildFlowFromCpp(SWITCH_CASE_CODE, options);
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setNextId(initial.nextId);
    const snap: HistorySnapshot = {
      nodes: initial.nodes,
      edges: initial.edges,
      nextId: initial.nextId,
      code: SWITCH_CASE_CODE,
      showGostFrame: false,
      gostStampData,
    };
    setHistoryStack([snap]);
    setHistoryIndex(0);
    setTimeout(() => centerDiagram(initial.nodes, initial.edges), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reverse synthesis handler (Canvas -> C++)
  const handleSynthesizeCppFromGraph = useCallback(() => {
    if (nodes.length === 0) return;
    const { code: synthCode, updatedNodes } = synthesizeCppFromGraph(nodes, edges);
    setCode(synthCode);
    setNodes(updatedNodes);
    pushHistory(updatedNodes, edges, nextId, synthCode);
    showToast('Код C++ успешно синтезирован из блок-схемы');
  }, [edges, nextId, nodes, pushHistory, showToast]);

  // Undo / Redo
  const undoAction = useCallback(() => {
    if (historyIndex <= 0) return;
    const targetIdx = historyIndex - 1;
    const snap = historyStack[targetIdx];
    if (!snap) return;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setNextId(snap.nextId);
    setCode(snap.code);
    setShowGostFrame(snap.showGostFrame);
    setGostStampData(snap.gostStampData);
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setHistoryIndex(targetIdx);
  }, [historyIndex, historyStack]);

  const redoAction = useCallback(() => {
    if (historyIndex >= historyStack.length - 1) return;
    const targetIdx = historyIndex + 1;
    const snap = historyStack[targetIdx];
    if (!snap) return;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setNextId(snap.nextId);
    setCode(snap.code);
    setShowGostFrame(snap.showGostFrame);
    setGostStampData(snap.gostStampData);
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setHistoryIndex(targetIdx);
  }, [historyIndex, historyStack]);

  // Live GOST 19.701-90 Validation
  const gostIssues = useMemo(() => validateGostFlowchart(nodes, edges), [nodes, edges]);
  const errorNodeIds = useMemo(
    () => new Set(gostIssues.filter((i) => i.severity === 'error' && i.nodeId).map((i) => i.nodeId!)),
    [gostIssues]
  );
  const warnNodeIds = useMemo(
    () => new Set(gostIssues.filter((i) => i.severity === 'warning' && i.nodeId).map((i) => i.nodeId!)),
    [gostIssues]
  );

  // Focus a GOST issue on the canvas
  const handleFocusGostIssue = useCallback(
    (issue: GostIssue) => {
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      if (issue.nodeId) {
        const nd = nodes.find((n) => n.id === issue.nodeId);
        if (nd) {
          setSelectedNodeIds(new Set([nd.id]));
          setSelectedEdgeId(null);
          setPanX(Math.round(wrap.clientWidth / 2 - nd.cx * scale));
          setPanY(Math.round(wrap.clientHeight / 2 - (nd.y + nd.h / 2) * scale));
        }
      } else if (issue.edgeId) {
        const ed = edges.find((e) => e.id === issue.edgeId);
        if (ed) {
          setSelectedEdgeId(ed.id);
          setSelectedNodeIds(new Set());
          const mid = getEdgeMidpoint(nodes, edges, ed);
          setPanX(Math.round(wrap.clientWidth / 2 - mid.x * scale));
          setPanY(Math.round(wrap.clientHeight / 2 - mid.y * scale));
        }
      }
    },
    [edges, nodes, scale]
  );

  const handleFixSingleGostIssue = useCallback(
    (issue: GostIssue) => {
      const fixed = applyGostAutoFix(issue, nodes, edges, nextId);
      commitCanvasChange(fixed.nodes, fixed.edges, fixed.nextId, true);
      showToast(`Исправлено: ${issue.gostClause}`);
    },
    [commitCanvasChange, edges, nextId, nodes, showToast]
  );

  const handleFixAllGostIssues = useCallback(() => {
    let curNodes = nodes;
    let curEdges = edges;
    let curId = nextId;
    const fixable = gostIssues.filter((i) => Boolean(i.fixType));
    fixable.forEach((iss) => {
      const res = applyGostAutoFix(iss, curNodes, curEdges, curId);
      curNodes = res.nodes;
      curEdges = res.edges;
      curId = res.nextId;
    });
    commitCanvasChange(curNodes, curEdges, curId, true);
    showToast('Выполнено автоисправление по ГОСТ 19.701-90');
  }, [commitCanvasChange, edges, gostIssues, nextId, nodes, showToast]);

  // Precompute all routed edge points in span order
  const cachedEdgePts = useMemo(() => {
    resetRoutingTracks();
    const getVerticalSpan = (e: FlowEdge) => {
      const n1 = nodes.find((n) => n.id === e.from);
      const n2 = nodes.find((n) => n.id === e.to);
      if (!n1 || !n2) return 0;
      return Math.abs(n2.y - n1.y);
    };
    const primaryEdges = edges
      .filter((e) => !e.fromEdge && !e.toEdge)
      .sort((a, b) => getVerticalSpan(a) - getVerticalSpan(b));
    const secondaryEdges = edges.filter((e) => e.fromEdge || e.toEdge);
    const ordered = [...primaryEdges, ...secondaryEdges];
    const map = new Map<string, Point[] | null>();
    ordered.forEach((e) => {
      map.set(e.id, getEdgePoints(nodes, edges, e));
    });
    return map;
  }, [nodes, edges]);

  // Client to canvas coordinate conversion
  const clientToCanvas = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = canvasWrapRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - panX) / scale,
        y: (clientY - rect.top - panY) / scale,
      };
    },
    [panX, panY, scale]
  );

  // Line selection in Code Editor -> highlight or focus node on Canvas
  const handleSelectEditorLine = useCallback(
    (line: number | null, focusCanvas = false) => {
      setActiveEditorLine(line);
      if (!line || !focusCanvas) return;
      const matchingNodes = nodes.filter(
        (n) => n.type !== 'brace' && n.sourceLines?.includes(line)
      );
      if (matchingNodes.length > 0) {
        const target = matchingNodes[0];
        setSelectedNodeIds(new Set(matchingNodes.map((m) => m.id)));
        setSelectedEdgeId(null);
        const wrap = canvasWrapRef.current;
        if (wrap) {
          setPanX(Math.round(wrap.clientWidth / 2 - target.cx * scale));
          setPanY(Math.round(wrap.clientHeight / 2 - (target.y + target.h / 2) * scale));
        }
      }
    },
    [nodes, scale]
  );

  // Sample loaders
  const handleLoadSample = useCallback(
    (sampleKey: 'loop_if' | 'triangle' | 'switch' | 'example1' | 'complex' | 'reset') => {
      if (sampleKey === 'reset') {
        setCode('');
        setNodes([]);
        setEdges([]);
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
        pushHistory([], [], 1, '');
        return;
      }
      const map = {
        loop_if: LOOP_IF_CODE,
        triangle: TRIANGLE_IF_CODE,
        switch: SWITCH_CASE_CODE,
        example1: EXAMPLE_CODE,
        complex: COMPLEX_CPP_CODE,
      };
      const targetCode = map[sampleKey];
      setCode(targetCode);
      runGenerateFromCpp(targetCode, options, true);
    },
    [options, pushHistory, runGenerateFromCpp]
  );

  // Manual node addition from right palette
  const handleAddManualNode = useCallback(
    (type: GostNodeType, defaultText: string, ev: React.MouseEvent) => {
      setInlineEditor((prev) => ({ ...prev, open: false }));
      if (type === 'comment' && selectedEdgeId) {
        const ed = edges.find((e) => e.id === selectedEdgeId);
        if (ed) {
          const mid = getEdgeMidpoint(nodes, edges, ed);
          const text =
            defaultText || ed.rightLabel || '#include <iostream>\nusing namespace std;';
          const cSize = calcAutoSize('comment', text);
          const newCommentId = 'n' + nextId;
          const newEdgeId = 'e' + (nextId + 1);
          const newComment: FlowNode = {
            id: newCommentId,
            type: 'comment',
            text,
            cx: mid.x + 58 + cSize.w / 2,
            y: mid.y - cSize.h / 2,
            w: cSize.w,
            h: cSize.h,
            fnId: 'manual',
          };
          const newDashedEdge: FlowEdge = {
            id: newEdgeId,
            from: null,
            fromEdge: ed.id,
            to: newCommentId,
            toEdge: null,
            fromPort: 'edge',
            toPort: 'left',
            leftLabel: '',
            rightLabel: '',
            style: 'dashed',
            bendOffset: 0,
          };
          const updatedEdges = edges.map((e) =>
            e.id === ed.id ? { ...e, rightLabel: '' } : e
          );
          commitCanvasChange(
            [...nodes, newComment],
            [...updatedEdges, newDashedEdge],
            nextId + 2,
            true
          );
          setSelectedNodeIds(new Set([newCommentId]));
          setSelectedEdgeId(null);
          return;
        }
      }

      const wrapRect = canvasWrapRef.current?.getBoundingClientRect();
      const width = wrapRect?.width || 800;
      const height = wrapRect?.height || 600;
      const targetScreenX = width - 155;
      let targetScreenY = height / 2;
      if (ev && ev.clientY && wrapRect) {
        targetScreenY = Math.max(70, Math.min(height - 80, ev.clientY - wrapRect.top));
      }

      const offset = (manualSpawnCascadeRef.current % 5) * 18;
      manualSpawnCascadeRef.current += 1;

      const spawnX = Math.round((targetScreenX - offset - panX) / scale / 5) * 5;
      const spawnY = Math.round((targetScreenY + offset - panY) / scale / 5) * 5;
      const sz = calcAutoSize(type, defaultText);
      const newId = 'n' + nextId;
      const newNode: FlowNode = {
        id: newId,
        type,
        text: defaultText,
        cx: spawnX,
        y: spawnY,
        w: sz.w,
        h: sz.h,
        fnId: 'manual',
      };

      const nextNodes = [...nodes, newNode];
      commitCanvasChange(nextNodes, edges, nextId + 1, type !== 'brace');
      setSelectedNodeIds(new Set([newId]));
      setSelectedEdgeId(null);
    },
    [commitCanvasChange, edges, nextId, nodes, panX, panY, scale, selectedEdgeId]
  );

  // Node / Edge Context Actions
  const changeSelectedNodeType = (newType: GostNodeType) => {
    if (selectedNodeIds.size === 0) return;
    const updated = nodes.map((n) => {
      if (!selectedNodeIds.has(n.id)) return n;
      const sz = calcAutoSize(newType, n.text);
      return { ...n, type: newType, control: undefined, sourceText: undefined, w: sz.w, h: sz.h };
    });
    commitCanvasChange(updated, edges, nextId, true);
  };

  const changeSelectedEdgeStyle = (newStyle: EdgeStyle) => {
    if (!selectedEdgeId) return;
    const updated = edges.map((e) => (e.id === selectedEdgeId ? { ...e, style: newStyle } : e));
    commitCanvasChange(nodes, updated, nextId, false);
  };

  const scaleSelectedElement = (factor: number) => {
    if (selectedNodeIds.size > 0) {
      const updated = nodes.map((n) =>
        selectedNodeIds.has(n.id)
          ? {
              ...n,
              w: Math.max(24, Math.round(n.w * factor)),
              h: Math.max(24, Math.round(n.h * factor)),
            }
          : n
      );
      commitCanvasChange(updated, edges, nextId, false);
    } else {
      setScale((s) => Math.min(2.5, Math.max(0.2, s * factor)));
    }
  };

  const duplicateSelectedNodes = () => {
    if (selectedNodeIds.size === 0) return;
    const idMap = new Map<string, string>();
    const newSelection = new Set<string>();
    let idCounter = nextId;
    const addedNodes: FlowNode[] = [];

    nodes.forEach((orig) => {
      if (selectedNodeIds.has(orig.id)) {
        const copyId = 'n' + idCounter++;
        addedNodes.push({
          ...orig,
          id: copyId,
          cx: orig.cx + 35,
          y: orig.y + 35,
        });
        idMap.set(orig.id, copyId);
        newSelection.add(copyId);
      }
    });

    addedNodes.forEach(n => { n.control = remapCopiedControl(n.control, idMap); });
    const addedEdges: FlowEdge[] = [];
    edges.forEach((e) => {
      if (e.from && e.to && idMap.has(e.from) && idMap.has(e.to)) {
        addedEdges.push({
          ...e,
          id: 'e' + idCounter++,
          from: idMap.get(e.from) || null,
          to: idMap.get(e.to) || null,
        });
      }
    });

    commitCanvasChange([...nodes, ...addedNodes], [...edges, ...addedEdges], idCounter, true);
    setSelectedNodeIds(newSelection);
    setSelectedEdgeId(null);
  };

  const shiftSelectedEdgeBend = (delta: number) => {
    if (!selectedEdgeId) return;
    const ed = edges.find((x) => x.id === selectedEdgeId);
    if (!ed) return;
    const pts = getEdgePoints(nodes, edges, ed);
    if (pts && pts.length >= 2) {
      const midSegIdx = Math.floor((pts.length - 1) / 2);
      const a = pts[midSegIdx];
      const b = pts[midSegIdx + 1];
      const isVert = Math.abs(a.x - b.x) <= Math.abs(a.y - b.y);
      const targetPt = isVert
        ? { x: Math.round((a.x + b.x) / 2) + delta, y: Math.round((a.y + b.y) / 2) }
        : { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) + delta };
      const newWps = dragOrthogonalSegment(
        pts,
        midSegIdx,
        targetPt,
        ed.fromPort || 'bottom',
        ed.toPort || 'top'
      );
      const updated = edges.map((e) =>
        e.id === selectedEdgeId
          ? {
              ...e,
              style: e.style === 'straight' ? ('ortho' as EdgeStyle) : e.style,
              waypoints: newWps,
              bendOffset: 0,
              bendOffsetY: 0,
            }
          : e
      );
      commitCanvasChange(nodes, updated, nextId, false);
    }
  };

  const addBendToSelectedEdge = () => {
    if (!selectedEdgeId) return;
    const ed = edges.find((x) => x.id === selectedEdgeId);
    if (!ed) return;
    const pts = getEdgePoints(nodes, edges, ed);
    if (!pts || pts.length < 2) return;

    // Find the longest segment to split with a new bend point
    let bestSegIdx = 0;
    let maxLen = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (len > maxLen) {
        maxLen = len;
        bestSegIdx = i;
      }
    }
    const newWps = insertBendOnSegment(pts, bestSegIdx, undefined, ed.style || 'ortho');
    const updated = edges.map((e) =>
      e.id === selectedEdgeId
        ? { ...e, waypoints: newWps, bendOffset: 0, bendOffsetY: 0 }
        : e
    );
    commitCanvasChange(nodes, updated, nextId, false);
    showToast('Добавлена точка изгиба (потяните угол или сегмент)');
  };

  const resetSelectedEdgeBends = (targetEdgeId?: string) => {
    const idToReset = targetEdgeId || selectedEdgeId;
    if (!idToReset) return;
    const updated = edges.map((e) =>
      e.id === idToReset
        ? { ...e, waypoints: undefined, bendOffset: 0, bendOffsetY: 0 }
        : e
    );
    commitCanvasChange(nodes, updated, nextId, false);
    showToast('Изгибы стрелки выпрямлены');
  };

  const addCommentToSelectedEdge = () => {
    if (!selectedEdgeId) return;
    const ed = edges.find((e) => e.id === selectedEdgeId);
    if (!ed) return;
    const mid = getEdgeMidpoint(nodes, edges, ed);
    const text =
      ed.rightLabel || '#include <iostream>\n#include <clocale>\nusing namespace std;';
    const cSize = calcAutoSize('comment', text);
    const commentId = 'n' + nextId;
    const dashedId = 'e' + (nextId + 1);

    const commentNode: FlowNode = {
      id: commentId,
      type: 'comment',
      text,
      cx: mid.x + 58 + cSize.w / 2,
      y: mid.y - cSize.h / 2,
      w: cSize.w,
      h: cSize.h,
    };
    const dashedEdge: FlowEdge = {
      id: dashedId,
      from: null,
      fromEdge: ed.id,
      to: commentId,
      toEdge: null,
      fromPort: 'edge',
      toPort: 'left',
      leftLabel: '',
      rightLabel: '',
      style: 'dashed',
      bendOffset: 0,
    };

    const updatedEdges = edges.map((e) => (e.id === ed.id ? { ...e, rightLabel: '' } : e));
    commitCanvasChange([...nodes, commentNode], [...updatedEdges, dashedEdge], nextId + 2, true);
    setSelectedNodeIds(new Set([commentId]));
    setSelectedEdgeId(null);
  };

  const deleteSelected = useCallback(() => {
    setInlineEditor((prev) => ({ ...prev, open: false }));
    if (selectedNodeIds.size > 0) {
      const nextNodes = nodes.filter((n) => !selectedNodeIds.has(n.id));
      const nextEdges = edges.filter(
        (e) =>
          (!e.from || !selectedNodeIds.has(e.from)) && (!e.to || !selectedNodeIds.has(e.to))
      );
      setSelectedNodeIds(new Set());
      commitCanvasChange(nextNodes, nextEdges, nextId, true);
    } else if (selectedEdgeId) {
      const nextEdges = edges.filter(
        (e) =>
          e.id !== selectedEdgeId &&
          e.fromEdge !== selectedEdgeId &&
          e.toEdge !== selectedEdgeId
      );
      setSelectedEdgeId(null);
      commitCanvasChange(nodes, nextEdges, nextId, true);
    }
  }, [commitCanvasChange, edges, nextId, nodes, selectedEdgeId, selectedNodeIds]);

  const autoAlignCenter = () => {
    if (nodes.length === 0) return;
    const startTerminator = nodes.find((n) => n.type === 'terminator');
    const mainAxisX = startTerminator ? startTerminator.cx : 360;
    const updated = nodes.map((n) =>
      n.type !== 'comment' && n.type !== 'brace' && Math.abs(n.cx - mainAxisX) < 110
        ? { ...n, cx: mainAxisX }
        : n
    );
    commitCanvasChange(updated, edges, nextId, false);
  };

  // Inline Editor handlers
  const openInlineEditor = (nodeId?: string) => {
    setStampModalOpen(false);
    const wrap = canvasWrapRef.current;
    const wWidth = wrap?.clientWidth || 800;
    const wHeight = wrap?.clientHeight || 600;

    const targetId =
      nodeId ||
      (selectedNodeIds.size > 0
        ? Array.from(selectedNodeIds)[selectedNodeIds.size - 1]
        : null);

    if (targetId) {
      const n = nodes.find((x) => x.id === targetId);
      if (!n) return;
      setSelectedNodeIds(new Set([targetId]));
      setSelectedEdgeId(null);
      const screenX = panX + n.cx * scale;
      const screenY = panY + (n.y + n.h / 2) * scale;
      setInlineEditor({
        open: true,
        x: Math.max(150, Math.min(wWidth - 150, screenX)),
        y: Math.max(80, Math.min(wHeight - 80, screenY)),
        text: n.text,
        targetNodeId: targetId,
        targetEdgeId: null,
      });
    } else if (selectedEdgeId) {
      const ed = edges.find((x) => x.id === selectedEdgeId);
      if (!ed) return;
      const mid = getEdgeMidpoint(nodes, edges, ed);
      const screenX = panX + mid.x * scale;
      const screenY = panY + mid.y * scale;
      setInlineEditor({
        open: true,
        x: Math.max(150, Math.min(wWidth - 150, screenX)),
        y: Math.max(80, Math.min(wHeight - 80, screenY)),
        text: ed.rightLabel || ed.leftLabel || '',
        targetNodeId: null,
        targetEdgeId: selectedEdgeId,
      });
    }
  };

  const saveInlineEditor = () => {
    if (!inlineEditor.open) return;
    if (inlineEditor.targetNodeId) {
      const updated = nodes.map((n) => {
        if (n.id !== inlineEditor.targetNodeId) return n;
        const sz = calcAutoSize(n.type, inlineEditor.text);
        return { ...n, text: inlineEditor.text,
          sourceText: n.text === inlineEditor.text ? n.sourceText : undefined,
          w: sz.w, h: sz.h };
      });
      commitCanvasChange(updated, edges, nextId, true);
    } else if (inlineEditor.targetEdgeId) {
      const updatedEdges = edges.map((e) =>
        e.id === inlineEditor.targetEdgeId ? { ...e, rightLabel: inlineEditor.text } : e
      );
      commitCanvasChange(nodes, updatedEdges, nextId, true);
    }
    setInlineEditor((prev) => ({ ...prev, open: false }));
  };

  // Mouse interaction handlers on SVG Canvas
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement | SVGSVGElement>) => {
    const target = e.target as HTMLElement;
    const isBgTarget =
      target.id === 'svgCanvas' ||
      target.id === 'canvasWrap' ||
      target.classList.contains('gost-frame-outer') ||
      target.classList.contains('gost-frame-inner');

    if (e.button === 1 || isBgTarget) {
      if (e.button === 1) e.preventDefault();
      setInlineEditor((prev) => ({ ...prev, open: false }));
      setStampModalOpen(false);

      if (e.shiftKey && e.button === 0) {
        const pt = clientToCanvas(e.clientX, e.clientY);
        setMarquee({ startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y });
        return;
      }

      if (e.button === 0) {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
      }
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - panX, y: e.clientY - panY };
    }
  };

  const startDragNode = (nodeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setInlineEditor((prev) => ({ ...prev, open: false }));
    setStampModalOpen(false);

    if (e.shiftKey) {
      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
      setSelectedEdgeId(null);
      return;
    }

    let activeSet = selectedNodeIds;
    if (!selectedNodeIds.has(nodeId)) {
      activeSet = new Set([nodeId]);
      setSelectedNodeIds(activeSet);
    }
    setSelectedEdgeId(null);

    const primaryNode = nodes.find((n) => n.id === nodeId);
    if (!primaryNode) return;
    if (primaryNode.sourceLines && primaryNode.sourceLines.length > 0) {
      setActiveEditorLine(primaryNode.sourceLines[0]);
    }

    const pt = clientToCanvas(e.clientX, e.clientY);
    const initialPositions = new Map<string, { cx: number; y: number }>();
    nodes.forEach((n) => {
      if (activeSet.has(n.id)) {
        initialPositions.set(n.id, { cx: n.cx, y: n.y });
      }
    });

    draggingNodesRef.current = {
      primaryNode,
      startPt: pt,
      initialPositions,
      moved: false,
    };
  };

  const startDragEdgeSegment = (
    edgeId: string,
    segIndex: number,
    pts: Point[],
    e: React.MouseEvent
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setInlineEditor((prev) => ({ ...prev, open: false }));
    const ed = edges.find((x) => x.id === edgeId);
    if (!ed || !pts || pts.length < 2) return;

    setSelectedEdgeId(edgeId);
    setSelectedNodeIds(new Set());
    draggingEdgeSegRef.current = {
      edgeId,
      segIndex,
      initialPts: pts.map((p) => ({ ...p })),
      fromPort: ed.fromPort || 'bottom',
      toPort: ed.toPort || 'top',
      moved: false,
    };
  };

  const startDragEdgeCorner = (
    edgeId: string,
    cornerIndex: number,
    pts: Point[],
    e: React.MouseEvent
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setInlineEditor((prev) => ({ ...prev, open: false }));
    const ed = edges.find((x) => x.id === edgeId);
    if (!ed || !pts || pts.length < 3) return;

    setSelectedEdgeId(edgeId);
    setSelectedNodeIds(new Set());
    const pt = clientToCanvas(e.clientX, e.clientY);
    draggingCornerRef.current = {
      edgeId,
      cornerIndex,
      initialPts: pts.map((p) => ({ ...p })),
      style: ed.style || 'ortho',
      startMouseX: pt.x,
      startMouseY: pt.y,
      moved: false,
    };
  };

  const handleAddBendOnSegment = (
    edgeId: string,
    segIndex: number,
    pts: Point[],
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setInlineEditor((prev) => ({ ...prev, open: false }));
    const ed = edges.find((x) => x.id === edgeId);
    if (!ed || !pts || pts.length < 2) return;

    const pt = clientToCanvas(e.clientX, e.clientY);
    const newWps = insertBendOnSegment(pts, segIndex, pt, ed.style || 'ortho');
    const updated = edges.map((item) =>
      item.id === edgeId
        ? { ...item, waypoints: newWps, bendOffset: 0, bendOffsetY: 0 }
        : item
    );
    commitCanvasChange(nodes, updated, nextId, false);
    setSelectedEdgeId(edgeId);
    setSelectedNodeIds(new Set());
    showToast('Добавлена точка изгиба');
  };

  const handleRemoveEdgeCorner = useCallback(
    (edgeId: string, cornerIndex: number, pts: Point[], style: EdgeStyle) => {
      const nextWps = removeOrthogonalCorner(pts, cornerIndex, style);
      const updated = edges.map((item) =>
        item.id === edgeId
          ? { ...item, waypoints: nextWps, bendOffset: 0, bendOffsetY: 0 }
          : item
      );
      commitCanvasChange(nodes, updated, nextId, false);
      showToast('Точка изгиба удалена');
    },
    [commitCanvasChange, edges, nextId, nodes, showToast]
  );

  const startReconnectEdgeEnd = (
    edgeId: string,
    end: 'from' | 'to',
    pts: Point[],
    e: React.MouseEvent
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setInlineEditor((prev) => ({ ...prev, open: false }));
    const ed = edges.find((x) => x.id === edgeId);
    if (!ed || pts.length < 2) return;

    setSelectedEdgeId(edgeId);
    setSelectedNodeIds(new Set());
    const pt = clientToCanvas(e.clientX, e.clientY);
    const fixedPt = end === 'from' ? pts[pts.length - 1] : pts[0];
    const fixedPort: PortSide = end === 'from' ? ed.toPort || 'top' : ed.fromPort || 'bottom';
    setReconnectingEdge({
      edgeId,
      end,
      fixedX: fixedPt.x,
      fixedY: fixedPt.y,
      fixedPort,
      curX: pt.x,
      curY: pt.y,
    });
    setSnapPreview(null);
  };

  const startResizeNode = (nodeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setSelectedNodeIds(new Set([nodeId]));
    const pt = clientToCanvas(e.clientX, e.clientY);
    resizingNodeRef.current = {
      nodeId,
      startW: node.w,
      startH: node.h,
      startX: pt.x,
      startY: pt.y,
      moved: false,
    };
  };

  const startConnect = (nodeId: string, port: PortSide, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const p = getPortCoords(node, port);
    setConnectingFrom({ nodeId, edgeId: null, port, x: p.x, y: p.y, curX: p.x, curY: p.y });
    setSnapPreview(null);
  };

  const startConnectFromEdge = (edgeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ed = edges.find((x) => x.id === edgeId);
    if (!ed) return;
    const mid = getEdgeMidpoint(nodes, edges, ed);
    setConnectingFrom({
      nodeId: null,
      edgeId,
      port: 'edge',
      x: mid.x,
      y: mid.y,
      curX: mid.x,
      curY: mid.y,
    });
    setSnapPreview(null);
  };

  const finishConnect = (targetNodeId: string, targetPort: PortSide, e: React.MouseEvent) => {
    e.stopPropagation();
    if (connectingFrom) {
      const targetNode = nodes.find((n) => n.id === targetNodeId);
      const sourceNode = connectingFrom.nodeId
        ? nodes.find((n) => n.id === connectingFrom.nodeId)
        : null;
      const isComment =
        targetNode?.type === 'comment' || sourceNode?.type === 'comment';

      if (connectingFrom.nodeId && connectingFrom.nodeId !== targetNodeId) {
        const newEdgeId = 'e' + nextId;
        const newEdge: FlowEdge = {
          id: newEdgeId,
          from: connectingFrom.nodeId,
          fromEdge: null,
          to: targetNodeId,
          toEdge: null,
          fromPort: connectingFrom.port,
          toPort: targetPort,
          leftLabel: '',
          rightLabel: '',
          style: isComment ? 'dashed' : 'ortho',
          bendOffset: 0,
        };
        commitCanvasChange(nodes, [...edges, newEdge], nextId + 1, !isComment);
        setSelectedEdgeId(newEdgeId);
        setSelectedNodeIds(new Set());
      } else if (connectingFrom.edgeId) {
        const newEdgeId = 'e' + nextId;
        const newEdge: FlowEdge = {
          id: newEdgeId,
          from: null,
          fromEdge: connectingFrom.edgeId,
          to: targetNodeId,
          toEdge: null,
          fromPort: 'edge',
          toPort: targetPort,
          leftLabel: '',
          rightLabel: '',
          style: isComment ? 'dashed' : 'ortho',
          bendOffset: 0,
        };
        commitCanvasChange(nodes, [...edges, newEdge], nextId + 1, !isComment);
        setSelectedEdgeId(newEdgeId);
        setSelectedNodeIds(new Set());
      }
    }
    setConnectingFrom(null);
  };

  const finishConnectToEdge = (targetEdgeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (connectingFrom) {
      const sourceNode = connectingFrom.nodeId
        ? nodes.find((n) => n.id === connectingFrom.nodeId)
        : null;
      const isComment = sourceNode?.type === 'comment';

      if (connectingFrom.nodeId) {
        const newEdgeId = 'e' + nextId;
        const newEdge: FlowEdge = isComment
          ? {
              id: newEdgeId,
              from: null,
              fromEdge: targetEdgeId,
              to: sourceNode!.id,
              toEdge: null,
              fromPort: 'edge',
              toPort: 'left',
              leftLabel: '',
              rightLabel: '',
              style: 'dashed',
              bendOffset: 0,
            }
          : {
              id: newEdgeId,
              from: connectingFrom.nodeId,
              fromEdge: null,
              to: null,
              toEdge: targetEdgeId,
              fromPort: connectingFrom.port,
              toPort: 'edge',
              leftLabel: '',
              rightLabel: '',
              style: 'ortho',
              bendOffset: 0,
            };
        commitCanvasChange(nodes, [...edges, newEdge], nextId + 1, false);
        setSelectedEdgeId(newEdgeId);
        setSelectedNodeIds(new Set());
      } else if (connectingFrom.edgeId && connectingFrom.edgeId !== targetEdgeId) {
        const newEdgeId = 'e' + nextId;
        const newEdge: FlowEdge = {
          id: newEdgeId,
          from: null,
          fromEdge: connectingFrom.edgeId,
          to: null,
          toEdge: targetEdgeId,
          fromPort: 'edge',
          toPort: 'edge',
          leftLabel: '',
          rightLabel: '',
          style: 'ortho',
          bendOffset: 0,
        };
        commitCanvasChange(nodes, [...edges, newEdge], nextId + 1, false);
        setSelectedEdgeId(newEdgeId);
        setSelectedNodeIds(new Set());
      }
    }
    setConnectingFrom(null);
  };

  // Global mousemove & mouseup listeners
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const pt = clientToCanvas(e.clientX, e.clientY);
      setCursorMm({ x: Math.round(pt.x), y: Math.round(pt.y) });

      if (marquee) {
        const nextM = { ...marquee, curX: pt.x, curY: pt.y };
        setMarquee(nextM);
        const rx = Math.min(nextM.startX, nextM.curX);
        const ry = Math.min(nextM.startY, nextM.curY);
        const rw = Math.abs(nextM.curX - nextM.startX);
        const rh = Math.abs(nextM.curY - nextM.startY);

        const sel = new Set<string>();
        nodes.forEach((n) => {
          const nLeft = n.cx - n.w / 2;
          const nRight = n.cx + n.w / 2;
          const nTop = n.y;
          const nBot = n.y + n.h;
          if (nRight >= rx && nLeft <= rx + rw && nBot >= ry && nTop <= ry + rh) {
            sel.add(n.id);
          }
        });
        setSelectedNodeIds(sel);
        return;
      }

      if (draggingCornerRef.current) {
        const dCorner = draggingCornerRef.current;
        if (Math.hypot(pt.x - dCorner.startMouseX, pt.y - dCorner.startMouseY) > 2.5) {
          dCorner.moved = true;
          const newWps = dragOrthogonalCorner(
            dCorner.initialPts,
            dCorner.cornerIndex,
            pt,
            dCorner.style
          );
          setEdges((prev) =>
            prev.map((ed) =>
              ed.id === dCorner.edgeId
                ? { ...ed, waypoints: newWps, bendOffset: 0, bendOffsetY: 0 }
                : ed
            )
          );
        }
        return;
      }

      if (draggingEdgeSegRef.current) {
        const dSeg = draggingEdgeSegRef.current;
        dSeg.moved = true;
        const newWps = dragOrthogonalSegment(
          dSeg.initialPts,
          dSeg.segIndex,
          pt,
          dSeg.fromPort,
          dSeg.toPort
        );
        setEdges((prev) =>
          prev.map((ed) =>
            ed.id === dSeg.edgeId
              ? { ...ed, waypoints: newWps, bendOffset: 0, bendOffsetY: 0 }
              : ed
          )
        );
        return;
      }

      if (reconnectingEdge) {
        const ed = edges.find((x) => x.id === reconnectingEdge.edgeId);
        const excludeNodeId =
          reconnectingEdge.end === 'from' ? ed?.to || null : ed?.from || null;
        const snap = findSnapTargetAtPoint(
          nodes,
          edges,
          pt,
          excludeNodeId,
          reconnectingEdge.edgeId
        );
        setSnapPreview(snap);
        setReconnectingEdge((prev) =>
          prev
            ? {
                ...prev,
                curX: snap ? snap.point.x : pt.x,
                curY: snap ? snap.point.y : pt.y,
              }
            : null
        );
        return;
      }

      if (resizingNodeRef.current) {
        const rState = resizingNodeRef.current;
        const dx = (pt.x - rState.startX) * 2;
        const dy = pt.y - rState.startY;
        rState.moved = true;
        setNodes((prev) =>
          prev.map((nd) =>
            nd.id === rState.nodeId
              ? {
                  ...nd,
                  w: Math.max(28, Math.round(rState.startW + dx)),
                  h: Math.max(28, Math.round(rState.startH + dy)),
                }
              : nd
          )
        );
        return;
      }

      if (draggingNodesRef.current) {
        const dState = draggingNodesRef.current;
        const rawDx = pt.x - dState.startPt.x;
        const rawDy = pt.y - dState.startPt.y;
        const initPrimary = dState.initialPositions.get(dState.primaryNode.id);
        if (!initPrimary) return;

        const candCx = Math.round((initPrimary.cx + rawDx) / 5) * 5;
        const candY = Math.round((initPrimary.y + rawDy) / 5) * 5;

        const snapRes = computeLaserAlignmentAndSnap(
          nodes,
          dState.primaryNode,
          candCx,
          candY,
          selectedNodeIds
        );
        setActiveLaserGuides(snapRes.guides);

        const finalDx = snapRes.snappedCx - initPrimary.cx;
        const finalDy = snapRes.snappedY - initPrimary.y;
        if (finalDx !== 0 || finalDy !== 0) dState.moved = true;

        setNodes((prev) =>
          prev.map((nd) => {
            const initPos = dState.initialPositions.get(nd.id);
            if (!initPos) return nd;
            return { ...nd, cx: initPos.cx + finalDx, y: initPos.y + finalDy };
          })
        );
        return;
      }

      if (connectingFrom) {
        const snap = findSnapTargetAtPoint(
          nodes,
          edges,
          pt,
          connectingFrom.nodeId,
          connectingFrom.edgeId
        );
        setSnapPreview(snap);
        setConnectingFrom((prev) =>
          prev
            ? {
                ...prev,
                curX: snap ? snap.point.x : pt.x,
                curY: snap ? snap.point.y : pt.y,
              }
            : null
        );
        return;
      }

      if (isPanningRef.current) {
        setPanX(e.clientX - panStartRef.current.x);
        setPanY(e.clientY - panStartRef.current.y);
      }
    };

    const handleMouseUp = () => {
      if (marquee) {
        setMarquee(null);
      }

      if (reconnectingEdge) {
        if (snapPreview) {
          const updatedEdges = edges.map((ed) => {
            if (ed.id !== reconnectingEdge.edgeId) return ed;
            if (reconnectingEdge.end === 'from') {
              if (snapPreview.kind === 'node' && snapPreview.nodeId && snapPreview.port) {
                return {
                  ...ed,
                  from: snapPreview.nodeId,
                  fromPort: snapPreview.port,
                  fromEdge: null,
                  waypoints: undefined,
                  bendOffset: 0,
                  bendOffsetY: 0,
                };
              }
              if (snapPreview.kind === 'edge' && snapPreview.edgeId) {
                return {
                  ...ed,
                  from: null,
                  fromPort: 'edge' as PortSide,
                  fromEdge: snapPreview.edgeId,
                  waypoints: undefined,
                  bendOffset: 0,
                  bendOffsetY: 0,
                };
              }
            } else {
              if (snapPreview.kind === 'node' && snapPreview.nodeId && snapPreview.port) {
                return {
                  ...ed,
                  to: snapPreview.nodeId,
                  toPort: snapPreview.port,
                  toEdge: null,
                  waypoints: undefined,
                  bendOffset: 0,
                  bendOffsetY: 0,
                };
              }
              if (snapPreview.kind === 'edge' && snapPreview.edgeId) {
                return {
                  ...ed,
                  to: null,
                  toPort: 'edge' as PortSide,
                  toEdge: snapPreview.edgeId,
                  waypoints: undefined,
                  bendOffset: 0,
                  bendOffsetY: 0,
                };
              }
            }
            return ed;
          });
          commitCanvasChange(nodes, updatedEdges, nextId, true);
          showToast('Конец стрелки переподключён');
        }
        setReconnectingEdge(null);
        setSnapPreview(null);
        return;
      }

      if (connectingFrom && snapPreview) {
        const sourceNode = connectingFrom.nodeId
          ? nodes.find((n) => n.id === connectingFrom.nodeId)
          : null;
        const targetNode =
          snapPreview.kind === 'node' && snapPreview.nodeId
            ? nodes.find((n) => n.id === snapPreview.nodeId)
            : null;
        const isComment =
          sourceNode?.type === 'comment' || targetNode?.type === 'comment';

        if (snapPreview.kind === 'node' && snapPreview.nodeId && snapPreview.port) {
          const newEdgeId = 'e' + nextId;
          const newEdge: FlowEdge = connectingFrom.nodeId
            ? {
                id: newEdgeId,
                from: connectingFrom.nodeId,
                fromEdge: null,
                to: snapPreview.nodeId,
                toEdge: null,
                fromPort: connectingFrom.port,
                toPort: snapPreview.port,
                leftLabel: '',
                rightLabel: '',
                style: isComment ? 'dashed' : 'ortho',
                bendOffset: 0,
                bendOffsetY: 0,
              }
            : {
                id: newEdgeId,
                from: null,
                fromEdge: connectingFrom.edgeId,
                to: snapPreview.nodeId,
                toEdge: null,
                fromPort: 'edge',
                toPort: snapPreview.port,
                leftLabel: '',
                rightLabel: '',
                style: isComment ? 'dashed' : 'ortho',
                bendOffset: 0,
                bendOffsetY: 0,
              };
          commitCanvasChange(nodes, [...edges, newEdge], nextId + 1, !isComment);
          setSelectedEdgeId(newEdgeId);
          setSelectedNodeIds(new Set());
        } else if (snapPreview.kind === 'edge' && snapPreview.edgeId) {
          const newEdgeId = 'e' + nextId;
          const newEdge: FlowEdge =
            isComment && sourceNode
              ? {
                  id: newEdgeId,
                  from: null,
                  fromEdge: snapPreview.edgeId,
                  to: sourceNode.id,
                  toEdge: null,
                  fromPort: 'edge',
                  toPort: 'left',
                  leftLabel: '',
                  rightLabel: '',
                  style: 'dashed',
                  bendOffset: 0,
                  bendOffsetY: 0,
                }
              : {
                  id: newEdgeId,
                  from: connectingFrom.nodeId,
                  fromEdge: connectingFrom.edgeId,
                  to: null,
                  toEdge: snapPreview.edgeId,
                  fromPort: connectingFrom.nodeId ? connectingFrom.port : 'edge',
                  toPort: 'edge',
                  leftLabel: '',
                  rightLabel: '',
                  style: 'ortho',
                  bendOffset: 0,
                  bendOffsetY: 0,
                };
          commitCanvasChange(nodes, [...edges, newEdge], nextId + 1, false);
          setSelectedEdgeId(newEdgeId);
          setSelectedNodeIds(new Set());
        }
        setConnectingFrom(null);
        setSnapPreview(null);
        return;
      }

      if (draggingCornerRef.current && !draggingCornerRef.current.moved) {
        const dCorner = draggingCornerRef.current;
        draggingCornerRef.current = null;
        handleRemoveEdgeCorner(
          dCorner.edgeId,
          dCorner.cornerIndex,
          dCorner.initialPts,
          dCorner.style
        );
        return;
      }

      if (
        (draggingNodesRef.current && draggingNodesRef.current.moved) ||
        (resizingNodeRef.current && resizingNodeRef.current.moved) ||
        (draggingEdgeSegRef.current && draggingEdgeSegRef.current.moved) ||
        (draggingCornerRef.current && draggingCornerRef.current.moved)
      ) {
        pushHistory(nodes, edges, nextId, code);
      }
      setActiveLaserGuides([]);
      draggingNodesRef.current = null;
      draggingEdgeSegRef.current = null;
      draggingCornerRef.current = null;
      resizingNodeRef.current = null;
      isPanningRef.current = false;
      setConnectingFrom(null);
      setSnapPreview(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    clientToCanvas,
    code,
    commitCanvasChange,
    connectingFrom,
    edges,
    handleRemoveEdgeCorner,
    marquee,
    nextId,
    nodes,
    pushHistory,
    reconnectingEdge,
    selectedNodeIds,
    showToast,
    snapPreview,
  ]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setLeftCollapsed((c) => !c);
        return;
      }

      const tag = document.activeElement?.tagName || '';
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoAction();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoAction();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedNodeIds(new Set(nodes.map((n) => n.id)));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, nodes, redoAction, undoAction]);

  // Non-passive mouse wheel zoom centered on cursor for smooth PC CAD control
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      setScale((prevScale) => {
        const nextScale = Math.min(2.5, Math.max(0.2, prevScale * factor));
        const ratio = nextScale / prevScale;
        setPanX((prevPanX) => Math.round(mouseX - (mouseX - prevPanX) * ratio));
        setPanY((prevPanY) => Math.round(mouseY - (mouseY - prevPanY) * ratio));
        return nextScale;
      });
    };
    wrap.addEventListener('wheel', handleWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', handleWheel);
  }, []);

  // Export SVG builder
  const buildExportSVG = (): string | null => {
    if (nodes.length === 0 || !viewportGroupRef.current) return null;
    const bbox = viewportGroupRef.current.getBBox();
    const pad = showGostFrame ? 16 : 36;
    const vx = Math.floor(bbox.x - pad);
    const vy = Math.floor(bbox.y - pad);
    const vw = Math.ceil(bbox.width + pad * 2);
    const vh = Math.ceil(bbox.height + pad * 2);

    const bg =
      canvasTheme === 'whatman'
        ? '#ffffff'
        : canvasTheme === 'blueprint'
        ? '#0c2238'
        : '#0e1116';
    const stroke =
      canvasTheme === 'whatman'
        ? '#000000'
        : canvasTheme === 'blueprint'
        ? '#e0f2fe'
        : '#ffffff';

    const frameHtml = gostFrameLayerRef.current?.innerHTML || '';
    const edgesHtml = edgesLayerRef.current?.innerHTML || '';
    const nodesHtml = nodesLayerRef.current?.innerHTML || '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">
      <style>
        .flow-shape { fill: ${bg}; stroke: ${stroke}; stroke-width: 1.8px; }
        .flow-comment-hit, .flow-brace-box { fill: transparent; stroke: none; }
        .flow-comment-bracket { fill: none; stroke: ${stroke}; stroke-width: 1.8px; }
        .flow-text { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; fill: ${stroke}; text-anchor: middle; }
        .flow-text-left { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; fill: ${stroke}; text-anchor: start; }
        .flow-gost-num { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 600; fill: ${stroke}; text-anchor: start; }
        .flow-brace-svg-text { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 300; fill: ${stroke}; text-anchor: middle; dominant-baseline: central; }
        .flow-edge-line { fill: none; stroke: ${stroke}; stroke-width: 1.8px; }
        .flow-edge-hit, .port-dot, .edge-port-dot, .resize-handle, .edge-elbow-pill, .edge-seg-drag-v, .edge-seg-drag-h, .edge-corner-handle, .edge-add-bend-btn, .edge-endpoint-handle, .snap-target-ring { display: none; }
        .edge-label-text { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12.5px; fill: ${stroke}; }
        .gost-frame-outer { fill: none; stroke: ${stroke}; stroke-width: 1.2px; }
        .gost-frame-inner { fill: none; stroke: ${stroke}; stroke-width: 2.2px; }
        .gost-stamp-box { fill: ${bg}; stroke: ${stroke}; stroke-width: 2px; }
        .gost-stamp-line { stroke: ${stroke}; stroke-width: 1.6px; }
        .gost-stamp-thin { stroke: ${stroke}; stroke-width: 1px; }
        .gost-stamp-text { font-family: 'Segoe UI', Arial, sans-serif; fill: ${stroke}; }
      </style>
      <defs>
        <marker id="arrowHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${stroke}"/>
        </marker>
      </defs>
      <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${bg}"/>
      ${frameHtml}
      ${edgesHtml}
      ${nodesHtml}
    </svg>`;
  };

  const triggerBrowserDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const downloadSVG = () => {
    const svg = buildExportSVG();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    triggerBrowserDownload(blob, 'cpp-gost-flowchart.svg');
  };

  const downloadPNG = () => {
    const svg = buildExportSVG();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
      }
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          triggerBrowserDownload(pngBlob, 'cpp-gost-flowchart.png');
        }
      }, 'image/png');
    };
    img.src = url;
  };

  const copyImageToClipboard = () => {
    const svg = buildExportSVG();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
      }
      URL.revokeObjectURL(url);

      canvas.toBlob(async (pngBlob) => {
        if (!pngBlob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2200);
        } catch {
          downloadPNG();
        }
      }, 'image/png');
    };
    img.src = url;
  };

  const exportDrawio = () => {
    let cells = '';
    nodes.forEach((n) => {
      const x = Math.round(n.cx - n.w / 2);
      const y = Math.round(n.y);
      let style = 'whiteSpace=wrap;html=1;strokeWidth=2;';
      if (n.type === 'terminator')
        style = 'rounded=1;arcSize=50;whiteSpace=wrap;html=1;strokeWidth=2;';
      else if (n.type === 'predefined')
        style = 'shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;strokeWidth=2;';
      else if (n.type === 'brace' || n.type === 'omission')
        style =
          'text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=30;';
      else if (n.type === 'io')
        style =
          'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;strokeWidth=2;';
      else if (n.type === 'decision') style = 'rhombus;whiteSpace=wrap;html=1;strokeWidth=2;';
      else if (n.type === 'prep')
        style =
          'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;strokeWidth=2;';
      else if (n.type === 'manual_op')
        style =
          'shape=trapezoid;perimeter=trapezoidPerimeter;whiteSpace=wrap;html=1;fixedSize=1;direction=west;strokeWidth=2;';
      else if (n.type === 'document')
        style = 'shape=document;whiteSpace=wrap;html=1;boundedLbl=1;strokeWidth=2;';
      else if (n.type === 'manual_input')
        style = 'shape=manualInput;whiteSpace=wrap;html=1;strokeWidth=2;';
      else if (n.type === 'card') style = 'shape=card;whiteSpace=wrap;html=1;strokeWidth=2;';
      else if (n.type === 'paper_tape') style = 'shape=tape;whiteSpace=wrap;html=1;strokeWidth=2;';
      else if (n.type === 'display') style = 'shape=display;whiteSpace=wrap;html=1;strokeWidth=2;';
      else if (n.type === 'stored_data')
        style = 'shape=dataStorage;whiteSpace=wrap;html=1;fixedSize=1;strokeWidth=2;';
      else if (n.type === 'ram')
        style = 'shape=internalStorage;whiteSpace=wrap;html=1;backgroundOutline=1;strokeWidth=2;';
      else if (n.type === 'direct_storage')
        style =
          'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;direction=south;strokeWidth=2;';
      else if (n.type === 'comment')
        style =
          'shape=partialRectangle;whiteSpace=wrap;html=1;left=1;right=0;top=1;bottom=1;fillColor=none;align=left;spacingLeft=10;strokeWidth=2;';

      const val = escapeXml(n.text).replace(/\n/g, '&#xa;');
      cells += `<mxCell id="${n.id}" value="${val}" style="${style}" vertex="1" parent="1">
        <mxGeometry x="${x}" y="${y}" width="${Math.round(n.w)}" height="${Math.round(n.h)}" as="geometry"/>
      </mxCell>\n`;
    });

    edges.forEach((e) => {
      const lbl = escapeXml([e.leftLabel, e.rightLabel].filter(Boolean).join(' ')).replace(
        /\n/g,
        '&#xa;'
      );
      const isDashed = e.style === 'dashed';
      const edgeStyle = isDashed
        ? 'edgeStyle=orthogonalEdgeStyle;rounded=0;dashed=1;endArrow=none;html=1;strokeWidth=2;'
        : 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;';
      const src = e.fromEdge ? e.fromEdge : e.from;
      const tgt = e.toEdge ? e.toEdge : e.to;
      cells += `<mxCell id="${e.id}" value="${lbl}" style="${edgeStyle}" edge="1" parent="1" source="${
        src || ''
      }" target="${tgt || ''}">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>\n`;
    });

    const xml = `<mxfile host="app.diagrams.net"><diagram name="ГОСТ 19.701-90"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
    const blob = new Blob([xml], { type: 'application/xml' });
    triggerBrowserDownload(blob, 'cpp-gost-scheme.drawio');
  };

  // Compute Floating Toolbar Position
  const floatingToolbarInfo = useMemo(() => {
    const wrapW = canvasWrapRef.current?.clientWidth || 800;
    if (selectedNodeIds.size > 0) {
      const selNodes = nodes.filter((n) => selectedNodeIds.has(n.id));
      if (selNodes.length === 0) return null;
      const avgCx = selNodes.reduce((s, n) => s + n.cx, 0) / selNodes.length;
      const minY = Math.min(...selNodes.map((n) => n.y));
      const screenX = panX + avgCx * scale;
      const screenY = panY + minY * scale - 10;
      return {
        mode: 'node' as const,
        left: Math.max(220, Math.min(wrapW - 220, screenX)),
        top: Math.max(54, screenY),
        count: selNodes.length,
        lastNodeType: selNodes[selNodes.length - 1].type,
      };
    }
    if (selectedEdgeId) {
      const ed = edges.find((x) => x.id === selectedEdgeId);
      if (!ed) return null;
      const mid = getEdgeMidpoint(nodes, edges, ed);
      const screenX = panX + mid.x * scale;
      const screenY = panY + mid.y * scale - 12;
      return {
        mode: 'edge' as const,
        left: Math.max(220, Math.min(wrapW - 220, screenX)),
        top: Math.max(54, screenY),
        edgeStyle: ed.style || 'ortho',
      };
    }
    return null;
  }, [edges, nodes, panX, panY, scale, selectedEdgeId, selectedNodeIds]);

  // Compute GOST Frame & Stamp geometry
  const gostFrameGeometry = useMemo(() => {
    if (!showGostFrame || nodes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      minX = Math.min(minX, n.cx - n.w / 2);
      maxX = Math.max(maxX, n.cx + n.w / 2);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + n.h);
    });
    cachedEdgePts.forEach((pts) => {
      if (!pts) return;
      pts.forEach((p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      });
    });

    const padSide = 55;
    const padTop = 42;
    const stampH = 104;
    const padBottom = stampH + 46;

    const rawInW = maxX - minX + padSide * 2;
    const inW = Math.max(620, Math.ceil(rawInW));
    const diagramCenterX = (minX + maxX) / 2;

    const inX = Math.floor(diagramCenterX - inW / 2);
    const inY = Math.floor(minY - padTop);
    const inH = Math.ceil(maxY - minY + padTop + padBottom);

    const sheetX = inX - 24;
    const sheetY = inY - 10;
    const sheetW = inW + 34;
    const sheetH = inH + 20;

    const stW = Math.min(470, inW);
    const stH = stampH;
    const stX = inX + inW - stW;
    const stY = inY + inH - stH;

    const col1X = stX + 185;
    const colRoleX = stX + 72;
    const col2X = stX + stW - 95;

    const rowHeaderY = stY + 28;
    const rowMid1Y = stY + 53;
    const rowMid2Y = stY + 78;

    const centerBoxMidX = Math.round((col1X + col2X) / 2);
    const rightBoxMidX = Math.round((col2X + stX + stW) / 2);

    return {
      sheetX,
      sheetY,
      sheetW,
      sheetH,
      inX,
      inY,
      inW,
      inH,
      stX,
      stY,
      stW,
      stH,
      col1X,
      colRoleX,
      col2X,
      rowHeaderY,
      rowMid1Y,
      rowMid2Y,
      centerBoxMidX,
      rightBoxMidX,
    };
  }, [cachedEdgePts, nodes, showGostFrame]);

  // Precompute GOST sequential numbers (п. 4.1.5 ГОСТ 19.701-90)
  const gostNodeNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let count = 1;
    nodes.forEach((n) => {
      if (
        n.type !== 'brace' &&
        n.type !== 'comment' &&
        n.type !== 'connector' &&
        n.type !== 'omission'
      ) {
        map.set(n.id, count++);
      }
    });
    return map;
  }, [nodes]);

  // Generate dynamic coordinate ruler ticks for the academic drafting board
  const horizontalTicks = useMemo(() => {
    const ticks: { pos: number; mm: number; major: boolean }[] = [];
    const stepMm = 50;
    for (let mm = -1500; mm <= 3000; mm += stepMm) {
      const screenPos = panX + mm * scale;
      if (screenPos >= -40 && screenPos <= 2200) {
        ticks.push({ pos: screenPos, mm, major: mm % 100 === 0 });
      }
    }
    return ticks;
  }, [panX, scale]);

  const verticalTicks = useMemo(() => {
    const ticks: { pos: number; mm: number; major: boolean }[] = [];
    const stepMm = 50;
    for (let mm = -500; mm <= 4000; mm += stepMm) {
      const screenPos = panY + mm * scale;
      if (screenPos >= -40 && screenPos <= 1600) {
        ticks.push({ pos: screenPos, mm, major: mm % 100 === 0 });
      }
    }
    return ticks;
  }, [panY, scale]);

  return (
    <div className={`app-shell theme-${canvasTheme}`}>
      {/* ВЕРХНЯЯ ИНЖЕНЕРНАЯ ПАНЕЛЬ КУЛЬМАНА ГОСТ */}
      <header className="top-cad-header">
        <div className="brand-lockup">
          <span className="brand-symbol"><Workflow size={23} strokeWidth={1.6} /></span>
          <div className="brand-text"><strong>Схема<span className="brand-pro">Studio Pro</span></strong><span>C++ и блок-схемы алгоритмов</span></div>
        </div>
        <div className="document-context"><span className="document-dot" />Схема алгоритма<span className="standard-badge">ГОСТ 19.701-90</span></div>
        <div className="export-actions">
          <button className="btn" onClick={copyImageToClipboard} title="Скопировать схему для вставки в Word"><Clipboard size={15} />{copySuccess ? 'Скопировано' : 'В Word'}</button>
          <div className="export-formats"><Download size={15} /><button className="btn" onClick={downloadPNG}>PNG</button><button className="btn" onClick={downloadSVG}>SVG</button><button className="btn" onClick={exportDrawio}>.drawio</button></div>
        </div>
      </header>
      <div className="studio-toolbar" role="toolbar" aria-label="Инструменты схемы">
        <div className="toolbar-actions">
          <button className={`btn ${leftCollapsed ? 'active-toggle' : ''}`} onClick={() => setLeftCollapsed(c => !c)} title="Панель кода (Ctrl+B)">{leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}Код</button>
          <button
            className="btn"
            disabled={historyIndex <= 0}
            onClick={undoAction}
            title="Отменить шаг (Ctrl+Z)"
          >
            <Undo2 size={15} /><span>Отменить</span>
          </button>
          <button
            className="btn"
            disabled={historyIndex >= historyStack.length - 1}
            onClick={redoAction}
            title="Повторить шаг (Ctrl+Y)"
          >
            <Redo2 size={15} /><span>Повторить</span>
          </button>

          {/* Выбор типа чертёжного листа (Ватман ГОСТ / Синька / Тёмный кульман) */}
          <div className="theme-switch" role="group" aria-label="Вид чертёжного листа">
            <button
              onClick={() => setCanvasTheme('whatman')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                canvasTheme === 'whatman'
                  ? 'theme-option is-active'
                  : 'theme-option'
              }`}
              title="Чертёжный ватман с миллиметровкой (для отчётов и печати)"
            >
              Ватман ГОСТ
            </button>
            <button
              onClick={() => setCanvasTheme('blueprint')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                canvasTheme === 'blueprint'
                  ? 'theme-option is-active'
                  : 'theme-option'
              }`}
              title="Классическая инженерная синька (Blueprint)"
            >
              Синька
            </button>
            <button
              onClick={() => setCanvasTheme('dark_drafting')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                canvasTheme === 'dark_drafting'
                  ? 'theme-option is-active'
                  : 'theme-option'
              }`}
              title="Тёмный инженерный кульман"
            >
              Кульман
            </button>
          </div>

          <button
            className={`btn ${showGostFrame ? 'active-toggle' : ''}`}
            onClick={() => {
              const nextVal = !showGostFrame;
              setShowGostFrame(nextVal);
              pushHistory(nodes, edges, nextId, code, nextVal, gostStampData);
            }}
            title="Включить/выключить чертёжную рамку и штамп ГОСТ 2.104-68 вокруг схемы"
          >
            <Frame size={15} />Рамка
          </button>
          <button
            className="btn"
            onClick={() => {
              setInlineEditor((prev) => ({ ...prev, open: false }));
              setStampModalOpen(true);
            }}
            title="Заполнить ФИО, группу, шифр и номер лабораторной работы в штампе"
          >
            <Pencil size={15} />Штамп
          </button>

          {/* Кнопка быстрого вызова Валидатора ГОСТ 19.701-90 */}
          <button
            onClick={() => setRightTab(rightTab === 'validator' ? 'palette' : 'validator')}
            className={`btn ${
              rightTab === 'validator'
                ? 'active-toggle'
                : gostIssues.some((i) => i.severity === 'error')
                ? 'border-rose-500 text-rose-300'
                : gostIssues.length > 0
                ? 'border-amber-500 text-amber-200'
                : 'border-emerald-600 text-emerald-300'
            }`}
            title="Открыть ведомость проверки схемы по правилам ГОСТ 19.701-90"
          >
            {gostIssues.length === 0 ? (
              <span>✓ Нормоконтроль</span>
            ) : (
              <span className="tabular-nums">
                ! Нормоконтроль ({gostIssues.length})
              </span>
            )}
          </button>

          <button
            className="btn"
            onClick={autoAlignCenter}
            title="Выровнять центральную ось блоков по вертикали"
          >
            <AlignCenter size={15} />Выровнять
          </button>

        </div>
        <span className="toolbar-summary">{nodes.filter(n => n.type !== 'brace').length} блоков<span />{edges.length} связей</span>
      </div>

      <div className="workspace">
        {/* ЛЕВАЯ КОЛОНКА: РЕДАКТОР C++ С ПОДСВЕТКОЙ И СВЯЗЬЮ СТРОКА <-> БЛОК */}
        <CodeEditorPanel
          code={code}
          onChangeCode={setCode}
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          options={options}
          onChangeOptions={(newOpts) => {
            setOptions(newOpts);
            if (
              newOpts.exampleStyle !== options.exampleStyle ||
              newOpts.showKeywords !== options.showKeywords ||
              newOpts.gostLoopBounds !== options.gostLoopBounds ||
              newOpts.groupStmts !== options.groupStmts
            ) {
              runGenerateFromCpp(code, newOpts, false);
            }
          }}
          onGenerateFromCpp={() => runGenerateFromCpp(code, options, false)}
          onSynthesizeCppFromGraph={handleSynthesizeCppFromGraph}
          onLoadSample={handleLoadSample}
          nodes={nodes}
          selectedNodeIds={selectedNodeIds}
          activeEditorLine={activeEditorLine}
          onSelectEditorLine={handleSelectEditorLine}
        />

        {/* ЦЕНТРАЛЬНЫЙ ИНТЕРАКТИВНЫЙ КУЛЬМАН С МИЛЛИМЕТРОВКОЙ И ЛИНЕЙКАМИ */}
        <div
          ref={canvasWrapRef}
          id="canvasWrap"
          className={`canvas-wrap ${
            connectingFrom || reconnectingEdge ? 'connecting-mode' : ''
          }`}
          onMouseDown={handleCanvasMouseDown}
        >
          {/* Угловой маркер и линейки кульмана (мм) */}
          <div className="drafting-ruler-corner">мм</div>
          <div className="drafting-ruler-top">
            <svg width="100%" height="20">
              {horizontalTicks.map((t) => (
                <g key={t.mm} transform={`translate(${t.pos - 22}, 0)`}>
                  <line
                    x1={0}
                    y1={t.major ? 4 : 11}
                    x2={0}
                    y2={20}
                    stroke="var(--ruler-text)"
                    strokeWidth={t.major ? 1.2 : 0.8}
                    opacity={0.65}
                  />
                  {t.major && (
                    <text
                      x={4}
                      y={12}
                      fill="var(--ruler-text)"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {t.mm}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <div className="drafting-ruler-left">
            <svg width="22" height="100%">
              {verticalTicks.map((t) => (
                <g key={t.mm} transform={`translate(0, ${t.pos - 20})`}>
                  <line
                    x1={t.major ? 4 : 12}
                    y1={0}
                    x2={22}
                    y2={0}
                    stroke="var(--ruler-text)"
                    strokeWidth={t.major ? 1.2 : 0.8}
                    opacity={0.65}
                  />
                  {t.major && (
                    <text
                      x={2}
                      y={-3}
                      fill="var(--ruler-text)"
                      fontSize="8"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {t.mm}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>

          {/* Кнопка быстрого выдвижения панели кода, когда она скрыта */}
          {leftCollapsed && (
            <button
              className="left-drawer-tab"
              onClick={() => setLeftCollapsed(false)}
              title="Выдвинуть панель с кодом C++ (Ctrl+B)"
            >
              ▶ Код C++
            </button>
          )}

          {/* Всплывающая панель управления при клике левой кнопкой мыши */}
          {floatingToolbarInfo && (
            <div
              className="floating-toolbar"
              style={{ left: floatingToolbarInfo.left, top: floatingToolbarInfo.top }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {floatingToolbarInfo.mode === 'node' ? (
                <>
                  {floatingToolbarInfo.count > 1 && (
                    <span className="mini-badge">Выбрано: {floatingToolbarInfo.count}</span>
                  )}
                  <select
                    className="mini-select"
                    value={floatingToolbarInfo.lastNodeType}
                    onChange={(e) => changeSelectedNodeType(e.target.value as GostNodeType)}
                    title="Сменить фигуру по ГОСТ 19.701-90"
                  >
                    <option value="process">Процесс (▭)</option>
                    <option value="predefined">Подпрограмма (|[ ]|)</option>
                    <option value="decision">Решение (◇)</option>
                    <option value="prep">Подготовка (⬡)</option>
                    <option value="io">Данные (▱)</option>
                    <option value="terminator">Терминатор (⬭)</option>
                    <option value="loop_start">Начало цикла (⏢)</option>
                    <option value="loop_end">Конец цикла (⏥)</option>
                    <option value="manual_op">Ручная опер.</option>
                    <option value="parallel">Паралл. действ.</option>
                    <option value="striped_process">С полосой</option>
                    <option value="stored_data">Запом. данные</option>
                    <option value="ram">ОЗУ</option>
                    <option value="seq_storage">Послед. ЗУ</option>
                    <option value="direct_storage">Прямое ЗУ (Диск)</option>
                    <option value="document">Документ</option>
                    <option value="manual_input">Ручной ввод</option>
                    <option value="card">Карта</option>
                    <option value="paper_tape">Бумажн. лента</option>
                    <option value="display">Дисплей</option>
                    <option value="comment">Комментарий ([--)</option>
                    <option value="connector">Соединитель (◯)</option>
                    <option value="omission">Пропуск (...)</option>
                    <option value="brace">Скобка &#123; &#125;</option>
                  </select>
                  <button
                    className="mini-btn"
                    onClick={() => scaleSelectedElement(1.15)}
                    title="Увеличить размер"
                  >
                    ＋ Масштаб
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => scaleSelectedElement(0.85)}
                    title="Уменьшить размер"
                  >
                    － Масштаб
                  </button>
                  {floatingToolbarInfo.count === 1 && (
                    <button
                      className="mini-btn"
                      onClick={() => openInlineEditor()}
                      title="Быстро изменить текст"
                    >
                      ✎ Текст
                    </button>
                  )}
                  <button
                    className="mini-btn"
                    onClick={duplicateSelectedNodes}
                    title="Дублировать выбранные блоки"
                  >
                    ❐ Копия
                  </button>
                </>
              ) : (
                <>
                  <select
                    className="mini-select"
                    value={floatingToolbarInfo.edgeStyle}
                    onChange={(e) => changeSelectedEdgeStyle(e.target.value as EdgeStyle)}
                    title="Тип линии по ГОСТ 19.701-90"
                  >
                    <option value="ortho">Под углом 90°</option>
                    <option value="straight">Прямая линия</option>
                    <option value="dashed">Пунктирная</option>
                    <option value="control_transfer">Передача управл. (▽)</option>
                    <option value="comm_link">Канал связи (⚡)</option>
                    <option value="loop_left">Петля слева</option>
                    <option value="bypass_right">Обход справа</option>
                  </select>
                  <button
                    className="mini-btn"
                    onClick={() => openInlineEditor()}
                    title="Подписать условие на линии"
                  >
                    ✎ Подпись
                  </button>
                  <button
                    className="mini-btn"
                    onClick={addBendToSelectedEdge}
                    title="Добавить новую точку изгиба на эту стрелку"
                  >
                    ＋ Точка изгиба
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => shiftSelectedEdgeBend(-20)}
                    title="Сдвинуть изгиб влево/вверх"
                  >
                    ⬅ Колено
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => shiftSelectedEdgeBend(20)}
                    title="Сдвинуть изгиб вправо/вниз"
                  >
                    Колено ➡
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => resetSelectedEdgeBends()}
                    title="Сбросить все ручные изгибы стрелки"
                  >
                    ↺ Выпрямить
                  </button>
                  <button
                    className="mini-btn"
                    onClick={addCommentToSelectedEdge}
                    title="Присоединить комментарий ГОСТ к центру этой связи"
                  >
                    💬 Комментарий
                  </button>
                </>
              )}

              <button
                className="mini-btn mini-btn-del"
                onClick={deleteSelected}
                title="Удалить выбранное (Del)"
              >
                🗑 Удалить
              </button>
            </div>
          )}

          {/* Быстрый редактор текста прямо поверх блока или связи на холсте */}
          {inlineEditor.open && (
            <div
              className="inline-editor-box"
              style={{ left: inlineEditor.x, top: inlineEditor.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="text-[11px] font-semibold text-sky-400">
                Редактирование текста (Ctrl+Enter — сохранить)
              </div>
              <textarea
                autoFocus
                value={inlineEditor.text}
                onChange={(e) => setInlineEditor((prev) => ({ ...prev, text: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setInlineEditor((prev) => ({ ...prev, open: false }));
                  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    saveInlineEditor();
                  }
                }}
                placeholder="Введите текст..."
              />
              <div className="flex justify-end gap-1.5">
                <button
                  className="btn"
                  onClick={() => setInlineEditor((prev) => ({ ...prev, open: false }))}
                >
                  Отмена
                </button>
                <button className="btn btn-primary" onClick={saveInlineEditor}>
                  Сохранить (Ctrl+Enter)
                </button>
              </div>
            </div>
          )}

          {/* Окно редактирования штампа ГОСТ 2.104-68 */}
          {stampModalOpen && (
            <div className="stamp-modal-box" onMouseDown={(e) => e.stopPropagation()}>
              <div className="font-bold text-xs text-sky-400 mb-1">
                Основная надпись (Штамп ГОСТ 2.104-68 / ЕСПД)
              </div>
              <div className="stamp-field">
                <label>Название работы / Тема (по центру штампа):</label>
                <input
                  type="text"
                  value={gostStampData.title}
                  onChange={(e) =>
                    setGostStampData((prev) => ({ ...prev, title: e.target.value }))
                  }
                />
              </div>
              <div className="stamp-field">
                <label>Наименование документа (верхняя строка):</label>
                <input
                  type="text"
                  value={gostStampData.doc}
                  onChange={(e) =>
                    setGostStampData((prev) => ({ ...prev, doc: e.target.value }))
                  }
                />
              </div>
              <div className="stamp-field">
                <label>Обозначение (шифр документа ЕСПД):</label>
                <input
                  type="text"
                  value={gostStampData.code}
                  onChange={(e) =>
                    setGostStampData((prev) => ({ ...prev, code: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="stamp-field">
                  <label>Разработал (Студент):</label>
                  <input
                    type="text"
                    value={gostStampData.author}
                    onChange={(e) =>
                      setGostStampData((prev) => ({ ...prev, author: e.target.value }))
                    }
                  />
                </div>
                <div className="stamp-field">
                  <label>Проверил (Преподаватель):</label>
                  <input
                    type="text"
                    value={gostStampData.teacher}
                    onChange={(e) =>
                      setGostStampData((prev) => ({ ...prev, teacher: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="stamp-field">
                <label>Группа / Кафедра:</label>
                <input
                  type="text"
                  value={gostStampData.group}
                  onChange={(e) =>
                    setGostStampData((prev) => ({ ...prev, group: e.target.value }))
                  }
                />
              </div>
              <div className="flex justify-end gap-1.5 mt-2">
                <button className="btn" onClick={() => setStampModalOpen(false)}>
                  Закрыть
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setShowGostFrame(true);
                    setStampModalOpen(false);
                    pushHistory(nodes, edges, nextId, code, true, gostStampData);
                  }}
                >
                  Применить и включить рамку
                </button>
              </div>
            </div>
          )}

          {/* ГЛАВНЫЙ SVG-ХОЛСТ ЧЕРТЕЖА */}
          <svg id="svgCanvas" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker
                id="arrowHead"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="var(--shape-stroke)" />
              </marker>
            </defs>

            <g
              ref={viewportGroupRef}
              id="viewportGroup"
              transform={`translate(${panX}, ${panY}) scale(${scale})`}
            >
              {/* СЛОЙ 1: Чертёжная рамка и штамп ГОСТ */}
              <g ref={gostFrameLayerRef} id="gostFrameLayer">
                {gostFrameGeometry && (
                  <g
                    className="gost-sheet-group"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setStampModalOpen(true);
                    }}
                  >
                    <rect
                      x={gostFrameGeometry.sheetX}
                      y={gostFrameGeometry.sheetY}
                      width={gostFrameGeometry.sheetW}
                      height={gostFrameGeometry.sheetH}
                      className="gost-frame-outer"
                    />
                    <rect
                      x={gostFrameGeometry.inX}
                      y={gostFrameGeometry.inY}
                      width={gostFrameGeometry.inW}
                      height={gostFrameGeometry.inH}
                      className="gost-frame-inner"
                    />
                    <rect
                      x={gostFrameGeometry.stX}
                      y={gostFrameGeometry.stY}
                      width={gostFrameGeometry.stW}
                      height={gostFrameGeometry.stH}
                      className="gost-stamp-box"
                    />
                    <line
                      x1={gostFrameGeometry.stX}
                      y1={gostFrameGeometry.rowHeaderY}
                      x2={gostFrameGeometry.stX + gostFrameGeometry.stW}
                      y2={gostFrameGeometry.rowHeaderY}
                      className="gost-stamp-line"
                    />
                    <line
                      x1={gostFrameGeometry.col1X}
                      y1={gostFrameGeometry.rowHeaderY}
                      x2={gostFrameGeometry.col1X}
                      y2={gostFrameGeometry.stY + gostFrameGeometry.stH}
                      className="gost-stamp-line"
                    />
                    <line
                      x1={gostFrameGeometry.col2X}
                      y1={gostFrameGeometry.rowHeaderY}
                      x2={gostFrameGeometry.col2X}
                      y2={gostFrameGeometry.stY + gostFrameGeometry.stH}
                      className="gost-stamp-line"
                    />
                    <line
                      x1={gostFrameGeometry.colRoleX}
                      y1={gostFrameGeometry.rowHeaderY}
                      x2={gostFrameGeometry.colRoleX}
                      y2={gostFrameGeometry.stY + gostFrameGeometry.stH}
                      className="gost-stamp-thin"
                    />
                    <line
                      x1={gostFrameGeometry.stX}
                      y1={gostFrameGeometry.rowMid1Y}
                      x2={gostFrameGeometry.col1X}
                      y2={gostFrameGeometry.rowMid1Y}
                      className="gost-stamp-thin"
                    />
                    <line
                      x1={gostFrameGeometry.stX}
                      y1={gostFrameGeometry.rowMid2Y}
                      x2={gostFrameGeometry.col1X}
                      y2={gostFrameGeometry.rowMid2Y}
                      className="gost-stamp-thin"
                    />
                    <line
                      x1={gostFrameGeometry.col2X}
                      y1={gostFrameGeometry.rowMid1Y}
                      x2={gostFrameGeometry.stX + gostFrameGeometry.stW}
                      y2={gostFrameGeometry.rowMid1Y}
                      className="gost-stamp-thin"
                    />
                    <line
                      x1={gostFrameGeometry.col2X}
                      y1={gostFrameGeometry.rowMid2Y}
                      x2={gostFrameGeometry.stX + gostFrameGeometry.stW}
                      y2={gostFrameGeometry.rowMid2Y}
                      className="gost-stamp-thin"
                    />

                    <text
                      x={gostFrameGeometry.stX + gostFrameGeometry.stW / 2}
                      y={gostFrameGeometry.stY + 19}
                      fontSize="12"
                      fontWeight="700"
                      textAnchor="middle"
                      className="gost-stamp-text"
                    >
                      {gostStampData.doc} · {gostStampData.code}
                    </text>

                    <text
                      x={gostFrameGeometry.stX + 8}
                      y={gostFrameGeometry.stY + 45}
                      fontSize="11"
                      className="gost-stamp-text"
                    >
                      Разраб.
                    </text>
                    <text
                      x={gostFrameGeometry.colRoleX + 8}
                      y={gostFrameGeometry.stY + 45}
                      fontSize="11"
                      fontWeight="600"
                      className="gost-stamp-text"
                    >
                      {gostStampData.author}
                    </text>

                    <text
                      x={gostFrameGeometry.stX + 8}
                      y={gostFrameGeometry.stY + 70}
                      fontSize="11"
                      className="gost-stamp-text"
                    >
                      Пров.
                    </text>
                    <text
                      x={gostFrameGeometry.colRoleX + 8}
                      y={gostFrameGeometry.stY + 70}
                      fontSize="11"
                      fontWeight="600"
                      className="gost-stamp-text"
                    >
                      {gostStampData.teacher}
                    </text>

                    <text
                      x={gostFrameGeometry.stX + 8}
                      y={gostFrameGeometry.stY + 95}
                      fontSize="11"
                      className="gost-stamp-text"
                    >
                      Группа
                    </text>
                    <text
                      x={gostFrameGeometry.colRoleX + 8}
                      y={gostFrameGeometry.stY + 95}
                      fontSize="11"
                      fontWeight="600"
                      className="gost-stamp-text"
                    >
                      {gostStampData.group}
                    </text>

                    <text
                      x={gostFrameGeometry.centerBoxMidX}
                      y={gostFrameGeometry.stY + 70}
                      fontSize="14"
                      fontWeight="700"
                      textAnchor="middle"
                      className="gost-stamp-text"
                    >
                      {gostStampData.title}
                    </text>

                    <text
                      x={gostFrameGeometry.rightBoxMidX}
                      y={gostFrameGeometry.stY + 45}
                      fontSize="11"
                      textAnchor="middle"
                      className="gost-stamp-text"
                    >
                      Лист 1
                    </text>
                    <text
                      x={gostFrameGeometry.rightBoxMidX}
                      y={gostFrameGeometry.stY + 70}
                      fontSize="10.5"
                      textAnchor="middle"
                      className="gost-stamp-text"
                    >
                      {gostStampData.date}
                    </text>
                    <text
                      x={gostFrameGeometry.rightBoxMidX}
                      y={gostFrameGeometry.stY + 95}
                      fontSize="10.5"
                      fontWeight="600"
                      textAnchor="middle"
                      className="gost-stamp-text"
                    >
                      ГОСТ 19.701
                    </text>
                  </g>
                )}
              </g>

              {/* СЛОЙ 2: Ортогональные связи по ГОСТ 19.701-90 */}
              <g ref={edgesLayerRef} id="edgesLayer">
                {edges.map((e) => {
                  const pts = cachedEdgePts.get(e.id);
                  if (!pts || pts.length < 2) return null;

                  const pathD = pts
                    .map((pt, idx) => (idx === 0 ? `M ${pt.x} ${pt.y}` : `L ${pt.x} ${pt.y}`))
                    .join(' ');
                  const mid = getPolylineMidpoint(pts);
                  const p1 = pts[0];
                  const isSel = e.id === selectedEdgeId;

                  const rLines = e.rightLabel ? e.rightLabel.split('\n') : [];
                  const sourceNode = nodes.find(n => n.id === e.from);
                  const labelPosition = getBranchLabelPosition(pts, e.rightLabel, sourceNode, 'left', nodes);
                  const leftLabelPosition = getBranchLabelPosition(pts, e.leftLabel, sourceNode, 'right', nodes);
                  const baseX = labelPosition.x;
                  const anchor = 'middle' as const;
                  const startLy = labelPosition.y - (rLines.length - 1) * 9;

                  return (
                    <g
                      key={e.id}
                      className={`flow-edge ${isSel ? 'selected' : ''}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setInlineEditor((prev) => ({ ...prev, open: false }));
                        setSelectedEdgeId(e.id);
                        setSelectedNodeIds(new Set());
                      }}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedEdgeId(e.id);
                        setSelectedNodeIds(new Set());
                        setTimeout(() => openInlineEditor(), 10);
                      }}
                    >
                      <path d={pathD} className="flow-edge-hit" />
                      <path
                        d={pathD}
                        className="flow-edge-line"
                        strokeDasharray={e.style === 'dashed' ? '6,5' : undefined}
                        markerEnd={e.style === 'dashed' || e.toEdge || nodes.some(n => n.id === e.to && n.type === 'connector' && !n.text.trim() && n.w <= 8) ? undefined : 'url(#arrowHead)'}
                      />

                      {/* Draw.io-стиль: перетаскивание любого сегмента 1-к-1 за мышью и кнопка + для добавления изгиба */}
                      {e.style !== 'comm_link' &&
                        e.style !== 'control_transfer' &&
                        pts.slice(0, -1).map((a, i) => {
                          const b = pts[i + 1];
                          const segLen = Math.hypot(b.x - a.x, b.y - a.y);
                          if (segLen < 16) return null;
                          const isVert = Math.abs(a.x - b.x) <= Math.abs(a.y - b.y);
                          const smx = Math.round((a.x + b.x) / 2);
                          const smy = Math.round((a.y + b.y) / 2);

                          // Position for the "+" add-bend button (offset slightly along segment when selected)
                          const addBtnX = isVert ? smx : Math.round(a.x + (b.x - a.x) * 0.28);
                          const addBtnY = isVert ? Math.round(a.y + (b.y - a.y) * 0.28) : smy;

                          if (isVert) {
                            return (
                              <g key={`seg-${i}`}>
                                <line
                                  x1={a.x}
                                  y1={a.y}
                                  x2={b.x}
                                  y2={b.y}
                                  className="edge-seg-drag-v"
                                  onMouseDown={(ev) => startDragEdgeSegment(e.id, i, pts, ev)}
                                  onDoubleClick={(ev) => {
                                    ev.stopPropagation();
                                    handleAddBendOnSegment(e.id, i, pts, ev);
                                  }}
                                />
                                <rect
                                  x={smx - 4}
                                  y={smy - 9}
                                  width={8}
                                  height={18}
                                  rx={4}
                                  className="edge-elbow-pill"
                                  style={{ cursor: 'ew-resize' }}
                                  onMouseDown={(ev) => startDragEdgeSegment(e.id, i, pts, ev)}
                                  onDoubleClick={(ev) => {
                                    ev.stopPropagation();
                                    resetSelectedEdgeBends(e.id);
                                  }}
                                >
                                  <title>Потяните сегмент влево/вправо (двойной клик — выпрямить)</title>
                                </rect>
                                {isSel && segLen >= 44 && (
                                  <g
                                    className="edge-add-bend-btn"
                                    transform={`translate(${addBtnX}, ${addBtnY})`}
                                    onMouseDown={(ev) => ev.stopPropagation()}
                                    onClick={(ev) => handleAddBendOnSegment(e.id, i, pts, ev)}
                                  >
                                    <circle r={6.5} />
                                    <path d="M -3.2 0 L 3.2 0 M 0 -3.2 L 0 3.2" />
                                    <title>Кликните, чтобы добавить точку изгиба на этом участке</title>
                                  </g>
                                )}
                              </g>
                            );
                          }

                          return (
                            <g key={`seg-${i}`}>
                              <line
                                x1={a.x}
                                y1={a.y}
                                x2={b.x}
                                y2={b.y}
                                className="edge-seg-drag-h"
                                onMouseDown={(ev) => startDragEdgeSegment(e.id, i, pts, ev)}
                                onDoubleClick={(ev) => {
                                  ev.stopPropagation();
                                  handleAddBendOnSegment(e.id, i, pts, ev);
                                }}
                              />
                              <rect
                                x={smx - 9}
                                y={smy - 4}
                                width={18}
                                height={8}
                                rx={4}
                                className="edge-elbow-pill"
                                style={{ cursor: 'ns-resize' }}
                                onMouseDown={(ev) => startDragEdgeSegment(e.id, i, pts, ev)}
                                onDoubleClick={(ev) => {
                                  ev.stopPropagation();
                                  resetSelectedEdgeBends(e.id);
                                }}
                              >
                                <title>Потяните сегмент вверх/вниз (двойной клик — выпрямить)</title>
                              </rect>
                              {isSel && segLen >= 44 && (
                                <g
                                  className="edge-add-bend-btn"
                                  transform={`translate(${addBtnX}, ${addBtnY})`}
                                  onMouseDown={(ev) => ev.stopPropagation()}
                                  onClick={(ev) => handleAddBendOnSegment(e.id, i, pts, ev)}
                                >
                                  <circle r={6.5} />
                                  <path d="M -3.2 0 L 3.2 0 M 0 -3.2 L 0 3.2" />
                                  <title>Кликните, чтобы добавить точку изгиба на этом участке</title>
                                </g>
                              )}
                            </g>
                          );
                        })}

                      {/* Угловые вершины изгиба (◉): потяните в любую сторону или кликните для удаления изгиба */}
                      {e.style !== 'comm_link' &&
                        e.style !== 'control_transfer' &&
                        pts.slice(1, -1).map((cornerPt, idx) => {
                          const cornerIndex = idx + 1;
                          return (
                            <circle
                              key={`corner-${cornerIndex}`}
                              cx={cornerPt.x}
                              cy={cornerPt.y}
                              r={5.5}
                              className="edge-corner-handle"
                              onMouseDown={(ev) =>
                                startDragEdgeCorner(e.id, cornerIndex, pts, ev)
                              }
                              onContextMenu={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                handleRemoveEdgeCorner(
                                  e.id,
                                  cornerIndex,
                                  pts,
                                  e.style || 'ortho'
                                );
                              }}
                            >
                              <title>
                                Точка изгиба: потяните мышью в любую сторону или кликните один раз для удаления изгиба
                              </title>
                            </circle>
                          );
                        })}

                      {e.style === 'control_transfer' && (
                        <polygon
                          points={`${mid.x - 9},${mid.y - 7} ${mid.x + 9},${mid.y - 7} ${mid.x},${
                            mid.y + 9
                          }`}
                          className="flow-shape"
                        />
                      )}

                      {e.leftLabel && (
                        <text
                          x={leftLabelPosition.x}
                          y={leftLabelPosition.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="edge-label-text"
                        >
                          {e.leftLabel}
                        </text>
                      )}

                      {rLines.map((ln, idx) => (
                        <text
                          key={idx}
                          x={baseX}
                          y={startLy + idx * 18}
                          textAnchor={anchor}
                          dominantBaseline="middle"
                          className="edge-label-text"
                          fontWeight="600"
                        >
                          {ln}
                        </text>
                      ))}

                      {/* Центральная точка врезки другой стрелки */}
                      <circle
                        cx={mid.x}
                        cy={mid.y}
                        className="edge-port-dot"
                        onMouseDown={(ev) => startConnectFromEdge(e.id, ev)}
                        onMouseUp={(ev) => finishConnectToEdge(e.id, ev)}
                      />

                      {/* Перетаскиваемые маркеры НАЧАЛА и КОНЦА стрелки для быстрого переподключения */}
                      <circle
                        cx={pts[0].x}
                        cy={pts[0].y}
                        r={6.5}
                        className="edge-endpoint-handle edge-endpoint-start"
                        onMouseDown={(ev) => startReconnectEdgeEnd(e.id, 'from', pts, ev)}
                      >
                        <title>Потяните, чтобы перенести НАЧАЛО стрелки к любому блоку или линии</title>
                      </circle>
                      <circle
                        cx={pts[pts.length - 1].x}
                        cy={pts[pts.length - 1].y}
                        r={6.5}
                        className="edge-endpoint-handle edge-endpoint-end"
                        onMouseDown={(ev) => startReconnectEdgeEnd(e.id, 'to', pts, ev)}
                      >
                        <title>Потяните, чтобы перенести КОНЕЦ стрелки к любому блоку или линии</title>
                      </circle>
                    </g>
                  );
                })}
              </g>

              {/* СЛОЙ 3: Блоки ГОСТ 19.701-90 */}
              <g ref={nodesLayerRef} id="nodesLayer">
                {nodes.map((n) => {
                  const isSel = selectedNodeIds.has(n.id);
                  const isLineLinked =
                    activeEditorLine !== null &&
                    n.type !== 'brace' &&
                    Boolean(n.sourceLines?.includes(activeEditorLine));
                  const hasGostError = rightTab === 'validator' && errorNodeIds.has(n.id);
                  const hasGostWarn =
                    rightTab === 'validator' && !hasGostError && warnNodeIds.has(n.id);

                  const x = n.cx - n.w / 2;
                  const y = n.y;
                  const w = n.w;
                  const h = n.h;
                  const lines = String(n.text || '').split('\n');
                  const lineHeight = 18;
                  const totalTextH = (lines.length - 1) * lineHeight;
                  const startTextY = y + h / 2 - totalTextH / 2 + 4;
                  const gostNum = options.gostNumbers ? gostNodeNumbers.get(n.id) : undefined;

                  return (
                    <g
                      key={n.id}
                      className={`flow-node ${isSel ? 'selected' : ''} ${
                        isLineLinked ? 'line-linked' : ''
                      } ${hasGostError ? 'gost-error-node' : ''} ${
                        hasGostWarn ? 'gost-warn-node' : ''
                      }`}
                      onMouseDown={(ev) => startDragNode(n.id, ev)}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        openInlineEditor(n.id);
                      }}
                    >
                      {gostNum !== undefined && (
                        <text x={x + 2} y={y - 6} className="flow-gost-num">
                          {gostNum}
                        </text>
                      )}

                      {/* Отрисовка геометрии 24 символов ГОСТ 19.701-90 */}
                      {n.type === 'terminator' && (
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          rx={Math.min(w / 2, h / 2)}
                          ry={Math.min(w / 2, h / 2)}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'predefined' && (
                        <>
                          <rect x={x} y={y} width={w} height={h} className="flow-shape" />
                          <line
                            x1={x + 16}
                            y1={y}
                            x2={x + 16}
                            y2={y + h}
                            className="flow-shape"
                          />
                          <line
                            x1={x + w - 16}
                            y1={y}
                            x2={x + w - 16}
                            y2={y + h}
                            className="flow-shape"
                          />
                        </>
                      )}
                      {n.type === 'process' && (
                        <rect x={x} y={y} width={w} height={h} className="flow-shape" />
                      )}
                      {n.type === 'manual_op' && (
                        <polygon
                          points={`${x},${y} ${x + w},${y} ${x + w - 18},${y + h} ${x + 18},${
                            y + h
                          }`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'prep' && (
                        <polygon
                          points={`${x + 20},${y} ${x + w - 20},${y} ${x + w},${y + h / 2} ${
                            x + w - 20
                          },${y + h} ${x + 20},${y + h} ${x},${y + h / 2}`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'decision' && (
                        <polygon
                          points={`${n.cx},${y} ${x + w},${y + h / 2} ${n.cx},${y + h} ${x},${
                            y + h / 2
                          }`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'parallel' && (
                        <>
                          <rect x={x} y={y} width={w} height={h} className="flow-comment-hit" />
                          <line
                            x1={x}
                            y1={y + 6}
                            x2={x + w}
                            y2={y + 6}
                            className="flow-shape"
                          />
                          <line
                            x1={x}
                            y1={y + h - 6}
                            x2={x + w}
                            y2={y + h - 6}
                            className="flow-shape"
                          />
                        </>
                      )}
                      {n.type === 'loop_start' && (
                        <polygon
                          points={`${x + 16},${y} ${x + w - 16},${y} ${x + w},${y + 16} ${
                            x + w
                          },${y + h} ${x},${y + h} ${x},${y + 16}`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'loop_end' && (
                        <polygon
                          points={`${x},${y} ${x + w},${y} ${x + w},${y + h - 16} ${
                            x + w - 16
                          },${y + h} ${x + 16},${y + h} ${x},${y + h - 16}`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'striped_process' && (
                        <>
                          <rect x={x} y={y} width={w} height={h} className="flow-shape" />
                          <line
                            x1={x}
                            y1={y + 16}
                            x2={x + w}
                            y2={y + 16}
                            className="flow-shape"
                          />
                        </>
                      )}
                      {n.type === 'io' && (
                        <polygon
                          points={`${x + Math.max(18, Math.min(28, Math.round(h * 0.28)))},${y} ${
                            x + w
                          },${y} ${
                            x + w - Math.max(18, Math.min(28, Math.round(h * 0.28)))
                          },${y + h} ${x},${y + h}`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'stored_data' && (
                        <path
                          d={`M ${x + 18} ${y} L ${x + w} ${y} Q ${x + w - 18} ${y + h / 2} ${
                            x + w
                          } ${y + h} L ${x + 18} ${y + h} Q ${x - 9} ${y + h / 2} ${
                            x + 18
                          } ${y} Z`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'ram' && (
                        <>
                          <rect x={x} y={y} width={w} height={h} className="flow-shape" />
                          <line
                            x1={x + 14}
                            y1={y}
                            x2={x + 14}
                            y2={y + h}
                            className="flow-shape"
                          />
                          <line
                            x1={x}
                            y1={y + 12}
                            x2={x + w}
                            y2={y + 12}
                            className="flow-shape"
                          />
                        </>
                      )}
                      {n.type === 'seq_storage' && (
                        <>
                          <circle
                            cx={n.cx}
                            cy={y + h / 2}
                            r={Math.min(w, h) / 2}
                            className="flow-shape"
                          />
                          <line
                            x1={n.cx}
                            y1={y + h / 2 + Math.min(w, h) / 2}
                            x2={n.cx + Math.min(w, h) / 2 + 10}
                            y2={y + h / 2 + Math.min(w, h) / 2}
                            className="flow-shape"
                          />
                        </>
                      )}
                      {n.type === 'direct_storage' && (
                        <>
                          <path
                            d={`M ${x + 14} ${y} L ${x + w - 14} ${y} A 14 ${h / 2} 0 0 1 ${
                              x + w - 14
                            } ${y + h} L ${x + 14} ${y + h} A 14 ${h / 2} 0 0 1 ${
                              x + 14
                            } ${y} Z`}
                            className="flow-shape"
                          />
                          <ellipse
                            cx={x + w - 14}
                            cy={y + h / 2}
                            rx={14}
                            ry={h / 2}
                            className="flow-shape"
                          />
                        </>
                      )}
                      {n.type === 'document' && (
                        <path
                          d={`M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h - 8} Q ${
                            x + w * 0.75
                          } ${y + h + 8} ${n.cx} ${y + h - 8} Q ${x + w * 0.25} ${y + h - 18} ${x} ${
                            y + h - 8
                          } Z`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'manual_input' && (
                        <polygon
                          points={`${x},${y + 16} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'card' && (
                        <polygon
                          points={`${x + 18},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h} ${x},${
                            y + 18
                          }`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'paper_tape' && (
                        <path
                          d={`M ${x} ${y + 6} Q ${x + w * 0.25} ${y - 4} ${n.cx} ${y + 6} Q ${
                            x + w * 0.75
                          } ${y + 16} ${x + w} ${y + 6} L ${x + w} ${y + h - 6} Q ${
                            x + w * 0.75
                          } ${y + h + 4} ${n.cx} ${y + h - 6} Q ${x + w * 0.25} ${y + h - 16} ${x} ${
                            y + h - 6
                          } Z`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'display' && (
                        <path
                          d={`M ${x + 22} ${y} L ${x + w - 22} ${y} A 22 ${h / 2} 0 0 1 ${
                            x + w - 22
                          } ${y + h} L ${x + 22} ${y + h} Q ${x + 6} ${y + h * 0.75} ${x} ${
                            y + h / 2
                          } Q ${x + 6} ${y + h * 0.25} ${x + 22} ${y} Z`}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'comment' && (
                        <>
                          <rect x={x} y={y} width={w} height={h} className="flow-comment-hit" />
                          <path
                            d={`M ${x + 16} ${y} L ${x} ${y} L ${x} ${y + h} L ${x + 16} ${y + h}`}
                            className="flow-comment-bracket"
                          />
                        </>
                      )}
                      {n.type === 'connector' && (
                        <circle
                          cx={n.cx}
                          cy={y + h / 2}
                          r={Math.min(w, h) / 2}
                          className="flow-shape"
                        />
                      )}
                      {n.type === 'omission' && (
                        <>
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            rx={4}
                            className="flow-brace-box"
                          />
                          <text
                            x={n.cx}
                            y={y + h / 2}
                            fontSize="24"
                            fontWeight="bold"
                            className="flow-brace-svg-text"
                          >
                            {n.text.trim() || '...'}
                          </text>
                        </>
                      )}
                      {n.type === 'brace' && (
                        <>
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            rx={4}
                            className="flow-brace-box"
                          />
                          <text
                            x={n.cx}
                            y={y + h / 2}
                            fontSize={Math.max(22, Math.round(h * 0.78))}
                            className="flow-brace-svg-text"
                          >
                            {n.text.trim() || '{'}
                          </text>
                        </>
                      )}

                      {/* Текст внутри блока */}
                      {n.type !== 'brace' &&
                        n.type !== 'omission' &&
                        lines.map((ln, idx) =>
                          n.type === 'comment' ? (
                            <text
                              key={idx}
                              x={x + 12}
                              y={startTextY + idx * lineHeight}
                              className="flow-text-left"
                            >
                              {ln}
                            </text>
                          ) : (
                            <text
                              key={idx}
                              x={n.cx}
                              y={startTextY + idx * lineHeight}
                              className="flow-text"
                            >
                              {ln}
                            </text>
                          )
                        )}

                      {/* Порты соединения */}
                      {n.type !== 'brace' &&
                        (['top', 'bottom', 'left', 'right'] as PortSide[]).map((p) => {
                          const pt = getPortCoords(n, p);
                          return (
                            <circle
                              key={p}
                              cx={pt.x}
                              cy={pt.y}
                              className="port-dot"
                              onMouseDown={(ev) => startConnect(n.id, p, ev)}
                              onMouseUp={(ev) => finishConnect(n.id, p, ev)}
                            />
                          );
                        })}

                      {/* Ручка масштабирования */}
                      <rect
                        x={x + w - 5}
                        y={y + h - 5}
                        width={10}
                        height={10}
                        rx={2}
                        className="resize-handle"
                        onMouseDown={(ev) => startResizeNode(n.id, ev)}
                      />
                    </g>
                  );
                })}
              </g>

              {/* СЛОЙ 4: Лазерные направляющие выравнивания */}
              <g id="smartGuidesLayer">
                {activeLaserGuides.map((g, idx) => (
                  <g key={idx}>
                    <line
                      x1={g.x1}
                      y1={g.y1}
                      x2={g.x2}
                      y2={g.y2}
                      className="laser-guide-line"
                    />
                    <circle cx={g.x1} cy={g.y1} r={3.5} className="laser-guide-dot" />
                    <circle cx={g.x2} cy={g.y2} r={3.5} className="laser-guide-dot" />
                  </g>
                ))}
              </g>

              {/* Рамка мультивыделения (Shift + ЛКМ) */}
              {marquee && (
                <rect
                  x={Math.min(marquee.startX, marquee.curX)}
                  y={Math.min(marquee.startY, marquee.curY)}
                  width={Math.abs(marquee.curX - marquee.startX)}
                  height={Math.abs(marquee.curY - marquee.startY)}
                  className="marquee-box"
                />
              )}

              {/* Временная линия при протягивании новой связи или переподключении конца стрелки */}
              {connectingFrom && (
                <polyline
                  points={computeOrthogonalPoints(
                    nodes,
                    { x: connectingFrom.x, y: connectingFrom.y },
                    connectingFrom.port,
                    { x: connectingFrom.curX, y: connectingFrom.curY },
                    snapPreview?.port || 'top',
                    'ortho'
                  )
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="2.2"
                  strokeDasharray="6,4"
                  markerEnd="url(#arrowHead)"
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {reconnectingEdge && (
                <polyline
                  points={computeOrthogonalPoints(
                    nodes,
                    reconnectingEdge.end === 'from'
                      ? { x: reconnectingEdge.curX, y: reconnectingEdge.curY }
                      : { x: reconnectingEdge.fixedX, y: reconnectingEdge.fixedY },
                    reconnectingEdge.end === 'from'
                      ? snapPreview?.port || 'bottom'
                      : reconnectingEdge.fixedPort,
                    reconnectingEdge.end === 'to'
                      ? { x: reconnectingEdge.curX, y: reconnectingEdge.curY }
                      : { x: reconnectingEdge.fixedX, y: reconnectingEdge.fixedY },
                    reconnectingEdge.end === 'to'
                      ? snapPreview?.port || 'top'
                      : reconnectingEdge.fixedPort,
                    'ortho'
                  )
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="2.4"
                  strokeDasharray="6,4"
                  markerEnd="url(#arrowHead)"
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {snapPreview && (
                <g style={{ pointerEvents: 'none' }}>
                  <circle
                    cx={snapPreview.point.x}
                    cy={snapPreview.point.y}
                    r={10}
                    className="snap-target-ring"
                  />
                  <circle
                    cx={snapPreview.point.x}
                    cy={snapPreview.point.y}
                    r={4.5}
                    fill="#0284c7"
                  />
                </g>
              )}
            </g>
          </svg>

          {/* Нижний левый пульт масштабирования */}
          <div className="canvas-controls" role="group" aria-label="Масштаб схемы">
            <button
              className="btn" aria-label="Увеличить схему"
              onClick={() => setScale((s) => Math.min(2.5, Math.max(0.2, s * 1.15)))}
            >
              <ZoomIn size={16} />
            </button>
            <button
              className="btn" aria-label="Уменьшить схему"
              onClick={() => setScale((s) => Math.min(2.5, Math.max(0.2, s * 0.85)))}
            >
              <ZoomOut size={16} />
            </button>
            <button className="btn" onClick={() => centerDiagram(nodes, edges)}>
              По центру
            </button>
            <span className="canvas-gesture-hint">
              <b>Shift + ЛКМ</b> — рамка · <b>Двойной клик</b> — текст
            </span>
          </div>

          {/* Нижний правый индикатор координат кульмана и статуса синхронизации */}
          <div className="canvas-coords-bar tabular-nums" role="status" aria-live="polite">
            {statusToast && (
              <span className="text-sky-400 font-sans font-semibold mr-2">
                {statusToast}
              </span>
            )}
            <span>
              X: {cursorMm.x} мм · Y: {cursorMm.y} мм
            </span>
            <span>·</span>
            <span>Масштаб: {Math.round(scale * 100)}%</span>
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА: 4 БЛОКА ПАЛИТРЫ ГОСТ (24 ФИГУРЫ) И ИНСПЕКТОР НОРМОКОНТРОЛЯ */}
        <RightPaletteAndValidator
          activeTab={rightTab}
          onChangeTab={setRightTab}
          onAddManualNode={handleAddManualNode}
          issues={gostIssues}
          onFocusIssue={handleFocusGostIssue}
          onFixIssue={handleFixSingleGostIssue}
          onFixAllIssues={handleFixAllGostIssues}
          totalNodesCount={nodes.filter((n) => n.type !== 'brace').length}
        />
      </div>
    </div>
  );
}
