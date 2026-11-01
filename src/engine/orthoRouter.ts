import { EdgeStyle, FlowEdge, FlowNode, GostNodeType, LaserGuide, PortSide } from '../types/flow';

export interface Point {
  x: number;
  y: number;
}

export function resetRoutingTracks() {
  routeCache = null;
}

export function calcAutoSize(type: GostNodeType, text: string): { w: number; h: number } {
  const lines = String(text || '').split('\n');
  const maxChars = Math.max(...lines.map((l) => l.length), 6);

  if (type === 'brace') return { w: 34, h: 38 };
  if (type === 'omission') return { w: 50, h: 36 };
  if (type === 'connector') return { w: 44, h: 44 };
  if (type === 'seq_storage') return { w: 66, h: 66 };
  if (type === 'parallel') return { w: Math.max(160, maxChars * 8 + 40), h: 28 };
  if (type === 'terminator') return { w: Math.max(150, maxChars * 9 + 40), h: 62 };
  if (type === 'predefined' || type === 'ram' || type === 'striped_process') {
    return { w: Math.max(160, maxChars * 8.5 + 48), h: Math.max(54, lines.length * 20 + 28) };
  }
  if (type === 'comment') {
    const w = Math.max(140, maxChars * 8 + 26);
    const h = Math.max(44, lines.length * 20 + 18);
    return { w, h };
  }
  if (type === 'io') {
    const h = Math.max(60, lines.length * 20 + 28);
    const skew = Math.max(18, Math.min(28, Math.round(h * 0.28)));
    const w = Math.max(170, Math.round(maxChars * 7.8 + skew * 2 + 34));
    return { w, h };
  }
  if (type === 'manual_op' || type === 'stored_data' || type === 'direct_storage' || type === 'display') {
    const w = Math.max(160, maxChars * 7.8 + 56);
    const h = Math.max(60, lines.length * 20 + 28);
    return { w, h };
  }
  if (type === 'prep') {
    const w = Math.max(175, maxChars * 8.2 + 56);
    const h = Math.max(58, lines.length * 20 + 28);
    return { w, h };
  }
  if (type === 'decision') {
    const w = Math.max(175, maxChars * 8.6 + 68);
    const h = Math.max(72, lines.length * 20 + 42);
    return { w, h };
  }
  const w = Math.max(155, maxChars * 8 + 34);
  const h = Math.max(54, lines.length * 20 + 26);
  return { w, h };
}

export function getPortCoords(node: FlowNode, port: PortSide): Point {
  // Invisible topology junctions are points, not miniature block borders.
  if (node.type === 'connector' && !node.text.trim() && node.w <= 8 && node.h <= 8) {
    return { x: node.cx, y: node.y + node.h / 2 };
  }
  const left = node.cx - node.w / 2;
  const right = node.cx + node.w / 2;
  const top = node.y;
  const bottom = node.y + node.h;
  const midY = node.y + node.h / 2;

  if (port === 'top') return { x: node.cx, y: top };
  if (port === 'bottom') return { x: node.cx, y: bottom };
  if (port === 'left') return { x: left, y: midY };
  if (port === 'right') return { x: right, y: midY };
  return { x: node.cx, y: bottom };
}

export function getPolylineMidpoint(pts: Point[] | null): Point {
  if (!pts || pts.length === 0) return { x: 300, y: 100 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };

  let totalLen = 0;
  const segs: { p1: Point; p2: Point; len: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push({ p1: pts[i], p2: pts[i + 1], len });
    totalLen += len;
  }

  if (totalLen < 1) return { x: pts[0].x, y: pts[0].y };
  const half = totalLen / 2;
  let acc = 0;
  for (const s of segs) {
    if (acc + s.len >= half) {
      const t = (half - acc) / (s.len || 1);
      return {
        x: Math.round(s.p1.x + (s.p2.x - s.p1.x) * t),
        y: Math.round(s.p1.y + (s.p2.y - s.p1.y) * t),
      };
    }
    acc += s.len;
  }
  return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
}

/** Label center in canvas coordinates (SVG text-anchor="middle"). */
export function getBranchLabelPosition(points: Point[], label: string, sourceNode?: FlowNode | null, side: 'left' | 'right' = 'left', obstacles: FlowNode[] = []): Point {
  const halfW = Math.max(12, label.length * 7.5 / 2 + 5), halfH = 11;
  const blocked = (p: Point) => {
    if (obstacles.some(n => n.type !== 'brace' && n.type !== 'comment' && !isJunction(n) && p.x + halfW > n.cx-n.w/2 && p.x-halfW < n.cx+n.w/2 && p.y+halfH > n.y && p.y-halfH < n.y+n.h)) return true;
    if (sourceNode && p.x + halfW > sourceNode.cx-sourceNode.w/2 && p.x-halfW < sourceNode.cx+sourceNode.w/2 &&
      p.y+halfH > sourceNode.y && p.y-halfH < sourceNode.y+sourceNode.h) return true;
    const rect: FlowNode={id:'label',type:'comment',text:label,cx:p.x,y:p.y-halfH,w:halfW*2,h:halfH*2};
    return points.slice(1).some((b,i)=>segmentHitsNode(points[i],b,rect,3));
  };
  const preferredSign=side==='left'?-1:1;
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1],dx=b.x-a.x,dy=b.y-a.y,len=Math.abs(dx)+Math.abs(dy);
    if(len<1) continue;
    for(const fraction of [Math.min(.5,Math.max(halfW+12,32)/len),.5,.75]) {
      for(const sign of [preferredSign,-preferredSign]) {
        const p={x:a.x+dx*fraction+(dx===0?sign*(halfW+9):0), y:a.y+dy*fraction+(dy===0?sign*(halfH+9):0)};
        if(!blocked(p)) return p;
      }
    }
  }
  // Very short segments may have no adjacent space; search outside the source.
  const origin=points[0] || {x:0,y:0};
  for(let distance=40;distance<=400;distance+=20) {
    for(const sign of [preferredSign,-preferredSign]) {
      const p={x:origin.x+sign*(distance+halfW),y:origin.y-distance};
      if(!blocked(p)) return p;
    }
  }
  return {x:origin.x+halfW+20,y:origin.y-halfH-20};
}

function getSpanBoundsInYRange(
  nodes: FlowNode[],
  y1: number,
  y2: number,
  refX = 320,
  fnId: string | null = null
) {
  const yMin = Math.min(y1, y2) - 12;
  const yMax = Math.max(y1, y2) + 12;
  let minLeft = Infinity;
  let maxRight = -Infinity;

  nodes.forEach((nd) => {
    if (nd.type === 'comment') return;
    if (fnId && nd.fnId && nd.fnId !== fnId) return;
    if (!fnId && Math.abs(nd.cx - refX) > 2000) return;

    if (nd.y + nd.h >= yMin && nd.y <= yMax) {
      minLeft = Math.min(minLeft, nd.cx - nd.w / 2);
      maxRight = Math.max(maxRight, nd.cx + nd.w / 2);
    }
  });

  if (minLeft === Infinity) {
    minLeft = refX - 100;
    maxRight = refX + 100;
  }

  return { minLeft, maxRight };
}

export function simplifyOrthogonalPolyline(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const dedup: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = dedup[dedup.length - 1];
    const cur = pts[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.5) {
      dedup.push(cur);
    }
  }
  if (dedup.length <= 2) return dedup;
  const out: Point[] = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1];
    const b = dedup[i];
    const c = dedup[i + 1];
    const collinearX = Math.abs(a.x - b.x) < 1 && Math.abs(b.x - c.x) < 1;
    const collinearY = Math.abs(a.y - b.y) < 1 && Math.abs(b.y - c.y) < 1;
    if (!collinearX && !collinearY) {
      out.push(b);
    }
  }
  out.push(dedup[dedup.length - 1]);
  return out;
}

export function getLineAnchor(points: Point[], point: Point): { segment: number; ratio: number } {
  let best = { segment: 0, ratio: 0.5 }, distance = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    if (!length) continue;
    const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    const d = Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy);
    if (d < distance) { distance = d; best = { segment: i, ratio }; }
  }
  return best;
}

export function getLineAnchorPoint(points: Point[], anchor?: FlowEdge['fromAnchor']): Point {
  if (!anchor || points.length < 2) return getPolylineMidpoint(points);
  const i = Math.max(0, Math.min(points.length - 2, anchor.segment));
  const t = Math.max(0, Math.min(1, anchor.ratio));
  return { x: points[i].x + (points[i+1].x - points[i].x) * t, y: points[i].y + (points[i+1].y - points[i].y) * t };
}

