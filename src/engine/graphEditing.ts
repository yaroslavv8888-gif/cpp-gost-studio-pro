import { FlowNode, FlowEdge } from '../types/flow';

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
