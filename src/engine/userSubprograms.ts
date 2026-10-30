import { FlowEdge, FlowNode } from '../types/flow';

/** Recognize the function headers retained for reverse C++ generation. */
export function functionHeaderName(text: string): string | undefined {
  return text.trim().match(/^(?:(?:unsigned|long|short|const|static|inline)\s+)*(?:void|int|double|float|char|bool|string|auto|size_t)\s*\*?\s+([A-Za-z_]\w*)\s*\([^;{}]*\)$/)?.[1];
}

export function userSubprogramNames(nodes: FlowNode[], edges: FlowEdge[]): Set<string> {
  const names = new Set<string>();
  for (const start of nodes.filter(n => n.type === 'terminator' && /^начало(?:\s|$)/i.test(n.text.trim()))) {
    const target = edges.find(e => e.from === start.id && e.style !== 'dashed')?.to;
    const header = nodes.find(n => n.id === target);
    const name = header && functionHeaderName(header.text);
    if (name && name !== 'main') names.add(name);
  }
  return names;
}

export function hasUserSubprogramCall(code: string, names: Set<string>): boolean {
  const plain = code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  // Qualified library/member calls must not match an unqualified user function.
  return [...plain.matchAll(/(?<![\w:.>])([A-Za-z_]\w*)\s*(?:<[^;{}]*>)?\s*\(/g)]
    .some(match => match[1] !== 'main' && names.has(match[1]));
}

/** Update previous automatic classifications without changing other shapes. */
export function normalizeSubprogramShapes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const names = userSubprogramNames(nodes, edges);
  const headers = new Set(edges.filter(e => e.style !== 'dashed' &&
    nodes.some(n => n.id === e.from && n.type === 'terminator' && /^начало(?:\s|$)/i.test(n.text.trim())))
    .map(e => e.to));
  return nodes.map(n => {
    if (headers.has(n.id) && functionHeaderName(n.text) && (n.type === 'process' || n.type === 'predefined'))
      return { ...n, type: 'predefined' };
    return n.type === 'predefined' && !hasUserSubprogramCall(n.text, names)
      ? { ...n, type: 'process' } : n;
  });
}