/**
 * Ensures that a user-defined list of interior waypoints forms a strictly 90-degree
 * orthogonal path between p1 (at fromPort) and p2 (at toPort), smoothly adapting the
 * first and last corners when connected blocks are moved on the canvas.
 */
function buildPolylineFromWaypoints(
  p1: Point,
  fromPort: PortSide,
  p2: Point,
  toPort: PortSide,
  waypoints: Point[]
): Point[] {
  const wps = waypoints.map((w) => ({ x: Math.round(w.x), y: Math.round(w.y) }));
  if (wps.length === 0) return [p1, p2];

  if (wps.length === 1) {
    const w = wps[0];
    const isFromVert = fromPort === 'top' || fromPort === 'bottom';
    const isToVert = toPort === 'top' || toPort === 'bottom';
    const isFromHoriz = fromPort === 'left' || fromPort === 'right';
    const isToHoriz = toPort === 'left' || toPort === 'right';

    if (isFromVert && isToHoriz) {
      return simplifyOrthogonalPolyline([p1, { x: p1.x, y: p2.y }, p2]);
    }
    if (isFromHoriz && isToVert) {
      return simplifyOrthogonalPolyline([p1, { x: p2.x, y: p1.y }, p2]);
    }
    if (Math.abs(w.x - p1.x) <= Math.abs(w.y - p1.y)) {
      return simplifyOrthogonalPolyline([p1, { x: p1.x, y: w.y }, { x: p2.x, y: w.y }, p2]);
    }
    return simplifyOrthogonalPolyline([p1, { x: w.x, y: p1.y }, { x: w.x, y: p2.y }, p2]);
  }

  // For 2 or more waypoints, keep the first segment (p1 -> wps[0]) and last segment (wps[last] -> p2)
  // perpendicular to the adjacent interior segment so moving blocks never creates diagonal lines.
  const firstNext = wps[1];
  const firstSegHoriz = Math.abs(wps[0].y - firstNext.y) <= Math.abs(wps[0].x - firstNext.x);
  if (firstSegHoriz) {
    wps[0].x = p1.x;
  } else {
    wps[0].y = p1.y;
  }

  const lastIdx = wps.length - 1;
  const lastPrev = wps[lastIdx - 1];
  const lastSegHoriz = Math.abs(wps[lastIdx].y - lastPrev.y) <= Math.abs(wps[lastIdx].x - lastPrev.x);
  if (lastSegHoriz) {
    wps[lastIdx].x = p2.x;
  } else {
    wps[lastIdx].y = p2.y;
  }

  // Repair any non-orthogonal interior pair if needed
  const full: Point[] = [p1];
  for (let i = 0; i < wps.length; i++) {
    const prev = full[full.length - 1];
    const cur = wps[i];
    if (Math.abs(prev.x - cur.x) >= 1 && Math.abs(prev.y - cur.y) >= 1) {
      full.push({ x: cur.x, y: prev.y });
    }
    full.push(cur);
  }
  const lastPt = full[full.length - 1];
  if (Math.abs(lastPt.x - p2.x) >= 1 && Math.abs(lastPt.y - p2.y) >= 1) {
    full.push({ x: p2.x, y: lastPt.y });
  }
  full.push(p2);

  return simplifyOrthogonalPolyline(full);
}

/**
 * Draw.io-style 1:1 segment dragging: moves the grabbed segment directly to mousePt
 * without any track-repulsion jumping. Returns the new interior waypoints array.
 */
export function dragOrthogonalSegment(
  initialPts: Point[],
  segIndex: number,
  mousePt: Point,
  fromPort: PortSide = 'bottom',
  toPort: PortSide = 'top'
): Point[] {
  if (!initialPts || initialPts.length < 2) return [];
  const gx = Math.round(mousePt.x / 5) * 5;
  const gy = Math.round(mousePt.y / 5) * 5;

  const pStart = initialPts[0];
  const pEnd = initialPts[initialPts.length - 1];

  // If the arrow is currently a single straight 2-point line [pStart, pEnd]
  if (initialPts.length === 2) {
    const isVert = Math.abs(pStart.x - pEnd.x) <= Math.abs(pStart.y - pEnd.y);
    if (isVert) {
      if (Math.abs(gx - pStart.x) < 5) return [];
      const dirY = pEnd.y >= pStart.y ? 1 : -1;
      const yOut = Math.round(pStart.y + dirY * 20);
      const yIn = Math.round(pEnd.y - dirY * 20);
      const poly = simplifyOrthogonalPolyline([
        pStart,
        { x: pStart.x, y: yOut },
        { x: gx, y: yOut },
        { x: gx, y: yIn },
        { x: pEnd.x, y: yIn },
        pEnd,
      ]);
      return poly.slice(1, -1);
    } else {
      if (Math.abs(gy - pStart.y) < 5) return [];
      const dirX = pEnd.x >= pStart.x ? 1 : -1;
      const xOut = Math.round(pStart.x + dirX * 20);
      const xIn = Math.round(pEnd.x - dirX * 20);
      const poly = simplifyOrthogonalPolyline([
        pStart,
        { x: xOut, y: pStart.y },
        { x: xOut, y: gy },
        { x: xIn, y: gy },
        { x: xIn, y: pEnd.y },
        pEnd,
      ]);
      return poly.slice(1, -1);
    }
  }

  const pts = initialPts.map((p) => ({ ...p }));
  const idx = Math.max(0, Math.min(pts.length - 2, segIndex));
  const a = pts[idx];
  const b = pts[idx + 1];
  const isVert = Math.abs(a.x - b.x) <= Math.abs(a.y - b.y);

  // Case 1: Interior segment (neither endpoint is pinned to pStart or pEnd) -> pure 1:1 shift
  if (idx > 0 && idx < pts.length - 2) {
    if (isVert) {
      pts[idx].x = gx;
      pts[idx + 1].x = gx;
    } else {
      pts[idx].y = gy;
      pts[idx + 1].y = gy;
    }
    return simplifyOrthogonalPolyline(pts).slice(1, -1);
  }

  // Case 2: First segment (anchored at pStart)
  if (idx === 0) {
    const stubDir =
      fromPort === 'bottom'
        ? 1
        : fromPort === 'top'
        ? -1
        : fromPort === 'right'
        ? 1
        : -1;
    if (isVert) {
      const stubY = Math.round(pStart.y + (fromPort === 'top' || fromPort === 'bottom' ? stubDir * 20 : b.y >= pStart.y ? 20 : -20));
      const nextPts = [
        pStart,
        { x: pStart.x, y: stubY },
        { x: gx, y: stubY },
        { x: gx, y: b.y },
        ...pts.slice(2),
      ];
      return simplifyOrthogonalPolyline(nextPts).slice(1, -1);
    } else {
      const stubX = Math.round(pStart.x + (fromPort === 'left' || fromPort === 'right' ? stubDir * 20 : b.x >= pStart.x ? 20 : -20));
      const nextPts = [
        pStart,
        { x: stubX, y: pStart.y },
        { x: stubX, y: gy },
        { x: b.x, y: gy },
        ...pts.slice(2),
      ];
      return simplifyOrthogonalPolyline(nextPts).slice(1, -1);
    }
  }

  // Case 3: Last segment (anchored at pEnd)
  const stubDirEnd =
    toPort === 'bottom'
      ? 1
      : toPort === 'top'
      ? -1
      : toPort === 'right'
      ? 1
      : -1;
  if (isVert) {
    const stubY = Math.round(pEnd.y + (toPort === 'top' || toPort === 'bottom' ? stubDirEnd * 20 : a.y <= pEnd.y ? -20 : 20));
    const nextPts = [
      ...pts.slice(0, idx),
      { x: gx, y: a.y },
      { x: gx, y: stubY },
      { x: pEnd.x, y: stubY },
      pEnd,
    ];
    return simplifyOrthogonalPolyline(nextPts).slice(1, -1);
  } else {
    const stubX = Math.round(pEnd.x + (toPort === 'left' || toPort === 'right' ? stubDirEnd * 20 : a.x <= pEnd.x ? -20 : 20));
    const nextPts = [
      ...pts.slice(0, idx),
      { x: a.x, y: gy },
      { x: stubX, y: gy },
      { x: stubX, y: pEnd.y },
      pEnd,
    ];
    return simplifyOrthogonalPolyline(nextPts).slice(1, -1);
  }
}

