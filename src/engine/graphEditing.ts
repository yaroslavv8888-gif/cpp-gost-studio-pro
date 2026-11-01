import { FlowNode, FlowEdge } from '../types/flow';

/** Local multi-input merges are flowline junctions, not numbered references. */
export function normalizeFlowJunctions(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  return nodes.map(n => {
    if (n.type !== 'connector' || !/^(?:\d+)?$/.test(n.text.trim())) return n;
    const incoming = edges.filter(e => e.to === n.id && e.style !== 'dashed');
    const outgoing = edges.filter(e => e.from === n.id && e.style !== 'dashed');
    if (incoming.length < 2 || outgoing.length !== 1) return n;
    return { ...n, text: '', w: 2, h: 2, y: n.y + n.h / 2 - 1 };
  });
}

/** Discard stale bends only on routes whose endpoints moved during alignment. */
export function alignedEdges(before: FlowNode[], after: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  const moved = new Set(after.filter(n => { const old = before.find(o => o.id === n.id); return old && (old.cx !== n.cx || old.y !== n.y); }).map(n => n.id));
  return edges.map(e => moved.has(e.from || '') || moved.has(e.to || '')
    ? { ...e, waypoints: undefined, bendOffset: 0, bendOffsetY: 0 } : e);
}

/** Upgrade old saved labels without changing custom branch descriptions. */
export function numericBranchLabels(edges: FlowEdge[]): FlowEdge[] {
  const label=(value:string)=>/^да$/i.test(value.trim())?'1':/^нет$/i.test(value.trim())?'0':value;
  return edges.map(e=>({...e,leftLabel:label(e.leftLabel),rightLabel:label(e.rightLabel)}));
}

/** A copied region may reference only copied nodes, never the original region. */
export function remapCopiedControl(control: FlowNode['control'], ids: Map<string, string>): FlowNode['control'] {
  if (!control) return undefined;
  const required = [control.joinId, control.bodyId, control.conditionId, control.yesId, control.noId,
    ...(control.kind === 'dowhile' ? [control.keyword] : []),
    ...(control.cases || []).flatMap(c => [c.entryId, c.stopId, ...(c.labelIds || [])])].filter(Boolean);
  if (required.some(id => !ids.has(id!))) return undefined;
  const remap = (id?: string) => id ? ids.get(id) : undefined;
  return { ...control, joinId: remap(control.joinId)!, bodyId: remap(control.bodyId),
    conditionId: remap(control.conditionId), yesId: remap(control.yesId), noId: remap(control.noId),
    keyword: control.kind === 'dowhile' ? remap(control.keyword) : control.keyword,
    cases: control.cases?.map(c => ({ ...c, labels: [...c.labels],
      labelIds: c.labelIds?.map(id => remap(id)!), entryId: remap(c.entryId)!, stopId: remap(c.stopId)! })) };
}