/**
 * Draw.io-style 2D corner vertex dragging: moves corner `cornerIndex` (1 .. initialPts.length - 2)
 * to (gx, gy) while keeping adjacent segments orthogonal.
 */
export function dragOrthogonalCorner(
  initialPts: Point[],
  cornerIndex: number,
  mousePt: Point,
  style: EdgeStyle = 'ortho'
): Point[] {
  if (!initialPts || initialPts.length < 3) return [];
  const gx = Math.round(mousePt.x / 5) * 5;
  const gy = Math.round(mousePt.y / 5) * 5;

  if (style === 'straight') {
    const copy = initialPts.map((p) => ({ ...p }));
    if (cornerIndex >= 1 && cornerIndex <= copy.length - 2) {
      copy[cornerIndex] = { x: gx, y: gy };
    }
    return copy.slice(1, -1);
  }

  const pts = initialPts.map((p) => ({ ...p }));
  const cIdx = Math.max(1, Math.min(pts.length - 2, cornerIndex));
  const prev = pts[cIdx - 1];
  const curr = pts[cIdx];
  const next = pts[cIdx + 1];

  const prevIsHoriz = Math.abs(prev.y - curr.y) <= Math.abs(prev.x - curr.x);
  const nextIsHoriz = Math.abs(next.y - curr.y) <= Math.abs(next.x - curr.x);

  pts[cIdx] = { x: gx, y: gy };

  let prefixInsert: Point | null = null;
  let suffixInsert: Point | null = null;

  if (cIdx - 1 > 0) {
    if (prevIsHoriz) {
      pts[cIdx - 1].y = gy;
    } else {
      pts[cIdx - 1].x = gx;
    }
  } else {
    // cIdx - 1 === 0 (pinned start port)
    if (prevIsHoriz && Math.abs(gy - prev.y) >= 5) {
      const stubX = Math.round((prev.x + gx) / 2 / 5) * 5;
      prefixInsert = { x: stubX, y: prev.y };
      pts[cIdx] = { x: stubX, y: gy };
      if (cIdx + 1 < pts.length - 1 && !nextIsHoriz) {
        pts[cIdx + 1].y = gy;
      }
    } else if (!prevIsHoriz && Math.abs(gx - prev.x) >= 5) {
      const stubY = Math.round((prev.y + gy) / 2 / 5) * 5;
      prefixInsert = { x: prev.x, y: stubY };
      pts[cIdx] = { x: gx, y: stubY };
      if (cIdx + 1 < pts.length - 1 && nextIsHoriz) {
        pts[cIdx + 1].x = gx;
      }
    }
  }

  if (cIdx + 1 < pts.length - 1) {
    if (nextIsHoriz) {
      pts[cIdx + 1].y = gy;
    } else {
      pts[cIdx + 1].x = gx;
    }
  } else {
    // cIdx + 1 === pts.length - 1 (pinned end port)
    if (nextIsHoriz && Math.abs(gy - next.y) >= 5) {
      const stubX = Math.round((next.x + gx) / 2 / 5) * 5;
      suffixInsert = { x: stubX, y: next.y };
      pts[cIdx] = { x: stubX, y: gy };
    } else if (!nextIsHoriz && Math.abs(gx - next.x) >= 5) {
      const stubY = Math.round((next.y + gy) / 2 / 5) * 5;
      suffixInsert = { x: next.x, y: stubY };
      pts[cIdx] = { x: gx, y: stubY };
    }
  }

  const rebuilt: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === cIdx && prefixInsert) rebuilt.push(prefixInsert);
    rebuilt.push(pts[i]);
    if (i === cIdx && suffixInsert) rebuilt.push(suffixInsert);
  }

  return simplifyOrthogonalPolyline(rebuilt).slice(1, -1);
}

/**
 * Inserts a new orthogonal bend (step) on segment `segIndex` when the user clicks
 * the `+` button on a segment or in the toolbar.
 */
export function insertBendOnSegment(
  pts: Point[],
  segIndex: number,
  clickPt?: Point,
  style: EdgeStyle = 'ortho'
): Point[] {
  if (!pts || pts.length < 2) return [];
  const idx = Math.max(0, Math.min(pts.length - 2, segIndex));
  const a = pts[idx];
  const b = pts[idx + 1];
  const mx = Math.round(((clickPt ? clickPt.x : (a.x + b.x) / 2)) / 5) * 5;
  const my = Math.round(((clickPt ? clickPt.y : (a.y + b.y) / 2)) / 5) * 5;

  if (style === 'straight') {
    const next = [...pts.slice(0, idx + 1), { x: mx, y: my + 20 }, ...pts.slice(idx + 1)];
    return next.slice(1, -1);
  }

  const isVert = Math.abs(a.x - b.x) <= Math.abs(a.y - b.y);
  const jog = 30;
  if (isVert) {
    const yMid1 = Math.round((a.y + my) / 2 / 5) * 5;
    const yMid2 = Math.round((my + b.y) / 2 / 5) * 5;
    const inserted: Point[] = [
      ...pts.slice(0, idx + 1),
      { x: a.x, y: yMid1 },
      { x: a.x + jog, y: yMid1 },
      { x: a.x + jog, y: yMid2 },
      { x: b.x, y: yMid2 },
      ...pts.slice(idx + 1),
    ];
    return simplifyOrthogonalPolyline(inserted).slice(1, -1);
  } else {
    const xMid1 = Math.round((a.x + mx) / 2 / 5) * 5;
    const xMid2 = Math.round((mx + b.x) / 2 / 5) * 5;
    const inserted: Point[] = [
      ...pts.slice(0, idx + 1),
      { x: xMid1, y: a.y },
      { x: xMid1, y: a.y + jog },
      { x: xMid2, y: a.y + jog },
      { x: xMid2, y: b.y },
      ...pts.slice(idx + 1),
    ];
    return simplifyOrthogonalPolyline(inserted).slice(1, -1);
  }
}

/**
 * Removes an interior corner vertex `cornerIndex` (1 .. pts.length - 2) when clicked/double-clicked,
 * collapsing that bend while maintaining orthogonal geometry.
 */
export function removeOrthogonalCorner(
  pts: Point[],
  cornerIndex: number,
  style: EdgeStyle = 'ortho'
): Point[] | undefined {
  if (!pts || pts.length <= 3) return undefined;
  const cIdx = Math.max(1, Math.min(pts.length - 2, cornerIndex));

  if (style === 'straight') {
    const next = pts.filter((_, i) => i !== cIdx);
    const wps = next.slice(1, -1);
    return wps.length > 0 ? wps : undefined;
  }

  // If 4 points (Z-shape [p0, c1, c2, p3]), collapsing either corner produces a 1-corner L-shape
  if (pts.length === 4) {
    const p0 = pts[0];
    const p3 = pts[3];
    if (Math.abs(p0.x - p3.x) < 3 || Math.abs(p0.y - p3.y) < 3) {
      return undefined;
    }
    const corner = cIdx === 1 ? { x: p0.x, y: p3.y } : { x: p3.x, y: p0.y };
    return [corner];
  }

  const copy = pts.map((p) => ({ ...p }));

  if (cIdx === 1) {
    // First interior corner after p0: collapse step (c1 -> c2) onto p0's line
    const p0 = copy[0];
    const c1 = copy[1];
    const firstIsHoriz = Math.abs(p0.y - c1.y) <= Math.abs(p0.x - c1.x);
    if (firstIsHoriz) {
      copy[1].y = p0.y;
      if (copy.length > 3) copy[2].y = p0.y;
    } else {
      copy[1].x = p0.x;
      if (copy.length > 3) copy[2].x = p0.x;
    }
  } else if (cIdx === copy.length - 2) {
    // Last interior corner before pEnd: collapse step onto pEnd's line
    const pEnd = copy[copy.length - 1];
    const cLast = copy[cIdx];
    const lastIsHoriz = Math.abs(pEnd.y - cLast.y) <= Math.abs(pEnd.x - cLast.x);
    if (lastIsHoriz) {
      copy[cIdx].y = pEnd.y;
      if (cIdx - 1 >= 1) copy[cIdx - 1].y = pEnd.y;
    } else {
      copy[cIdx].x = pEnd.x;
      if (cIdx - 1 >= 1) copy[cIdx - 1].x = pEnd.x;
    }
  } else {
    // Interior corner: collapse the deflected bar back to copy[cIdx - 1]
    const prev = copy[cIdx - 1];
    const curr = copy[cIdx];
    const prevIsHoriz = Math.abs(prev.y - curr.y) <= Math.abs(prev.x - curr.x);
    if (prevIsHoriz) {
      // prev -> curr is horizontal, curr -> next is vertical deflection
      const targetY = cIdx >= 2 ? copy[cIdx - 2].y : prev.y;
      copy[cIdx - 1].y = targetY;
      copy[cIdx].y = targetY;
    } else {
      // prev -> curr is vertical, curr -> next is horizontal deflection
      const targetX = cIdx >= 2 ? copy[cIdx - 2].x : prev.x;
      copy[cIdx - 1].x = targetX;
      copy[cIdx].x = targetX;
    }
  }

  const simplified = simplifyOrthogonalPolyline(copy).slice(1, -1);
  return simplified.length > 0 ? simplified : undefined;
}

function preferredOrthogonalPoints(
  nodes: FlowNode[],
  p1: Point,
  fromPort: PortSide,
  p2: Point,
  toPort: PortSide,
  style: EdgeStyle,
  bendOffset = 0,
  fromNode: FlowNode | null = null,
  toNode: FlowNode | null = null,
  _edgeId = 'temp',
  bendOffsetY = 0,
  waypoints?: Point[]
): Point[] {
  if (style === 'comm_link') {
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    return [p1, { x: mx - 8, y: my - 6 }, { x: mx + 8, y: my + 6 }, p2];
  }

  if (style === 'control_transfer') {
    return [p1, p2];
  }

  if (style === 'straight') {
    if (waypoints && waypoints.length > 0) {
      return [p1, ...waypoints, p2];
    }
    return [p1, p2];
  }

  // If the edge has explicit user waypoints, use them directly (1:1 draw.io behavior, zero auto-jumping)
  if (waypoints && waypoints.length > 0) {
    return buildPolylineFromWaypoints(p1, fromPort, p2, toPort, waypoints);
  }

  const fnScope = (fromNode && fromNode.fnId) || (toNode && toNode.fnId) || null;

  // Final return on the function axis needs no exterior jump channel. Keep
  // branch returns outside intervening blocks and preserve manual bends.
  if (style === 'bypass_right' && fromPort === 'bottom' &&
      /^return\b/.test(fromNode?.text.trim() || '') && isJunction(toNode) &&
      bendOffset === 0 && bendOffsetY === 0 && Math.abs(p1.x - p2.x) < .01 && p2.y > p1.y &&
      !nodes.some(n => n.id !== fromNode?.id && n.id !== toNode?.id &&
        n.type !== 'brace' && n.type !== 'comment' && !isJunction(n) && segmentHitsNode(p1, p2, n))) {
    return [p1, p2];
  }

  if (style === 'loop_left') {
    const bounds = getSpanBoundsInYRange(nodes, p1.y, p2.y, p2.x, fnScope);
    const leftX = Math.min(bounds.minLeft, p1.x, p2.x) - BASE_MARGIN + bendOffset;
    const downY = Math.round(p1.y + BASE_MARGIN + bendOffsetY);
    const topY = Math.round(p2.y + bendOffsetY);

    if (fromPort === 'bottom') {
      return simplifyOrthogonalPolyline([
        p1,
        { x: p1.x, y: downY },
        { x: leftX, y: downY },
        { x: leftX, y: topY },
        { x: p2.x, y: topY },
        p2,
      ]);
    }
    return simplifyOrthogonalPolyline([p1, { x: leftX, y: p1.y }, { x: leftX, y: topY }, p2]);
  }

  if (style === 'bypass_right') {
    const bounds = getSpanBoundsInYRange(nodes, p1.y, p2.y, p1.x, fnScope);
    const rightX = Math.max(bounds.maxRight, p1.x, p2.x) + BASE_MARGIN + bendOffset;
    const startY = Math.round(p1.y + (fromPort === 'bottom' ? 24 : fromPort === 'top' ? -24 : 0) + bendOffsetY);
    const endY = Math.round(p2.y + (toPort === 'top' ? -24 : toPort === 'bottom' ? 24 : 0));
    return simplifyOrthogonalPolyline([p1, {x:p1.x,y:startY}, { x: rightX, y: startY }, { x: rightX, y: endY }, {x:p2.x,y:endY}, p2]);
  }

  const isFromVert = fromPort === 'top' || fromPort === 'bottom';
  const isToVert = toPort === 'top' || toPort === 'bottom';
  const isFromHoriz = fromPort === 'left' || fromPort === 'right';
  const isToHoriz = toPort === 'left' || toPort === 'right';

  if (fromPort === 'edge' && toPort === 'edge') {
    if (Math.abs(p1.x - p2.x) < 3 && bendOffset === 0) return [p1, p2];
    const midX = Math.round((p1.x + p2.x) / 2) + bendOffset;
    return simplifyOrthogonalPolyline([p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2]);
  }

  if (fromPort === 'edge') {
    if (isToHoriz) {
      if (Math.abs(p1.y - p2.y) < 3 && bendOffset === 0 && bendOffsetY === 0) return [p1, p2];
      const midX = Math.round((p1.x + p2.x) / 2) + bendOffset;
      return simplifyOrthogonalPolyline([p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2]);
    } else {
      if (Math.abs(p1.x - p2.x) < 3 && bendOffset === 0) return [p1, p2];
      const trackX = p2.x + bendOffset;
      return simplifyOrthogonalPolyline([p1, { x: trackX, y: p1.y }, { x: trackX, y: p2.y }, p2]);
    }
  }

  if (toPort === 'edge') {
    if (isFromHoriz) {
      if (Math.abs(p1.y - p2.y) < 3 && bendOffset === 0) return [p1, p2];
      const midX = Math.round((p1.x + p2.x) / 2) + bendOffset;
      return simplifyOrthogonalPolyline([p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2]);
    } else {
      if (Math.abs(p1.x - p2.x) < 3 && bendOffset === 0 && bendOffsetY === 0) return [p1, p2];
      const trackY = p2.y + bendOffsetY;
      return simplifyOrthogonalPolyline([p1, { x: p1.x, y: trackY }, { x: p2.x, y: trackY }, p2]);
    }
  }

  // Case 1: Vertical to Vertical (e.g. bottom -> top) — strict draw.io straight or Z/U-shape
  if (isFromVert && isToVert) {
    const needsUpwardDetour =
      (fromPort === 'bottom' && toPort === 'top' && p2.y <= p1.y + 8) ||
      (fromPort === 'top' && toPort === 'bottom' && p2.y >= p1.y - 8);

    if (Math.abs(p1.x - p2.x) < 3 && bendOffset === 0 && !needsUpwardDetour) {
      return [p1, p2];
    }

    if (needsUpwardDetour || (Math.abs(p1.x - p2.x) < 3 && bendOffset !== 0)) {
      if (needsUpwardDetour) {
        const sideDir = p2.x < p1.x ? -1 : 1;
        const detourX =
          (sideDir < 0 ? Math.min(p1.x, p2.x) - 60 : Math.max(p1.x, p2.x) + 60) + bendOffset;
        const yOut = p1.y + (fromPort === 'bottom' ? 24 : -24) + bendOffsetY;
        const yIn = p2.y + (toPort === 'top' ? -24 : 24);
        return simplifyOrthogonalPolyline([
          p1,
          { x: p1.x, y: yOut },
          { x: detourX, y: yOut },
          { x: detourX, y: yIn },
          { x: p2.x, y: yIn },
          p2,
        ]);
      }
      const detourX = p1.x + bendOffset;
      const yOut = p1.y + (fromPort === 'bottom' ? 20 : -20);
      const yIn = p2.y + (toPort === 'top' ? -20 : 20);
      return simplifyOrthogonalPolyline([
        p1,
        { x: p1.x, y: yOut },
        { x: detourX, y: yOut },
        { x: detourX, y: yIn },
        { x: p2.x, y: yIn },
        p2,
      ]);
    }

    const midY = Math.round((p1.y + p2.y) / 2) + bendOffsetY + (bendOffsetY === 0 ? bendOffset : 0);
    return simplifyOrthogonalPolyline([p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2]);
  }

  // Case 2: Horizontal to Horizontal (e.g. right -> left) — strict draw.io straight or Z-shape
  if (isFromHoriz && isToHoriz) {
    const dir1 = fromPort === 'right' ? 1 : -1;
    const backwards = (dir1 === 1 && p2.x <= p1.x + 8) || (dir1 === -1 && p2.x >= p1.x - 8);

    if (Math.abs(p1.y - p2.y) < 3 && bendOffset === 0 && bendOffsetY === 0 && !backwards) {
      return [p1, p2];
    }

    if (backwards || bendOffsetY !== 0) {
      const xOut = p1.x + dir1 * 26 + bendOffset;
      const xIn = p2.x + (toPort === 'left' ? -26 : 26);
      const bridgeY = Math.min(p1.y, p2.y) - 44 + bendOffsetY;
      return simplifyOrthogonalPolyline([
        p1,
        { x: xOut, y: p1.y },
        { x: xOut, y: bridgeY },
        { x: xIn, y: bridgeY },
        { x: xIn, y: p2.y },
        p2,
      ]);
    }

    const midX = Math.round((p1.x + p2.x) / 2) + bendOffset;
    return simplifyOrthogonalPolyline([p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2]);
  }

  // Case 3: Horizontal to Vertical (e.g. left/right of decision -> top of branch block) — clean L-shape
  if (isFromHoriz && isToVert) {
    const dir = fromPort === 'right' ? 1 : -1;
    const forwardHoriz = (dir === 1 && p2.x >= p1.x + 8) || (dir === -1 && p2.x <= p1.x - 8);
    const forwardVert =
      (toPort === 'top' && p2.y >= p1.y - 4) || (toPort === 'bottom' && p2.y <= p1.y + 4);

    if (forwardHoriz && forwardVert && bendOffset === 0 && bendOffsetY === 0) {
      return simplifyOrthogonalPolyline([p1, { x: p2.x, y: p1.y }, p2]);
    }

    const stepOutX = forwardHoriz
      ? p2.x + bendOffset
      : p1.x + dir * Math.max(32, Math.abs(bendOffset));
    const midY =
      (toPort === 'top'
        ? Math.min(p2.y - 24, Math.round((p1.y + p2.y) / 2))
        : Math.max(p2.y + 24, Math.round((p1.y + p2.y) / 2))) + bendOffsetY;
    return simplifyOrthogonalPolyline([
      p1,
      { x: stepOutX, y: p1.y },
      { x: stepOutX, y: midY },
      { x: p2.x, y: midY },
      p2,
    ]);
  }

  // Case 4: Vertical to Horizontal (e.g. bottom of branch -> left/right of connector) — clean L-shape
  if (isFromVert && isToHoriz) {
    const vDir = fromPort === 'bottom' ? 1 : -1;
    const forwardVert = (vDir === 1 && p2.y >= p1.y + 8) || (vDir === -1 && p2.y <= p1.y - 8);
    const forwardHoriz =
      (toPort === 'left' && p2.x >= p1.x - 4) || (toPort === 'right' && p2.x <= p1.x + 4);

    if (forwardVert && forwardHoriz && bendOffset === 0 && bendOffsetY === 0) {
      return simplifyOrthogonalPolyline([p1, { x: p1.x, y: p2.y }, p2]);
    }

    const targetY =
      Math.round((p1.y + p2.y) / 2) + bendOffsetY + (bendOffsetY === 0 ? bendOffset : 0);
    const approachX = (toPort === 'left' ? p2.x - 28 : p2.x + 28) + bendOffset;
    return simplifyOrthogonalPolyline([
      p1,
      { x: p1.x, y: targetY },
      { x: approachX, y: targetY },
      { x: approachX, y: p2.y },
      p2,
    ]);
  }

  return [p1, p2];
}

export const BASE_MARGIN = 28;
export const TRACK_GAP = 22;
const CHANNEL_GAP = TRACK_GAP;
export interface LoopRoutingScope {
  headId: string; entryId: string; joinId: string; conditionId?: string;
  nodeIds: string[]; loopTrackIndex: number;
  minBodyX: number; maxBodyX: number; returnTrackX: number; bypassTrackX: number;
}

/** Bounded reachability keeps sibling branches and function exit collectors out
 * of a loop's body. Compute children first, then propagate their full channels. */
export function getLoopRoutingScopes(nodes: FlowNode[], edges: FlowEdge[]): LoopRoutingScope[] {
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const outgoing=new Map<string,FlowEdge[]>();
  edges.forEach(e=>{if(e.from) outgoing.set(e.from,[...(outgoing.get(e.from)||[]),e]);});
  const scopes: LoopRoutingScope[]=nodes.filter(n=>n.control?.kind==='loop'||n.control?.kind==='dowhile').map(head=>{
    const control=head.control!,exit=byId.get(control.joinId);
    const entry=control.kind==='dowhile'?head:byId.get(edges.find(e=>e.to===head.id&&e.style!=='loop_left')?.from||'')||head;
    const ids=new Set<string>([head.id,entry.id]);
    const queue=[control.bodyId,control.conditionId].filter(Boolean) as string[];
    while(queue.length) {
      const id=queue.pop()!;
      if(ids.has(id)||id===control.joinId) continue;
      const n=byId.get(id);
      if(!n||n.fnId!==head.fnId||n.y<entry.y||exit&&n.y>exit.y) continue;
      ids.add(id);
      for(const e of outgoing.get(id)||[]) if(e.to) queue.push(e.to);
    }
    const body=[...ids].map(id=>byId.get(id)!).filter(n=>n.type!=='brace'&&n.type!=='comment');
    return {headId:head.id,entryId:entry.id,joinId:control.joinId,conditionId:control.conditionId,nodeIds:[...ids],loopTrackIndex:0,
      minBodyX:Math.min(...body.map(n=>n.cx-n.w/2)),maxBodyX:Math.max(...body.map(n=>n.cx+n.w/2)),returnTrackX:0,bypassTrackX:0};
  });
  const complete=new Set<string>();
  const allocate=(scope:LoopRoutingScope,active=new Set<string>())=>{
    if(complete.has(scope.headId)||active.has(scope.headId)) return;
    active.add(scope.headId);
    const descendants=scopes.filter(child=>child!==scope&&scope.nodeIds.includes(child.headId)&&!child.nodeIds.includes(scope.headId));
    descendants.forEach(child=>allocate(child,new Set(active)));
    scope.loopTrackIndex=descendants.length?1+Math.max(...descendants.map(c=>c.loopTrackIndex)):0;
    scope.minBodyX=Math.min(scope.minBodyX,...descendants.map(c=>c.returnTrackX));
    scope.maxBodyX=Math.max(scope.maxBodyX,...descendants.map(c=>c.bypassTrackX));
    scope.returnTrackX=scope.minBodyX-BASE_MARGIN-scope.loopTrackIndex*TRACK_GAP;
    scope.bypassTrackX=scope.maxBodyX+BASE_MARGIN+scope.loopTrackIndex*TRACK_GAP;
    complete.add(scope.headId);
  };
  scopes.forEach(s=>allocate(s));
  return scopes.sort((a,b)=>a.loopTrackIndex-b.loopTrackIndex||a.headId.localeCompare(b.headId));
}
interface Track { a: Point; b: Point; edge: FlowEdge }
export function sharesCollector(a: FlowEdge, b: FlowEdge, nodes: FlowNode[], edges: FlowEdge[]): boolean {
  if (!a.to || a.to !== b.to || a.waypoints?.length || b.waypoints?.length) return false;
  const inlet=(e:FlowEdge)=>e.fromPort==='right'&&/^case\b/.test(nodes.find(n=>n.id===e.from)?.text||'');
  const sameKind=(a.style==='bypass_right'&&b.style==='bypass_right')||(inlet(a)&&inlet(b));
  return sameKind && isJunction(nodes.find(n => n.id === a.to) || null) && edges.filter(e => e.to === a.to && !e.waypoints?.length && (a.style==='bypass_right'?e.style==='bypass_right':inlet(e))).length > 1;
}
interface RoutingContext { tracks: Track[]; points: Map<string, Point[] | null>; scopes: LoopRoutingScope[] }
let routeCache: { signature: string; points: Map<string, Point[] | null> } | null = null;

function isJunction(n: FlowNode | null) {
  return !!n && n.type === 'connector' && !n.text.trim() && n.w <= 8 && n.h <= 8;
}

function segmentHitsNode(a: Point, b: Point, n: FlowNode, pad = 0) {
  const l = n.cx - n.w / 2 - pad, r = n.cx + n.w / 2 + pad;
  const t = n.y - pad, bot = n.y + n.h + pad;
  if (a.x === b.x) return a.x > l + .01 && a.x < r - .01 && Math.max(a.y,b.y) > t + .01 && Math.min(a.y,b.y) < bot - .01;
  if (a.y === b.y) return a.y > t + .01 && a.y < bot - .01 && Math.max(a.x,b.x) > l + .01 && Math.min(a.x,b.x) < r - .01;
  return true;
}

function portStub(p: Point, port: PortSide): Point {
  return { x: p.x + (port === 'left' ? -20 : port === 'right' ? 20 : 0), y: p.y + (port === 'top' ? -20 : port === 'bottom' ? 20 : 0) };
}

/** A rectilinear visibility-grid search. Both axis registries reserve 22px tracks.
 * Perpendicular crossings remain possible; only actual graph endpoints merge. */
function routeAroundObstacles(nodes: FlowNode[], preferred: Point[], p1: Point, fromPort: PortSide, p2: Point, toPort: PortSide,
  fromNode: FlowNode | null, toNode: FlowNode | null, tracks: Track[] = [], edge?: FlowEdge, style?: EdgeStyle): Point[] {
  const obstacles = nodes.filter(n => n.type !== 'comment' && n.type !== 'brace' && !isJunction(n));
  const relevantTracks = tracks;
  const clear = (a: Point, b: Point) => {
    if (a.x !== b.x && a.y !== b.y) return false;
    if (obstacles.some(n => segmentHitsNode(a,b,n))) return false;
    const vert = a.x === b.x;
    return !relevantTracks.some(t => {
      const tv = t.a.x === t.b.x;
      if (vert !== tv) return false;
      const overlap = vert ? Math.min(Math.max(a.y,b.y),Math.max(t.a.y,t.b.y))-Math.max(Math.min(a.y,b.y),Math.min(t.a.y,t.b.y))
        : Math.min(Math.max(a.x,b.x),Math.max(t.a.x,t.b.x))-Math.max(Math.min(a.x,b.x),Math.min(t.a.x,t.b.x));
      if (overlap <= .01) return false;
      const distance = vert ? Math.abs(a.x-t.a.x) : Math.abs(a.y-t.a.y);
      const clearance = edge?.style === 'bypass_right' && t.edge.style === 'bypass_right' ? 16 : CHANNEL_GAP;
      if (distance >= clearance-.01) return false;
      // The final/initial 20px stub may coincide only at an actual shared port.
      const near = (p:Point) => Math.abs(a.x-p.x)+Math.abs(a.y-p.y)<=CHANNEL_GAP && Math.abs(b.x-p.x)+Math.abs(b.y-p.y)<=CHANNEL_GAP;
      const sharedPort = (edge?.from && edge.from === t.edge.from && (isJunction(fromNode) || edge.fromPort === t.edge.fromPort) && near(p1)) ||
        (edge?.to && edge.to === t.edge.to && (isJunction(toNode) || edge.toPort === t.edge.toPort) && near(p2));
      return !(sharedPort && overlap <= CHANNEL_GAP && distance < .01);
    });
  };
  const s = portStub(p1, isJunction(fromNode) ? 'edge' : fromPort);
  const goal = portStub(p2, isJunction(toNode) ? 'edge' : toPort);
  const outward = (p: Point, next: Point, port: PortSide) => port === 'edge' ||
    (port === 'bottom' && next.x === p.x && next.y > p.y) || (port === 'top' && next.x === p.x && next.y < p.y) ||
    (port === 'right' && next.y === p.y && next.x > p.x) || (port === 'left' && next.y === p.y && next.x < p.x);
  if (preferred.length > 1 && outward(p1,preferred[1],isJunction(fromNode)?'edge':fromPort) &&
      outward(p2,preferred[preferred.length-2],isJunction(toNode)?'edge':toPort) && preferred.slice(1).every((b,i)=>clear(preferred[i],b))) return preferred;

  const xs = new Set<number>([s.x,goal.x,p1.x,p2.x]), ys = new Set<number>([s.y,goal.y,p1.y,p2.y]);
  const minX = Math.min(...preferred.map(p=>p.x),s.x,goal.x)-80, maxX = Math.max(...preferred.map(p=>p.x),s.x,goal.x)+80;
  const minY = Math.min(...preferred.map(p=>p.y),s.y,goal.y)-80, maxY = Math.max(...preferred.map(p=>p.y),s.y,goal.y)+80;
  xs.add(minX); xs.add(maxX); ys.add(minY); ys.add(maxY);
  preferred.forEach(p=>{xs.add(p.x);ys.add(p.y);});
  obstacles.forEach(n=>{
    if (n.cx+n.w/2 < minX || n.cx-n.w/2 > maxX || n.y+n.h < minY || n.y > maxY) return;
    xs.add(n.cx-n.w/2-CHANNEL_GAP); xs.add(n.cx+n.w/2+CHANNEL_GAP);
    ys.add(n.y-CHANNEL_GAP); ys.add(n.y+n.h+CHANNEL_GAP);
  });
  relevantTracks.forEach(t=>{
    if (t.a.x === t.b.x) { xs.add(t.a.x-CHANNEL_GAP); xs.add(t.a.x+CHANNEL_GAP); }
    else { ys.add(t.a.y-CHANNEL_GAP); ys.add(t.a.y+CHANNEL_GAP); }
  });
  const xx = [...xs].sort((a,b)=>a-b), yy = [...ys].sort((a,b)=>a-b), width = xx.length;
  const point = (key: number): Point => ({x:xx[key%width],y:yy[Math.floor(key/width)]});
  const start = yy.indexOf(s.y)*width+xx.indexOf(s.x), end = yy.indexOf(goal.y)*width+xx.indexOf(goal.x);
  // Heap entries include incoming axis, keeping bend penalties valid in A*.
  const heap: {key:number;cost:number;score:number}[] = [];
  const push = (entry: {key:number;cost:number;score:number}) => {
    heap.push(entry); let i=heap.length-1;
    while(i>0) { const parent=(i-1)>>1; if(heap[parent].score<=entry.score) break; heap[i]=heap[parent]; i=parent; } heap[i]=entry;
  };
  const pop = () => {
    const first=heap[0], last=heap.pop()!; if(heap.length) {let i=0; while(i*2+1<heap.length) {let j=i*2+1; if(j+1<heap.length && heap[j+1].score<heap[j].score) j++; if(heap[j].score>=last.score) break; heap[i]=heap[j]; i=j;} heap[i]=last;} return first;
  };
  const costs = new Map<number,number>(), previous = new Map<number,number>();
  // Outer loop/exit routes must actually use their requested exterior channel.
  const sideX = style==='loop_left' ? Math.min(...preferred.map(p=>p.x)) : style==='bypass_right' ? Math.max(...preferred.map(p=>p.x)) : null;
  const onSide = (p:Point) => sideX===null || (style==='loop_left' ? p.x<=sideX : p.x>=sideX);
  const middleY=(s.y+goal.y)/2;
  const initial=start*6+(sideX===null?3:0);
  push({key:initial,cost:0,score:0}); costs.set(initial,0);
  let final: number | undefined;
  while(heap.length) {
    const cur=pop(); if(cur.cost!==costs.get(cur.key)) continue;
    const cell=Math.floor(cur.key/6), axis=cur.key%3, seenSide=cur.key%6>=3, a=point(cell);
    if(cell===end && seenSide) {final=cur.key;break;}
    const x=cell%width,y=Math.floor(cell/width);
    for(const [nx,ny,nextAxis] of [[x-1,y,1],[x+1,y,1],[x,y-1,2],[x,y+1,2]]) {
      if(nx<0 || nx>=width || ny<0 || ny>=yy.length) continue;
      const nc=ny*width+nx,b=point(nc); if(!clear(a,b)) continue;
      const usesOuterChannel = sideX===null || (a.x===b.x && a.y!==b.y && onSide(a) && onSide(b) && Math.min(a.y,b.y)<=middleY && Math.max(a.y,b.y)>=middleY);
      const key=nc*6+nextAxis+(seenSide||usesOuterChannel?3:0),cost=cur.cost+Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+(axis && axis!==nextAxis?12:0);
      if(cost >= (costs.get(key)??Infinity)) continue;
      costs.set(key,cost); previous.set(key,cur.key);
      push({key,cost,score:cost+Math.abs(b.x-goal.x)+Math.abs(b.y-goal.y)});
    }
  }
  if(final === undefined) return preferred; // Impossible geometry remains visible to the validator.
  const reverse: Point[]=[];
  for(let key: number | undefined=final;key!==undefined;key=previous.get(key)) reverse.push(point(Math.floor(key/6)));
  return simplifyOrthogonalPolyline([p1,...reverse.reverse(),p2]);
}

export function computeOrthogonalPoints(nodes: FlowNode[],p1: Point,fromPort: PortSide,p2: Point,toPort: PortSide,style: EdgeStyle,
  bendOffset=0,fromNode: FlowNode|null=null,toNode: FlowNode|null=null,edgeId='temp',bendOffsetY=0,waypoints?: Point[]): Point[] {
  const preferred=preferredOrthogonalPoints(nodes,p1,fromPort,p2,toPort,style,bendOffset,fromNode,toNode,edgeId,bendOffsetY,waypoints);
  if(style==='straight' || style==='comm_link' || style==='control_transfer' || waypoints?.length) return preferred;
  return routeAroundObstacles(nodes,preferred,p1,fromPort,p2,toPort,fromNode,toNode,[],undefined,style);
}

function resolveEdgePoints(
  nodes: FlowNode[],
  edges: FlowEdge[],
  edge: FlowEdge,
  visited: Set<string>,
  context: RoutingContext
): Point[] | null {
  if(context.points.has(edge.id)) return context.points.get(edge.id)!;
  if (!edge || visited.has(edge.id)) return [{ x: 300, y: 100 }, { x: 300, y: 140 }];
  visited.add(edge.id);

  let p1: Point | null = null;
  let fromNode: FlowNode | null = null;
  let fromPort: PortSide = edge.fromPort || 'bottom';

  if (edge.fromEdge) {
    const parentEdge = edges.find((pe) => pe.id === edge.fromEdge);
    if (!parentEdge) return null;
    const parentPts = resolveEdgePoints(nodes, edges, parentEdge, new Set(visited), context);
    if (!parentPts) return null;
    p1 = getLineAnchorPoint(parentPts, edge.fromAnchor);
    fromPort = 'edge';
  } else {
    fromNode = nodes.find((n) => n.id === edge.from) || null;
    if (!fromNode) return null;
    p1 = getPortCoords(fromNode, fromPort);
  }

  let p2: Point | null = null;
  let toNode: FlowNode | null = null;
  let toPort: PortSide = edge.toPort || 'top';

  if (edge.toEdge) {
    const targetEdge = edges.find((te) => te.id === edge.toEdge);
    if (!targetEdge) return null;
    const targetPts = resolveEdgePoints(nodes, edges, targetEdge, new Set(visited), context);
    if (!targetPts) return null;
    p2 = getLineAnchorPoint(targetPts, edge.toAnchor);
    toPort = 'edge';
  } else {
    toNode = nodes.find((n) => n.id === edge.to) || null;
    if (!toNode) return null;
    p2 = getPortCoords(toNode, toPort);
  }

  // Automatic break connections follow the row/column after layout or dragging.
  // Explicit bends remain anchored to the user's chosen ports.
  if (!edge.waypoints?.length && !edge.bendOffset && !edge.bendOffsetY && edge.style !== 'dashed') {
    if (toNode && fromNode && /^break\s*;?$/.test(toNode.text.trim())) {
      const dx=fromNode.cx-toNode.cx;
      const dy=fromNode.y+fromNode.h/2-toNode.y-toNode.h/2;
      toPort=Math.abs(dy)<=Math.min(fromNode.h,toNode.h)/4&&Math.abs(dx)>toNode.w/2?(dx<0?'left':'right'):'top';
      p2=getPortCoords(toNode,toPort);
    }
    if (fromNode && /^break\s*;?$/.test(fromNode.text.trim())) {
      const incoming=edges.find(e=>e.to===fromNode!.id&&e.style!=='dashed');
      const previous=nodes.find(n=>n.id===incoming?.from);
      const horizontal=previous&&Math.abs(previous.y+previous.h/2-fromNode.y-fromNode.h/2)<=Math.min(previous.h,fromNode.h)/4&&Math.abs(previous.cx-fromNode.cx)>fromNode.w/2;
      fromPort=horizontal?(previous!.cx<fromNode.cx?'right':'left'):(previous?'bottom':p2.y<fromNode.y+fromNode.h/2?'top':'bottom');
      p1=getPortCoords(fromNode,fromPort);
    }
  }

  let preferred = preferredOrthogonalPoints(
    nodes,
    p1,
    fromPort,
    p2,
    toPort,
    edge.style || 'ortho',
    edge.bendOffset || 0,
    fromNode,
    toNode,
    edge.id,
    edge.bendOffsetY || 0,
    edge.waypoints
  );
  const peers = edges.filter(e => sharesCollector(edge, e, nodes, edges));
  let collector = false;
  if (peers.length > 1 && toNode && fromNode) {
    const sources = peers.map(e => nodes.find(n => n.id === e.from)).filter((n): n is FlowNode => !!n);
    const top = Math.min(p2.y,...sources.map(n => n.y));
    const bottom = Math.max(p2.y,...sources.map(n => n.y+n.h));
    const region = nodes.filter(n => n.fnId === fromNode!.fnId && n.y + n.h >= top && n.y <= bottom && n.type !== 'brace' && n.type !== 'comment');
    const x = edge.style === 'bypass_right' ? Math.max(...region.map(n => n.cx + n.w / 2)) + 32 : p2.x;
    const y = p1.y + (fromPort === 'bottom' ? 16 : fromPort === 'top' ? -16 : 0);
    const path = simplifyOrthogonalPolyline([p1,{x:p1.x,y},{x,y},{x,y:p2.y},p2]);
    collector = path.slice(1).every((b,i) => !nodes.some(n => n.id !== edge.from && n.id !== edge.to && n.type !== 'brace' && n.type !== 'comment' && !isJunction(n) && segmentHitsNode(path[i],b,n)));
    if (collector) preferred = path;
  }
  if(!edge.waypoints?.length && !collector) {
    const scope=context.scopes.find(s=>edge.style==='loop_left' ? edge.to===s.entryId&&s.nodeIds.includes(edge.from||'') :
      edge.style==='bypass_right'&&edge.to===s.joinId&&s.nodeIds.includes(edge.from||''));
    if (!scope && edge.style === 'bypass_right' && isJunction(toNode) && preferred.length > 2) {
      const lower=edges.filter(e=>e.style==='bypass_right'&&e.to!==edge.to).map(e=>nodes.find(n=>n.id===e.from)).filter((n):n is FlowNode=>!!n&&n.fnId===fromNode?.fnId&&n.y>p1!.y&&n.y<p2!.y);
      const region=nodes.filter(n=>n.fnId===fromNode?.fnId&&n.y+n.h>=p1!.y&&n.y<=p2!.y&&n.type!=='brace'&&n.type!=='comment');
      const x=Math.max(...region.map(n=>n.cx+n.w/2))+32+lower.length*16;
      const departureY=p1.y+(fromPort==='bottom'?16:fromPort==='top'?-16:0);
      preferred=simplifyOrthogonalPolyline([p1,{x:p1.x,y:departureY},{x,y:departureY},{x,y:p2.y},p2]);
    }
    if(scope) {
      const x=(edge.style==='loop_left'?scope.returnTrackX:scope.bypassTrackX)+(edge.bendOffset||0);
      const startY=p1.y+(fromPort==='bottom'?BASE_MARGIN:fromPort==='top'?-BASE_MARGIN:0)+(edge.bendOffsetY||0);
      const endY=p2.y+(isJunction(toNode)?0:toPort==='top'?-BASE_MARGIN:toPort==='bottom'?BASE_MARGIN:0);
      preferred=simplifyOrthogonalPolyline([p1,{x:p1.x,y:startY},{x,y:startY},{x,y:endY},{x:p2.x,y:endY},p2]);
    }
  }
  const points = collector || edge.waypoints?.length || ['straight','comm_link','control_transfer'].includes(edge.style) ? preferred :
    routeAroundObstacles(nodes,preferred,p1,fromPort,p2,toPort,fromNode,toNode,context.tracks,edge,edge.style);
  context.points.set(edge.id,points);
  if (!['comm_link','control_transfer'].includes(edge.style)) points.slice(1).forEach((b,i)=>context.tracks.push({a:points[i],b,edge}));
  return points;
}

/** A graph-wide registry is built once, in edge order, independently of draw order.
 * Geometry signatures invalidate it for in-place editor mutations as well. */
export function getEdgePoints(nodes: FlowNode[], edges: FlowEdge[], edge: FlowEdge, _visited = new Set<string>()): Point[] | null {
  const signature=JSON.stringify([nodes.map(n=>[n.id,n.type,n.text,n.cx,n.y,n.w,n.h,n.fnId,n.control]),edges]);
  if(!routeCache || routeCache.signature!==signature) {
    const context: RoutingContext={tracks:[],points:new Map(),scopes:getLoopRoutingScopes(nodes,edges)};
    edges.forEach(e=>resolveEdgePoints(nodes,edges,e,new Set(),context));
    routeCache={signature,points:context.points};
  }
  if(routeCache.points.has(edge.id)) return routeCache.points.get(edge.id)!;
  return resolveEdgePoints(nodes,edges,edge,new Set(),{tracks:[],points:new Map(),scopes:getLoopRoutingScopes(nodes,edges)});
}

export function getEdgeMidpoint(nodes: FlowNode[], edges: FlowEdge[], edge: FlowEdge): Point {
  const pts = getEdgePoints(nodes, edges, edge);
  if (!pts) return { x: 300, y: 100 };
  return getPolylineMidpoint(pts);
}

export interface SnapTargetResult {
  kind: 'node' | 'edge';
  nodeId?: string;
  port?: PortSide;
  edgeId?: string;
  point: Point;
}

function distToSegment(p: Point, a: Point, b: Point): { dist: number; proj: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1) return { dist: Math.hypot(p.x - a.x, p.y - a.y), proj: a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: Math.round(a.x + t * dx), y: Math.round(a.y + t * dy) };
  return { dist: Math.hypot(p.x - proj.x, p.y - proj.y), proj };
}

export function findSnapTargetAtPoint(
  nodes: FlowNode[],
  edges: FlowEdge[],
  pt: Point,
  excludeNodeId: string | null = null,
  excludeEdgeId: string | null = null
): SnapTargetResult | null {
  const ports: PortSide[] = ['top', 'bottom', 'left', 'right'];

  // 1. Direct port proximity check (within 24px of any port dot)
  let bestPortTarget: SnapTargetResult | null = null;
  let bestPortDist = 24;

  for (const nd of nodes) {
    if (nd.id === excludeNodeId || nd.type === 'brace') continue;
    for (const side of ports) {
      const pCoord = getPortCoords(nd, side);
      const d = Math.hypot(pt.x - pCoord.x, pt.y - pCoord.y);
      if (d < bestPortDist) {
        bestPortDist = d;
        bestPortTarget = { kind: 'node', nodeId: nd.id, port: side, point: pCoord };
      }
    }
  }
  if (bestPortTarget) return bestPortTarget;

  // 2. Inside or within 14px of a block's bounding box -> snap to the nearest side port of that block
  for (const nd of nodes) {
    if (nd.id === excludeNodeId || nd.type === 'brace') continue;
    const left = nd.cx - nd.w / 2 - 14;
    const right = nd.cx + nd.w / 2 + 14;
    const top = nd.y - 14;
    const bottom = nd.y + nd.h + 14;
    if (pt.x >= left && pt.x <= right && pt.y >= top && pt.y <= bottom) {
      let nearestSide: PortSide = 'top';
      let minSideDist = Infinity;
      for (const side of ports) {
        const pCoord = getPortCoords(nd, side);
        const d = Math.hypot(pt.x - pCoord.x, pt.y - pCoord.y);
        if (d < minSideDist) {
          minSideDist = d;
          nearestSide = side;
        }
      }
      return {
        kind: 'node',
        nodeId: nd.id,
        port: nearestSide,
        point: getPortCoords(nd, nearestSide),
      };
    }
  }

  // 3. Proximity to any existing arrow segment (within 16px)
  let bestEdgeTarget: SnapTargetResult | null = null;
  let bestEdgeDist = 16;

  for (const ed of edges) {
    if (ed.id === excludeEdgeId) continue;
    const pts = getEdgePoints(nodes, edges, ed);
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const { dist, proj } = distToSegment(pt, pts[i], pts[i + 1]);
      if (dist < bestEdgeDist) {
        bestEdgeDist = dist;
        bestEdgeTarget = { kind: 'edge', edgeId: ed.id, point: proj };
      }
    }
  }

  return bestEdgeTarget;
}

export function getSubtreeBounds(
  allNodes: FlowNode[],
  allEdges: FlowEdge[],
  nodeSlice: FlowNode[],
  edgeSlice: FlowEdge[] = []
) {
  if (!nodeSlice || nodeSlice.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  nodeSlice.forEach((n) => {
    const padX = n.type === 'decision' ? 34 : 18;
    minX = Math.min(minX, n.cx - n.w / 2 - padX);
    maxX = Math.max(maxX, n.cx + n.w / 2 + padX);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + n.h);
  });

  if (edgeSlice && edgeSlice.length > 0) {
    resetRoutingTracks();
    edgeSlice.forEach((e) => {
      const pts = getEdgePoints(allNodes, allEdges, e);
      if (pts) {
        pts.forEach((p) => {
          minX = Math.min(minX, p.x - 18);
          maxX = Math.max(maxX, p.x + 18);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        });
      }
    });
  }

  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function shiftSubtree(nodeSlice: FlowNode[], dx: number, dy = 0) {
  if (!nodeSlice || (dx === 0 && dy === 0)) return;
  nodeSlice.forEach((n) => {
    n.cx = Math.round(n.cx + dx);
    n.y = Math.round(n.y + dy);
  });
}

export function computeLaserAlignmentAndSnap(
  nodes: FlowNode[],
  primaryNode: FlowNode,
  candidateCx: number,
  candidateY: number,
  excludedIds: Set<string>
): { snappedCx: number; snappedY: number; guides: LaserGuide[] } {
  const SNAP_TOL = 7;
  let snappedCx = candidateCx;
  let snappedY = candidateY;
  const guides: LaserGuide[] = [];

  const pLeft = candidateCx - primaryNode.w / 2;
  const pRight = candidateCx + primaryNode.w / 2;
  const pMidY = candidateY + primaryNode.h / 2;
  const pTop = candidateY;
  const pBot = candidateY + primaryNode.h;

  for (const other of nodes) {
    if (excludedIds.has(other.id)) continue;
    const oLeft = other.cx - other.w / 2;
    const oRight = other.cx + other.w / 2;
    const oMidY = other.y + other.h / 2;
    const oTop = other.y;
    const oBot = other.y + other.h;

    if (Math.abs(candidateCx - other.cx) < SNAP_TOL) {
      snappedCx = other.cx;
      guides.push({
        x1: other.cx,
        y1: Math.min(candidateY, other.y) - 18,
        x2: other.cx,
        y2: Math.max(candidateY + primaryNode.h, other.y + other.h) + 18,
      });
    } else if (Math.abs(pLeft - oLeft) < SNAP_TOL) {
      snappedCx = oLeft + primaryNode.w / 2;
      guides.push({
        x1: oLeft,
        y1: Math.min(candidateY, other.y) - 14,
        x2: oLeft,
        y2: Math.max(candidateY + primaryNode.h, other.y + other.h) + 14,
      });
    } else if (Math.abs(pRight - oRight) < SNAP_TOL) {
      snappedCx = oRight - primaryNode.w / 2;
      guides.push({
        x1: oRight,
        y1: Math.min(candidateY, other.y) - 14,
        x2: oRight,
        y2: Math.max(candidateY + primaryNode.h, other.y + other.h) + 14,
      });
    }

    if (Math.abs(pMidY - oMidY) < SNAP_TOL) {
      snappedY = oMidY - primaryNode.h / 2;
      guides.push({
        x1: Math.min(snappedCx - primaryNode.w / 2, oLeft) - 18,
        y1: oMidY,
        x2: Math.max(snappedCx + primaryNode.w / 2, oRight) + 18,
        y2: oMidY,
      });
    } else if (Math.abs(pTop - oTop) < SNAP_TOL) {
      snappedY = oTop;
      guides.push({
        x1: Math.min(snappedCx - primaryNode.w / 2, oLeft) - 14,
        y1: oTop,
        x2: Math.max(snappedCx + primaryNode.w / 2, oRight) + 14,
        y2: oTop,
      });
    } else if (Math.abs(pBot - oBot) < SNAP_TOL) {
      snappedY = oBot - primaryNode.h;
      guides.push({
        x1: Math.min(snappedCx - primaryNode.w / 2, oLeft) - 14,
        y1: oBot,
        x2: Math.max(snappedCx + primaryNode.w / 2, oRight) + 14,
        y2: oBot,
      });
    }
  }

  return { snappedCx, snappedY, guides };
}
