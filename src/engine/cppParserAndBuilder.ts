import { functionHeaderName, hasUserSubprogramCall } from './userSubprograms';
import { CodeGenOptions, EdgeStyle, FlowEdge, FlowNode, GostNodeType, PortSide } from '../types/flow';
import { calcAutoSize, getSubtreeBounds, shiftSubtree, getEdgePoints } from './orthoRouter';

interface SwitchCaseGroup {
  labels: string[];
  labelLines: number[][];
  stmts: AstItem[];
  hasBreak: boolean;
  breakLine?: number;
  hasBraces?: boolean;
  openBraceLine?: number;
  closeBraceLine?: number;
  sourceLines: number[];
}

interface AstItem {
  kind: 'cin' | 'cout' | 'break' | 'continue' | 'return' | 'subprogram' | 'setlocale' | 'decl' | 'calc' | 'switch' | 'dowhile' | 'if' | 'loop';
  text?: string;
  expr?: string;
  cond?: string;
  loopType?: string;
  header?: string;
  cases?: SwitchCaseGroup[];
  openBraceLine?: number;
  closeBraceLine?: number;
  body?: AstItem[];
  thenB?: AstItem[];
  elseB?: AstItem[];
  sourceLines: number[];
}

function getLineNumberAtOffset(str: string, offset: number): number {
  let line = 1;
  const limit = Math.min(offset, str.length);
  for (let i = 0; i < limit; i++) {
    if (str[i] === '\n') line++;
  }
  return line;
}

function getLineRange(str: string, startOffset: number, endOffset: number): number[] {
  const s = getLineNumberAtOffset(str, startOffset);
  const e = getLineNumberAtOffset(str, endOffset);
  const res: number[] = [];
  for (let l = s; l <= e; l++) res.push(l);
  return res.length > 0 ? res : [s];
}

function maskPreservingNewlines(raw: string): string {
  const chars = raw.split('');
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    if (quote) {
      if (raw[i] === '\\') i++;
      else if (raw[i] === quote) quote = '';
      continue;
    }
    if (raw[i] === '"' || raw[i] === "'") { quote = raw[i]; continue; }
    let end = i;
    if (raw.startsWith('//', i)) {
      end = raw.indexOf('\n', i); if (end < 0) end = raw.length;
    } else if (raw.startsWith('/*', i)) {
      end = raw.indexOf('*/', i + 2); end = end < 0 ? raw.length : end + 2;
    } else continue;
    for (let j = i; j < end; j++) if (chars[j] !== '\n') chars[j] = ' ';
    i = end - 1;
  }
  return chars.join('').replace(/^[ \t]*#include[^\n]*|^[ \t]*using[ \t]+namespace\b[^\n]*/gm,
    m => ' '.repeat(m.length));
}

function extractBalancedBlock(str: string, startIdx: number, openCh: string, closeCh: string) {
  let depth = 0;
  let inString = false;
  let strQuote = '';

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === '\\') {
        i++;
      } else if (ch === strQuote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      strQuote = ch;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return { content: str.slice(startIdx + 1, i), startContentIdx: startIdx + 1, endIdx: i };
    }
  }
  return { content: str.slice(startIdx + 1), startContentIdx: startIdx + 1, endIdx: str.length - 1 };
}

function findNextSemicolonOutsideQuotes(str: string, startIdx: number): number {
  let inString = false;
  let strQuote = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === strQuote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      strQuote = ch;
      continue;
    }
    if (ch === '(') parenDepth++;
    else if (ch === ')' && parenDepth > 0) parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']' && bracketDepth > 0) bracketDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}' && braceDepth > 0) braceDepth--;
    else if (ch === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return i;
  }
  return -1;
}

interface ExtractedFunc {
  name: string;
  header: string;
  body: string;
  bodyOffset: number;
  headerLines: number[];
  openBraceLine: number;
  closeBraceLine: number;
}

function extractAllCppFunctions(maskedCode: string): ExtractedFunc[] {
  const funcs: ExtractedFunc[] = [];
  const funcRegex =
    /((?:unsigned\s+|long\s+|short\s+|const\s+|static\s+|inline\s+)*(?:void|int|double|float|char|bool|string|auto|size_t)\s*\*?\s+([a-zA-Z_]\w*)\s*\([^)]*\))\s*\{/g;
  let match: RegExpExecArray | null;
  let lastEnd = 0;

  while ((match = funcRegex.exec(maskedCode)) !== null) {
    if (match.index < lastEnd) continue;
    const header = match[1].replace(/\s+/g, ' ').trim();
    const name = match[2].trim();
    const braceStart = maskedCode.indexOf('{', match.index + match[1].length);
    if (braceStart === -1) break;
    const bodyObj = extractBalancedBlock(maskedCode, braceStart, '{', '}');
    funcs.push({
      name,
      header,
      body: bodyObj.content,
      bodyOffset: bodyObj.startContentIdx,
      headerLines: getLineRange(maskedCode, match.index, match.index + match[1].length),
      openBraceLine: getLineNumberAtOffset(maskedCode, braceStart),
      closeBraceLine: getLineNumberAtOffset(maskedCode, bodyObj.endIdx),
    });
    lastEnd = bodyObj.endIdx + 1;
    funcRegex.lastIndex = lastEnd;
  }
  return funcs;
}

function classifySimpleStatement(rawStmt: string, userFuncNames: Set<string>, sourceLines: number[]): AstItem | null {
  const stmt = rawStmt.trim();
  if (!stmt || stmt === ';') return null;
  // Never treat a stray `int main()` header inside a function body as a regular statement
  if (/^(?:(?:int|void)\s+)?main\s*\([^)]*\)\s*$/i.test(stmt)) return null;

  if (/^(break|continue)\s*;?$/.test(stmt)) {
    return { kind: stmt.startsWith('break') ? 'break' : 'continue', text: stmt, sourceLines };
  }
  if (/^return\b/.test(stmt)) {
    return { kind: 'return', text: stmt, sourceLines };
  }
  if (
    /^(?:std::)?w?cin\s*>>/.test(stmt) ||
    /^getline\s*\(\s*(?:std::)?w?cin\b/.test(stmt) ||
    /^scanf(?:_s)?\s*\(/.test(stmt)
  ) {
    return { kind: 'cin', text: stmt, sourceLines };
  }
  if (/^(?:std::)?w?(?:cout|cerr)\s*<</.test(stmt) || /^printf(?:_s)?\s*\(/.test(stmt)) {
    return { kind: 'cout', text: stmt, sourceLines };
  }
  const withoutLiterals = stmt.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  if (/^(?:std::)?setlocale\s*\(/.test(stmt)) return { kind: 'setlocale', text: stmt, sourceLines };
  const declaration = /^(?:(?:const|static|constexpr|volatile|unsigned|signed|long|short)\s+)*(?:(?:std::)?(?:vector|array|deque|list|map|set|unordered_map|unordered_set|basic_string|string)\b|(?:int|double|float|long|short|char|bool|size_t|auto)\b)/.test(withoutLiterals);
  // Direct construction of a variable/container is a declaration, while a
  // call to a user subprogram in an assignment remains a predefined process.
  const directInitialization = declaration && !withoutLiterals.includes('=');
  const allocation = /^(?:delete\s*(?:\[\s*\])?\s+|(?:[\s\S]*?=\s*)?new\s+)/.test(withoutLiterals)
    || (declaration && /=\s*new\b/.test(withoutLiterals));
  // Brace initialization is one declaration operation, including every nested
  // element expression. Calls within an array/container initializer must not
  // turn its declaration into a separate control-flow/subprogram operation.
  if (declaration && withoutLiterals.includes('{')) return { kind: 'decl', text: stmt, sourceLines };
  if (!directInitialization && !allocation && hasUserSubprogramCall(withoutLiterals, userFuncNames)) {
    return { kind: 'subprogram', text: stmt, sourceLines };
  }
  if (/^setlocale\s*\(/.test(stmt)) {
    return { kind: 'setlocale', text: stmt, sourceLines };
  }
  if (declaration) {
    return { kind: 'decl', text: stmt, sourceLines };
  }
  return { kind: 'calc', text: stmt, sourceLines };
}

function skipWhitespaceAndStrayBraces(code: string, i: number): number {
  const n = code.length;
  while (i < n) {
    if (/\s/.test(code[i]) || code[i] === ';' || code[i] === '}') {
      i++;
    } else {
      break;
    }
  }
  return i;
}

function parseSwitchCases(
  fullDoc: string,
  switchBody: string,
  baseOffset: number,
  groupStmts: boolean,
  userFuncNames: Set<string>
): SwitchCaseGroup[] {
  const cases: SwitchCaseGroup[] = [];
  const matches: { label: string; startIdx: number; bodyStart: number }[] = [];
  // Only labels at this switch's own depth belong to it.
  let braceDepth = 0;
  let quote = '';
  for (let i = 0; i < switchBody.length; i++) {
    const ch = switchBody[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') { braceDepth++; continue; }
    if (ch === '}') { braceDepth--; continue; }
    if (braceDepth !== 0) continue;
    if (i > 0 && /\w/.test(switchBody[i - 1])) continue;
    const keyword = switchBody.slice(i).match(/^(case\b\s*|default\b\s*)/);
    if (!keyword) continue;
    const valueStart = i + keyword[0].length;
    let literal = '';
    let ternary = 0;
    for (let j = valueStart; j < switchBody.length; j++) {
      const c = switchBody[j];
      if (literal) {
        if (c === '\\') j++;
        else if (c === literal) literal = '';
        continue;
      }
      if (c === '"' || c === "'") { literal = c; continue; }
      if (c === '?') ternary++;
      if (c !== ':' || switchBody[j - 1] === ':' || switchBody[j + 1] === ':') continue;
      if (ternary) { ternary--; continue; }
      matches.push({ label: keyword[0].startsWith('default') ? 'default' : switchBody.slice(valueStart, j).trim(), startIdx: i, bodyStart: j + 1 });
      i = j;
      break;
    }
  }

  let pendingLabels: string[] = [];
  let pendingLabelLines: number[][] = [];

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].startIdx : switchBody.length;
    let rawCaseCode = switchBody.slice(cur.bodyStart, nextStart);
    let localOffset = baseOffset + cur.bodyStart;
    const curLabelLine = [getLineNumberAtOffset(fullDoc, baseOffset + cur.startIdx)];

    pendingLabels.push(cur.label);
    pendingLabelLines.push(curLabelLine);

    // If this case has an empty body and falls through directly to the next case label, group them together
    if (!rawCaseCode.trim() && i + 1 < matches.length) {
      continue;
    }

    let hasBraces = false;
    let openBraceLine: number | undefined;
    let closeBraceLine: number | undefined;

    const trimmedOuter = rawCaseCode.trim();
    if (trimmedOuter.startsWith('{')) {
      const firstBrace = rawCaseCode.indexOf('{');
      const scoped = extractBalancedBlock(rawCaseCode, firstBrace, '{', '}');
      if (/^\s*break\s*;\s*$/.test(rawCaseCode.slice(scoped.endIdx + 1))) {
        // The common case { declarations; ... } break; form has a lexical
        // scope too. Moving its trailing break inside that scope is equivalent.
        hasBraces = true;
        openBraceLine = getLineNumberAtOffset(fullDoc, localOffset + firstBrace);
        closeBraceLine = getLineNumberAtOffset(fullDoc, localOffset + scoped.endIdx);
      }
    }
    if (trimmedOuter.startsWith('{') && trimmedOuter.endsWith('}')) {
      const firstBrace = rawCaseCode.indexOf('{');
      const lastBrace = rawCaseCode.lastIndexOf('}');
      hasBraces = true;
      openBraceLine = getLineNumberAtOffset(fullDoc, localOffset + firstBrace);
      closeBraceLine = getLineNumberAtOffset(fullDoc, localOffset + lastBrace);
      rawCaseCode = rawCaseCode.slice(firstBrace + 1, lastBrace);
      localOffset += firstBrace + 1;
    }

    const hasBreak = false;
    const breakLine: number | undefined = undefined;

    const trimmedInner = rawCaseCode.trim();
    if (!hasBraces && trimmedInner.startsWith('{') && trimmedInner.endsWith('}')) {
      const firstBrace = rawCaseCode.indexOf('{');
      const lastBrace = rawCaseCode.lastIndexOf('}');
      hasBraces = true;
      openBraceLine = getLineNumberAtOffset(fullDoc, localOffset + firstBrace);
      closeBraceLine = getLineNumberAtOffset(fullDoc, localOffset + lastBrace);
      rawCaseCode = rawCaseCode.slice(firstBrace + 1, lastBrace);
      localOffset += firstBrace + 1;
    }

    const allSourceLines = Array.from(new Set(pendingLabelLines.flat()));
    cases.push({
      labels: [...pendingLabels],
      labelLines: [...pendingLabelLines],
      stmts: parseStatements(fullDoc, rawCaseCode, localOffset, groupStmts, userFuncNames),
      hasBreak,
      breakLine,
      hasBraces,
      openBraceLine,
      closeBraceLine,
      sourceLines: allSourceLines,
    });

    pendingLabels = [];
    pendingLabelLines = [];
  }
  return cases;
}

function parseSingleStatementOrBlock(
  fullDoc: string,
  code: string,
  baseOffset: number,
  startIdx: number,
  groupStmts: boolean,
  userFuncNames: Set<string>
): { items: AstItem[]; nextIdx: number; hasBraces: boolean } {
  const n = code.length;
  let i = startIdx;
  while (i < n && /\s/.test(code[i])) i++;
  if (code[i] === ';') return { items: [], nextIdx: i + 1, hasBraces: false };
  if (i >= n) return { items: [], nextIdx: n, hasBraces: false };

  // 1. Block in braces { ... }
  if (code[i] === '{') {
    const b = extractBalancedBlock(code, i, '{', '}');
    const items = parseStatements(fullDoc, b.content, baseOffset + b.startContentIdx, groupStmts, userFuncNames);
    return { items, nextIdx: b.endIdx + 1, hasBraces: true };
  }

  const rest = code.slice(i);

  // 2. switch (...) { ... }
  const swM = rest.match(/^switch\s*\(/i);
  if (swM) {
    const pStart = i + swM[0].length - 1;
    const exprObj = extractBalancedBlock(code, pStart, '(', ')');
    const swLines = getLineRange(fullDoc, baseOffset + i, baseOffset + exprObj.endIdx);
    i = exprObj.endIdx + 1;
    while (i < n && /\s/.test(code[i])) i++;
    let cases: SwitchCaseGroup[] = [];
    let openBraceLine: number | undefined;
    let closeBraceLine: number | undefined;
    if (code[i] === '{') {
      const b = extractBalancedBlock(code, i, '{', '}');
      openBraceLine = getLineNumberAtOffset(fullDoc, baseOffset + i);
      closeBraceLine = getLineNumberAtOffset(fullDoc, baseOffset + b.endIdx);
      cases = parseSwitchCases(fullDoc, b.content, baseOffset + b.startContentIdx, groupStmts, userFuncNames);
      i = b.endIdx + 1;
    }
    return {
      items: [
        {
          kind: 'switch',
          expr: exprObj.content.trim(),
          cases,
          openBraceLine,
          closeBraceLine,
          sourceLines: swLines,
        },
      ],
      nextIdx: i,
      hasBraces: true,
    };
  }

  // 3. do ... while (...);
  const doM = rest.match(/^do\b/);
  if (doM) {
    i += doM[0].length;
    const bodyParsed = parseSingleStatementOrBlock(fullDoc, code, baseOffset, i, groupStmts, userFuncNames);
    i = bodyParsed.nextIdx;
    while (i < n && /\s/.test(code[i])) i++;
    const wM = code.slice(i).match(/^while\s*\(/);
    let condStr = 'условие';
    let condLines = [getLineNumberAtOffset(fullDoc, baseOffset + i)];
    if (wM) {
      const pStart = i + wM[0].length - 1;
      const cObj = extractBalancedBlock(code, pStart, '(', ')');
      condStr = cObj.content.trim();
      condLines = getLineRange(fullDoc, baseOffset + i, baseOffset + cObj.endIdx);
      i = cObj.endIdx + 1;
      const semi = findNextSemicolonOutsideQuotes(code, i);
      if (semi !== -1) i = semi + 1;
    }
    return {
      items: [{ kind: 'dowhile', cond: condStr, body: bodyParsed.items, sourceLines: condLines }],
      nextIdx: i,
      hasBraces: false,
    };
  }

  // 4. if (...) ... [else ...]
  const ifM = rest.match(/^if\s*\(/);
  if (ifM) {
    const pStart = i + ifM[0].length - 1;
    const cond = extractBalancedBlock(code, pStart, '(', ')');
    const ifLines = getLineRange(fullDoc, baseOffset + i, baseOffset + cond.endIdx);
    i = cond.endIdx + 1;

    const thenParsed = parseSingleStatementOrBlock(fullDoc, code, baseOffset, i, groupStmts, userFuncNames);
    i = thenParsed.nextIdx;

    while (i < n && /\s/.test(code[i])) i++;
    let elseB: AstItem[] = [];
    const elseM = code.slice(i).match(/^else\b/);
    if (elseM) {
      i += elseM[0].length;
      const elseParsed = parseSingleStatementOrBlock(fullDoc, code, baseOffset, i, groupStmts, userFuncNames);
      elseB = elseParsed.items;
      i = elseParsed.nextIdx;
    }
    return {
      items: [{ kind: 'if', cond: cond.content.trim(), thenB: thenParsed.items, elseB, sourceLines: ifLines }],
      nextIdx: i,
      hasBraces: false,
    };
  }

  // 5. for (...) / while (...)
  const loopM = rest.match(/^(for|while)\s*\(/);
  if (loopM) {
    const loopType = loopM[1];
    const pStart = i + loopM[0].length - 1;
    const head = extractBalancedBlock(code, pStart, '(', ')');
    const loopLines = getLineRange(fullDoc, baseOffset + i, baseOffset + head.endIdx);
    i = head.endIdx + 1;
    while (i < n && /\s/.test(code[i])) i++;

    let body: AstItem[] = [];
    if (code[i] === ';') {
      i++;
    } else {
      const bodyParsed = parseSingleStatementOrBlock(fullDoc, code, baseOffset, i, groupStmts, userFuncNames);
      body = bodyParsed.items;
      i = bodyParsed.nextIdx;
    }
    return {
      items: [{ kind: 'loop', loopType, header: head.content.trim(), body, sourceLines: loopLines }],
      nextIdx: i,
      hasBraces: false,
    };
  }

  // 6. Simple statement up to ';'
  const semi = findNextSemicolonOutsideQuotes(code, i);
  const endPos = semi === -1 ? n : semi + 1;
  const rawStmt = code.slice(i, endPos).trim();
  const stmtLines = getLineRange(fullDoc, baseOffset + i, baseOffset + endPos - 1);
  const classified = classifySimpleStatement(rawStmt, userFuncNames, stmtLines);

  return {
    items: classified ? [classified] : [],
    nextIdx: endPos,
    hasBraces: false,
  };
}

function parseStatements(
  fullDoc: string,
  code: string,
  baseOffset: number,
  groupStmts: boolean,
  userFuncNames = new Set<string>()
): AstItem[] {
  const rawItems: AstItem[] = [];
  let i = 0;
  const n = code.length;

  while (i < n) {
    const nextI = skipWhitespaceAndStrayBraces(code, i);
    if (nextI >= n) break;
    const res = parseSingleStatementOrBlock(fullDoc, code, baseOffset, nextI, groupStmts, userFuncNames);
    if (res.items && res.items.length > 0) {
      rawItems.push(...res.items);
    }
    if (res.nextIdx <= i) {
      i = nextI + 1;
    } else {
      i = res.nextIdx;
    }
  }

  if (!groupStmts) return rawItems;

  const grouped: AstItem[] = [];
  for (let k = 0; k < rawItems.length; k++) {
    const cur = rawItems[k];
    const prev = grouped[grouped.length - 1];

    if (prev && prev.kind === cur.kind && (cur.kind === 'decl' || cur.kind === 'calc')) {
      prev.text = (prev.text || '') + '\n' + (cur.text || '');
      prev.sourceLines = Array.from(new Set([...prev.sourceLines, ...cur.sourceLines]));
    } else {
      grouped.push({ ...cur, sourceLines: [...cur.sourceLines] });
    }
  }
  return grouped;
}

export function buildFlowFromCpp(
  rawCode: string, options: CodeGenOptions
): { nodes: FlowNode[]; edges: FlowEdge[]; nextId: number } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let nextId = 1;
  let fnId = 'fn_main';
  let loopNumber = 0;
  const node = (type: GostNodeType, text: string, cx: number, y: number, sourceLines: number[] = []) => {
    const size = type === 'connector' ? { w: 2, h: 2 } : calcAutoSize(type, text);
    const n: FlowNode = { id: `n${nextId++}`, type, text, cx, y, ...size, fnId, sourceLines };
    nodes.push(n);
    return n;
  };
  const edge = (from: FlowNode, to: FlowNode, opts: Partial<FlowEdge> = {}) => {
    const e: FlowEdge = { id: `e${nextId++}`, from: from.id, to: to.id,
      fromEdge: null, toEdge: null, fromPort: 'bottom', toPort: 'top',
      leftLabel: '', rightLabel: '', style: 'ortho', bendOffset: 0, ...opts };
    edges.push(e);
    return e;
  };
  type Scope = { breakTarget: FlowNode; continueTarget?: FlowNode };
  type Sequence = { first: FlowNode | null; last: FlowNode | null; bottom: number; normal: boolean };
  const GAP = 44;
  const build = (items: AstItem[], cx: number, y: number, previous: FlowNode | null,
    scopes: Scope[], functionExit: FlowNode, functionBody = false): Sequence => {
    let first: FlowNode | null = null;
    let last = previous;
    let normal = true;
    const attach = (n: FlowNode) => { if (!first) first = n; if (last) edge(last, n); };
    if (options.exampleStyle && items.length) node('brace', '{', cx - 42, y - 40, items[0].sourceLines);
    for (const item of items) {
      if (!normal) break; // Never synthesize flow through code after an unconditional jump.
      if (item.kind === 'if') {
        const d = node('decision', options.showKeywords ? `if (${item.cond})` : item.cond || '', cx, y, item.sourceLines);
        attach(d);
        const join = node('connector', '', cx, y, item.sourceLines);
        const top = y + d.h + GAP;
        const leftStart = nodes.length;
        const yes = build(item.thenB || [], 0, top, null, scopes, functionExit);
        const leftNodes = nodes.slice(leftStart);
        const lb = getSubtreeBounds(nodes, edges, leftNodes, []);
        const rightStart = nodes.length;
        const no = build(item.elseB || [], 0, top, null, scopes, functionExit);
        const rightNodes = nodes.slice(rightStart);
        const rb = getSubtreeBounds(nodes, edges, rightNodes, []);
        // Position complete subtrees, including every nested sibling and loop body.
        shiftSubtree(leftNodes, Math.min(cx - d.w / 2 - 84, cx - 64 - (lb?.maxX || 0)));
        shiftSubtree(rightNodes, Math.max(cx + d.w / 2 + 84, cx + 64 - (rb?.minX || 0)));
        join.y = Math.max(top, yes.bottom, no.bottom) + GAP;
        edge(d, yes.first || join, { fromPort: 'left', toPort: yes.first ? 'top' : 'left', rightLabel: '1' });
        edge(d, no.first || join, { fromPort: 'right', toPort: no.first ? 'top' : 'right', rightLabel: '0', style: no.first ? 'ortho' : 'bypass_right' });
        if (yes.first && yes.normal && yes.last) edge(yes.last, join, { toPort: 'left' });
        if (no.first && no.normal && no.last) edge(no.last, join, { toPort: 'right' });
        d.control = { kind: 'if', joinId: join.id, yesId: yes.first?.id, noId: no.first?.id, expression: item.cond };
        normal = yes.normal || no.normal;
        if (!normal) {
          nodes.splice(nodes.indexOf(join), 1);
          d.control.joinId = functionExit.id;
        }
        last = normal ? join : null;
        y = join.y + join.h + GAP;
      } else if (item.kind === 'switch') {
        const header = node('process', `switch (${item.expr})`, cx, y, item.sourceLines);
        attach(header);
        if(options.exampleStyle)node('brace','{',cx-42,y+header.h+4,item.sourceLines);
        const join = node('connector', '', cx, y, item.sourceLines);
        const groups = item.cases || [];
        const entries = groups.map(g => node('connector', '', cx, y, g.sourceLines));
        const scope = [...scopes, { breakTarget: join }];
        let spine = header;
        y += header.h + GAP;
        const diamonds: { d: FlowNode; index: number }[] = [];
        const caseMeta: NonNullable<NonNullable<FlowNode['control']>['cases']> = [];
        groups.forEach((g, index) => {
          const ownDiamonds: FlowNode[] = [];
          for (const label of g.labels.filter(l => l !== 'default')) {
            const d = node('decision', `case ${label}:`, cx, y, g.sourceLines);
            edge(spine, d, { rightLabel: spine === header ? '' : '0' });
            diamonds.push({d,index}); ownDiamonds.push(d); spine=d;
            y += d.h + GAP;
          }
          const lastDiamond=ownDiamonds.at(-1);
          const row=lastDiamond ? lastDiamond.y+lastDiamond.h/2 : y+36;
          const start=nodes.length;
          const res=build(g.stmts,0,row,null,scope,functionExit);
          const bodyNodes=nodes.slice(start);
          if(!g.hasBraces){
            const decorations=bodyNodes.filter(n=>n.type==='brace');
            for(const n of [decorations[0],decorations.at(-1)])if(n&&nodes.includes(n))nodes.splice(nodes.indexOf(n),1);
          }
          const linear=g.stmts.every(s=>!['if','switch','loop','dowhile'].includes(s.kind));
          const left=cx+Math.max(header.w/2,...ownDiamonds.map(d=>d.w/2),90)+90;
          let bottom:number;
          const functional=bodyNodes.filter(n=>n.type!=='brace');
          if(linear) {
            let x=left+(g.labels.length>1?55:0);
            for(const n of functional){n.cx=x+n.w/2;n.y=row-n.h/2;x+=n.w+44;}
            const braces=bodyNodes.filter(n=>n.type==='brace');
            braces.forEach(n=>{n.cx=n.text==='{'?(functional[0]?.cx||left)-(functional[0]?.w||0)/2+12:(functional.at(-1)?.cx||x)+(functional.at(-1)?.w||0)/2-12;n.y=row-72;});
            for(const e of edges.filter(e=>functional.some(n=>n.id===e.from)&&functional.some(n=>n.id===e.to))){e.fromPort='right';e.toPort='left';}
            bottom=row+Math.max(36,...functional.map(n=>n.h/2))+56;
          } else {
            const bounds=getSubtreeBounds(nodes,edges,bodyNodes,[]);
            shiftSubtree(bodyNodes,left-(bounds?.minX||0),44);
            bottom=res.bottom+44+GAP;
          }
          const entry=entries[index];
          entry.cx=left-22;entry.y=row-1;
          if(res.first)edge(entry,res.first,{fromPort:'right',toPort:linear?'left':'top'});
          const next=entries[index+1]||join;
          if(res.normal)edge(res.last||entry,next,{toPort:'left'});
          caseMeta.push({labels:g.labels,hasBraces:g.hasBraces,labelIds:g.labels.map(label=>diamonds.find(x=>x.index===index&&x.d.text===`case ${label}:`)?.d.id||''),entryId:entry.id,stopId:next.id});
          y=Math.max(y,bottom);
        });
        diamonds.forEach(({d,index})=>edge(d,entries[index],{fromPort:'right',toPort:'left',rightLabel:'1'}));
        const defaultIndex=groups.findIndex(g=>g.labels.includes('default'));
        if(defaultIndex>=0){
          const entry=entries[defaultIndex];
          const size=calcAutoSize('decision','default:');
          const defaultY=Math.max(spine.y+spine.h+GAP,entry.y+1-size.h/2);
          const fallback=node('decision','default:',cx,defaultY,groups[defaultIndex].sourceLines);
          edge(spine,fallback,{rightLabel:spine===header?'':'0'});
          edge(fallback,entry,{fromPort:'right',toPort:'left',rightLabel:'1'});
          const labelIndex=groups[defaultIndex].labels.indexOf('default');
          caseMeta[defaultIndex].labelIds![labelIndex]=fallback.id;
          spine=fallback;
          y=Math.max(y,fallback.y+fallback.h+GAP);
        }
        edge(spine,join,{rightLabel:spine===header?'':'0',toPort:'top'});
        join.y=y+GAP;
        if(options.exampleStyle)node('brace','}',cx-42,join.y-38,item.sourceLines);
        header.control = { kind: 'switch', joinId: join.id, expression: item.expr, cases: caseMeta };
        last = join;
        y = join.y + join.h + GAP;
      } else if (item.kind === 'loop' || item.kind === 'dowhile') {
        const post = item.kind === 'dowhile';
        const boundaryText = `Цикл ${++loopNumber}`;
        let boundary: FlowNode | null = null;
        if (options.gostLoopBounds) {
          boundary = node('loop_start', boundaryText, cx, y, item.sourceLines);
          boundary.loopBoundary = true;
          attach(boundary);
          last = boundary;
          y += boundary.h + GAP;
        }
        const text = post ? '' : options.showKeywords ? `${item.loopType} (${item.header})` : item.header || '';
        const entry = post ? null : node('connector', '', cx, y, item.sourceLines);
        const head = node(post ? 'connector' : item.loopType === 'for' ? 'prep' : 'decision', text, cx, post ? y : y + GAP + 2, item.sourceLines);
        attach(entry || head);
        if (entry) edge(entry, head);
        y = head.y;
        const exit = node('connector', '', cx, y, item.sourceLines);
        const conditionJoin = entry || node('connector', '', cx, y, item.sourceLines);
        const bodyTop = y + head.h + GAP;
        const res = build(item.body || [], cx, bodyTop, null,
          [...scopes, { breakTarget: exit, continueTarget: conditionJoin }], functionExit);
        const bodyEntry = res.first || conditionJoin;
        edge(head, bodyEntry, { rightLabel: post ? '' : '1', toPort: bodyEntry === conditionJoin && !post ? 'left' : 'top', style: bodyEntry === conditionJoin && !post ? 'loop_left' : 'ortho' });
        y = Math.max(bodyTop, res.bottom) + GAP;
        if (post) {
          conditionJoin.y = y;
          if (res.normal && res.last) edge(res.last, conditionJoin);
          const cond = node('decision', options.showKeywords ? `while (${item.cond})` : item.cond || '', cx, y + GAP, item.sourceLines);
          edge(conditionJoin, cond);
          edge(cond, head, { fromPort: 'left', toPort: 'left', rightLabel: '1', style: 'loop_left' });
          exit.y = cond.y + cond.h + GAP;
          edge(cond, exit, { fromPort: 'right', toPort: 'right', rightLabel: '0', style: 'bypass_right' });
          head.control = { kind: 'dowhile', joinId: exit.id, bodyId: res.first?.id, conditionId: cond.id, expression: item.cond, keyword: conditionJoin.id };
        } else {
          if (res.normal && res.last) edge(res.last, conditionJoin, { toPort: 'left', style: 'loop_left' });
          exit.y = y + GAP;
          edge(head, exit, { fromPort: 'right', toPort: 'right', rightLabel: '0', style: 'bypass_right' });
          head.control = { kind: 'loop', joinId: exit.id, bodyId: res.first?.id, keyword: item.loopType, expression: item.header };
        }
        last = exit;
        y = exit.y + exit.h + GAP;
        if (boundary) {
          const bottom = node('loop_end', boundaryText, cx, y, item.sourceLines);
          bottom.loopBoundary = true;
          edge(exit, bottom);
          last = bottom;
          y += bottom.h + GAP;
        }
      } else {
        const text = item.text || '';
        const returnCall = item.kind === 'return' && hasUserSubprogramCall(text, names);
        const type: GostNodeType = item.kind === 'cin' || item.kind === 'cout' ? 'io' : item.kind === 'subprogram' || returnCall ? 'predefined' : 'process';
        const n = node(type, text, cx, y, item.sourceLines);
        attach(n);
        last = n;
        y += n.h + GAP;
        if (item.kind === 'return' || item.kind === 'break' || item.kind === 'continue') {
          const target = item.kind === 'return' ? functionExit : item.kind === 'break'
            ? scopes.at(-1)?.breakTarget : [...scopes].reverse().find(s => s.continueTarget)?.continueTarget;
          if (target) edge(n, target, { style: item.kind === 'continue' ? 'loop_left' : 'bypass_right', toPort: item.kind === 'continue' ? 'left' : 'right' });
          last = null;
          normal = false;
        }
      }
    }
    const bottom = Math.max(y - GAP, 0);
    if (options.exampleStyle && items.length && !functionBody) node('brace', '}', cx - 42, bottom + 4, items[items.length - 1].sourceLines);
    return { first, last, bottom, normal };
  };
  if (!rawCode.trim()) return { nodes, edges, nextId };
  const masked = maskPreservingNewlines(rawCode);
  let funcs = extractAllCppFunctions(masked);
  if (!funcs.length) funcs = [{ name: 'main', header: 'int main()', body: masked, bodyOffset: 0, headerLines: [1], openBraceLine: 1, closeBraceLine: rawCode.split('\n').length }];
  const names = new Set(funcs.map(f => f.name));
  funcs.sort((a, b) => a.name === 'main' ? -1 : b.name === 'main' ? 1 : 0);
  let maxX = 0;
  funcs.forEach((fn, index) => {
    fnId = `fn_${index}_${fn.name}`;
    const startIndex = nodes.length;
    const ast = parseStatements(masked, fn.body, fn.bodyOffset, options.groupStmts, names);
    const finalReturn = ast.at(-1)?.kind === 'return' ? ast.pop() : undefined;
    const start = node('terminator', fn.name === 'main' ? 'Начало' : `Начало ${fn.name}`, 0, 30, fn.headerLines);
    const endJoin = node('connector', '', 0, 0, [fn.closeBraceLine]);
    const end = node('terminator', finalReturn?.text || 'Конец', 0, 0, finalReturn?.sourceLines || [fn.closeBraceLine]);
    // Preserve actual function signatures even when the decorative example style is disabled.
    const signature = node('predefined', fn.header, 0, start.y + start.h + GAP, fn.headerLines);
    const signatureEdge = edge(start, signature);
    if (index === 0) {
      const headers = rawCode.split('\n').map((text, i) => ({ text: text.trim(), i: i + 1 })).filter(l => l.text.startsWith('#include') || /^using\s+namespace\b/.test(l.text));
      if (headers.length) {
        const comment = node('comment', headers.map(l => l.text).join('\n'), 0, 30, headers.map(l => l.i));
        comment.cx = Math.max(start.w, signature.w) / 2 + 60 + comment.w / 2;
        edge(start, comment, { from: null, fromEdge: signatureEdge.id, fromPort: 'edge', toPort: 'left', style: 'dashed' });
      }
    }
    const res = build(ast, 0, signature.y + signature.h + GAP, signature, [], endJoin, true);
    endJoin.y = res.bottom + GAP;
    end.y = endJoin.y + endJoin.h + GAP;
    if (res.normal && res.last) edge(res.last, endJoin);
    edge(endJoin, end);
    if (options.exampleStyle) {
      if (!ast.length) node('brace', '{', -42, signature.y + signature.h + 4, [fn.openBraceLine]);
      node('brace', '}', -42, end.y + end.h + 8, [fn.closeBraceLine]);
    }
    const fnNodes = nodes.slice(startIndex);
    const bounds = getSubtreeBounds(nodes, edges, fnNodes, []);
    const dx = maxX + 100 - (bounds?.minX || 0);
    shiftSubtree(fnNodes, dx);
    maxX = (bounds?.maxX || 0) + dx + 120;
  });
  // Elide single-entry case connectors; retain true multi-input junctions.
  for (const header of nodes.filter(n => n.control?.kind === 'switch')) {
    for (const c of header.control!.cases || []) {
      const incoming = edges.filter(e => e.to === c.entryId && e.style !== 'dashed');
      const outgoing = edges.filter(e => e.from === c.entryId && e.style !== 'dashed');
      if (c.labels.length !== 1 || incoming.length !== 1 || outgoing.length !== 1) continue;
      const old = c.entryId, target = outgoing[0].to!;
      if (!nodes.some(n => n.id === target && n.type !== 'connector')) continue;
      incoming[0].to = target; incoming[0].toPort = outgoing[0].toPort;
      edges.splice(edges.indexOf(outgoing[0]), 1);
      nodes.splice(nodes.findIndex(n => n.id === old), 1);
      for (const n of nodes) for (const entry of n.control?.cases || []) {
        if (entry.entryId === old) entry.entryId = target;
        if (entry.stopId === old) entry.stopId = target;
      }
    }
  }
  return { nodes, edges, nextId };
}

// ============================================================================
// ОБРАТНАЯ ГЕНЕРАЦИЯ КОДА C++ ИЗ БЛОК-СХЕМЫ НА ХОЛСТЕ (CANVAS → C++)
// ============================================================================
export function synthesizeCppFromGraph(
  nodes: FlowNode[],
  edges: FlowEdge[]
): { code: string; updatedNodes: FlowNode[] } {
  const clonedNodes = nodes.map((n) => ({ ...n, sourceLines: [] as number[] }));
  const nodeMap = new Map<string, FlowNode>();
  clonedNodes.forEach((n) => nodeMap.set(n.id, n));

  const outLines: string[] = [];
  const pushLine = (text: string, linkedNodeIds: string[] = []) => {
    outLines.push(text);
    const lineNum = outLines.length;
    linkedNodeIds.forEach((id) => {
      const nd = nodeMap.get(id);
      if (nd && !nd.sourceLines?.includes(lineNum)) {
        nd.sourceLines = [...(nd.sourceLines || []), lineNum];
      }
    });
  };

  // 1. Collect #include and using namespace from comment blocks or default header
  const headerComments = clonedNodes.filter(
    (n) => n.type === 'comment' && (n.text.includes('#include') || n.text.includes('using namespace'))
  );

  if (headerComments.length > 0) {
    headerComments.forEach((hc) => {
      hc.text.split('\n').forEach((ln) => {
        if (ln.trim()) pushLine(ln.trim(), [hc.id]);
      });
    });
  } else {
    pushLine('#include <iostream>');
    pushLine('using namespace std;');
  }
  pushLine('');

  // Definitions are laid out with main first. Declare the other signatures so
  // calls remain valid C++ regardless of the original function order.
  for (const start of clonedNodes.filter(n => n.type === 'terminator' && /^начало\s+/i.test(n.text))) {
    const target = edges.find(e => e.from === start.id && e.style !== 'dashed')?.to;
    const signature = target ? nodeMap.get(target) : undefined;
    if (signature && functionHeaderName(signature.text)) pushLine(signature.text.trim().replace(/;$/, '') + ';', [signature.id]);
  }

  // Outgoing edges helper (ignoring dashed comment edges)
  const getOutgoing = (nodeId: string): FlowEdge[] =>
    edges.filter((e) => e.from === nodeId && e.to && e.style !== 'dashed');

  const isMainHeaderLine = (txt: string): boolean =>
    /^(?:(?:int|void)\s+)?main\s*\([^)]*\)\s*;?$/i.test(txt.trim());

  const isEndTerminatorText = (txt: string): boolean =>
    /^(?:конец|return\b|выход|end\b)/i.test(txt.trim());

  // Find start terminators (strictly excluding return / Конец terminators even if unlinked)
  const startTerminators = clonedNodes
    .filter(
      (n) =>
        n.type === 'terminator' &&
        !isEndTerminatorText(n.text) &&
        (/^начало/i.test(n.text.trim()) ||
          isMainHeaderLine(n.text) ||
          !edges.some((e) => e.to === n.id && e.style !== 'dashed'))
    )
    .sort((a, b) => a.cx - b.cx || a.y - b.y);

  const visitedGlobal = new Set<string>();
  const handledDoWhileCondIds = new Set<string>();
  let mainHeaderLineNums: number[] = [];

  const isReachable = (
    startId: string | null,
    targetId: string,
    stopId: string | null = null
  ): boolean => {
    if (!startId) return false;
    if (startId === targetId) return true;
    const queue: string[] = [startId];
    const seen = new Set<string>([startId]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === targetId) return true;
      if (stopId && cur === stopId) continue;
      for (const e of getOutgoing(cur)) {
        if (e.to && !seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
    return false;
  };

  const normalizeCondition = (raw: string, keyword: 'if' | 'for' | 'while' | 'switch'): string => {
    let t = raw.replace(/\s+/g, ' ').trim();
    const re = new RegExp(`^${keyword}\\s*\\(([\\s\\S]*)\\)\\s*;?$`, 'i');
    const m = t.match(re);
    if (m) return m[1].trim();
    if (t.toLowerCase().startsWith(keyword + ' ')) {
      t = t.slice(keyword.length).trim().replace(/;$/, '').trim();
    }
    if (t.startsWith('(') && t.endsWith(')')) {
      return t.slice(1, -1).trim();
    }
    return t || 'true';
  };

  const ensureSemicolon = (stmt: string): string => {
    const t = stmt.trim();
    if (!t) return '';
    if (t.endsWith(';') || t.endsWith('}')) return t;
    return t + ';';
  };

  const splitExpressions = (text: string): string[] => {
    const parts: string[] = [];
    let quote = '', depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(text.slice(start).trim());
    return parts.filter(Boolean);
  };

  const isCaseDiamondNode = (nd: FlowNode | undefined): boolean =>
    Boolean(nd && nd.type === 'decision' && /^(?:case\b|case\d|default\b)/i.test(nd.text.trim()));

  const isYesLabel = (lbl: string): boolean => /^(?:да|yes|true|1)$/i.test(lbl.trim());
  const isNoLabel = (lbl: string): boolean => /^(?:нет|no|false|0)$/i.test(lbl.trim());

  const emitNodeSequence = (
    startNodeId: string | null,
    stopNodeId: string | null,
    indent: string,
    callStack: Set<string>
  ) => {
    let currId = startNodeId;
    let safety = 0;

    while (currId && currId !== stopNodeId && safety < 250) {
      safety++;
      if (callStack.has(currId)) break;
      const node = nodeMap.get(currId);
      if (!node) break;

      if (node.loopBoundary) {
        currId = getOutgoing(node.id)[0]?.to || null;
        continue;
      }
      // A generated precondition-loop entry is a flowline junction, not a
      // postcondition loop. It has a single downstream edge to that header.
      if (node.type === 'connector') {
        const outgoing = getOutgoing(node.id);
        const target = outgoing.length === 1 && outgoing[0].to ? nodeMap.get(outgoing[0].to) : undefined;
        if (target?.control?.kind === 'loop') { currId = target.id; continue; }
      }

      // Generated graphs carry explicit region boundaries. This avoids mistaking
      // an inner connector, early return, or fallthrough body for an outer join.
      const control = node.control;
      const references = control ? [control.joinId, control.bodyId, control.yesId,
        control.noId, control.conditionId, ...(control.kind === 'dowhile' ? [control.keyword] : []), ...(control.cases || []).flatMap(c => [c.entryId, c.stopId])].filter(Boolean) : [];
      if (control && references.every(id => nodeMap.has(id!))) {
        const stack = new Set(callStack); stack.add(node.id);
        visitedGlobal.add(node.id);
        if (!getOutgoing(node.id).length) { currId = null; continue; }
        if (control.kind === 'if') {
          // Branch topology remains editable: metadata supplies only the region
          // boundary, while the current labeled edges choose the branch bodies.
          const actual = getOutgoing(node.id);
          const yesTarget = actual.find(e => isYesLabel(e.rightLabel || e.leftLabel))?.to;
          const noTarget = actual.find(e => isNoLabel(e.rightLabel || e.leftLabel))?.to;
          const cond = normalizeCondition(node.text, 'if');
          pushLine(`${indent}if (${cond})`, [node.id]);
          pushLine(`${indent}{`, [node.id]);
          if (yesTarget && yesTarget !== control.joinId) emitNodeSequence(yesTarget, control.joinId, indent + '    ', stack);
          pushLine(`${indent}}`, [node.id]);
          if (noTarget && noTarget !== control.joinId) {
            pushLine(`${indent}else`, [node.id]);
            pushLine(`${indent}{`, [node.id]);
            emitNodeSequence(noTarget, control.joinId, indent + '    ', stack);
            pushLine(`${indent}}`, [node.id]);
          }
        } else if (control.kind === 'switch') {
          const reachable = new Set<string>();
          const pending = [node.id];
          while (pending.length) {
            const id = pending.pop()!;
            if (reachable.has(id) || id === control.joinId) continue;
            reachable.add(id);
            for (const e of getOutgoing(id)) if (e.to) pending.push(e.to);
          }
          let fallback = getOutgoing(node.id)[0]?.to || null;
          const seenDispatch = new Set<string>();
          while (fallback && !seenDispatch.has(fallback) && isCaseDiamondNode(nodeMap.get(fallback))) {
            seenDispatch.add(fallback);
            fallback = getOutgoing(fallback).find(e => isNoLabel(e.rightLabel || e.leftLabel))?.to || null;
          }
          pushLine(`${indent}switch (${normalizeCondition(node.text, 'switch')})`, [node.id]);
          pushLine(`${indent}{`, [node.id]);
          for (const c of control.cases || []) {
            if (!reachable.has(c.entryId)) continue;
            for (const source of control.cases || []) source.labels.forEach((original, i) => {
              const labelNode = nodeMap.get(source.labelIds?.[i] || '');
              const liveTarget = labelNode ? getOutgoing(labelNode.id).find(e => isYesLabel(e.rightLabel || e.leftLabel))?.to
                : source.labelIds?.[i] ? null : original === 'default' ? fallback : source.entryId;
              if (liveTarget !== c.entryId || (labelNode && !reachable.has(labelNode.id))) return;
              const label = labelNode?.text.replace(/^case\s*/i, '').replace(/:\s*$/, '').trim() || original;
              pushLine(`${indent}    ${label === 'default' ? 'default:' : 'case ' + label + ':'}`, [c.entryId, ...(labelNode ? [labelNode.id] : [])]);
            });
            if (c.hasBraces) pushLine(`${indent}    {`, [c.entryId]);
            emitNodeSequence(c.entryId, c.stopId, indent + '        ', new Set([...stack, control.joinId]));
            if (c.hasBraces) pushLine(`${indent}    }`, [c.entryId]);
          }
          pushLine(`${indent}}`, [node.id]);
        } else if (control.kind === 'loop') {
          const keyword = control.keyword === 'for' ? 'for' : 'while';
          pushLine(`${indent}${keyword} (${normalizeCondition(node.text, keyword)})`, [node.id]);
          pushLine(`${indent}{`, [node.id]);
          const body = getOutgoing(node.id).find(e => isYesLabel(e.rightLabel || e.leftLabel))?.to;
          const bodyNode = body ? nodeMap.get(body) : undefined;
          const emptyReturn = bodyNode?.type === 'connector' && getOutgoing(bodyNode.id)[0]?.to === node.id;
          if (body && body !== node.id && !emptyReturn) emitNodeSequence(body, node.id, indent + '    ', stack);
          pushLine(`${indent}}`, [node.id]);
        } else {
          const condition = nodeMap.get(control.conditionId!)!;
          pushLine(`${indent}do`, [node.id]);
          pushLine(`${indent}{`, [node.id]);
          const liveBody = getOutgoing(node.id)[0]?.to;
          if (liveBody && liveBody !== control.keyword && liveBody !== condition.id) emitNodeSequence(liveBody, control.keyword || condition.id, indent + '    ', stack);
          pushLine(`${indent}} while (${normalizeCondition(condition.text, 'while')});`, [condition.id]);
        }
        currId = isReachable(node.id, control.joinId) ? control.joinId : null;
        continue;
      }

      // 0. Check if `currId` is the top entry point of a `do ... while` post-condition loop:
      // Look for any decision diamond `condNode` below `node` that has an upward back-edge into `currId`
      // while `node` itself is not a pre-condition `for`/`while` header bypassing `condNode`.
      const incomingBackFromDecision = edges
        .filter((e) => {
          if (e.to !== currId || !e.from || e.style === 'dashed') return false;
          if (handledDoWhileCondIds.has(e.from)) return false;
          const srcNode = nodeMap.get(e.from);
          if (!srcNode || srcNode.type !== 'decision' || isCaseDiamondNode(srcNode)) return false;
          const isUpward = e.style === 'loop_left' || srcNode.y > node.y + 10;
          if (!isUpward) return false;
          if (isNoLabel(e.rightLabel || e.leftLabel)) return false;
          if (!isReachable(currId, srcNode.id, stopNodeId)) return false;

          // Make sure `node` is not a pre-condition while/for header whose own exit bypasses `srcNode`
          if (node.type === 'prep') return false;
          if (node.type === 'decision' && /^for\b/i.test(node.text.trim())) return false;
          if (node.type === 'decision') {
            const nodeOuts = getOutgoing(node.id);
            const hasBypass = nodeOuts.some(
              (oe) =>
                oe.style === 'bypass_right' ||
                (isNoLabel(oe.rightLabel || oe.leftLabel) &&
                  oe.to &&
                  !isReachable(oe.to, srcNode.id, stopNodeId))
            );
            if (hasBypass) return false;
          }

          // If `srcNode` has another upward back-edge to an inner entry node strictly between `node` and `srcNode`,
          // then `srcNode` belongs to that inner do-while loop, and the edge into `node` is only the outer loop return.
          const srcOuts = getOutgoing(srcNode.id);
          const hasInnerBackTarget = srcOuts.some((soe) => {
            if (soe.id === e.id || !soe.to) return false;
            const otherTgt = nodeMap.get(soe.to);
            if (!otherTgt) return false;
            return otherTgt.y > node.y + 8 && otherTgt.y < srcNode.y - 8;
          });
          if (hasInnerBackTarget) return false;

          return true;
        })
        .sort((a, b) => {
          const na = nodeMap.get(a.from!)!;
          const nb = nodeMap.get(b.from!)!;
          return nb.y - na.y;
        });

      if (incomingBackFromDecision.length > 0) {
        const backEdge = incomingBackFromDecision[0];
        const condNode = nodeMap.get(backEdge.from!)!;
        handledDoWhileCondIds.add(condNode.id);

        pushLine(`${indent}do`, [node.id, condNode.id]);
        pushLine(`${indent}{`, [node.id]);

        const bodyStart = node.type === 'connector' ? getOutgoing(node.id)[0]?.to || null : currId;
        if (node.type === 'connector') {
          visitedGlobal.add(node.id);
        }
        if (bodyStart && bodyStart !== condNode.id) {
          emitNodeSequence(bodyStart, condNode.id, indent + '    ', callStack);
        }

        visitedGlobal.add(condNode.id);
        const cond = normalizeCondition(condNode.text, 'while');
        pushLine(`${indent}} while (${cond});`, [condNode.id]);

        const cOuts = getOutgoing(condNode.id);
        const exitEdge =
          cOuts.find((e) => e.id !== backEdge.id && isNoLabel(e.rightLabel || e.leftLabel)) ||
          cOuts.find((e) => e.id !== backEdge.id);
        currId = exitEdge?.to || null;
        continue;
      }

      visitedGlobal.add(currId);
      const nextStack = new Set(callStack);
      nextStack.add(currId);

      const outs = getOutgoing(currId);

      // Connector node: just continue
      if (node.type === 'connector') {
        const nextEdge = outs[0];
        currId = nextEdge ? nextEdge.to : null;
        continue;
      }

      // End terminator (`return 0;` or `Конец`)
      if (node.type === 'terminator' && !/^начало/i.test(node.text.trim())) {
        const txt = node.text.trim();
        if (/^return\b/.test(txt)) {
          pushLine(`${indent}${ensureSemicolon(txt)}`, [node.id]);
        }
        break;
      }

      // Loop via GOST loop_start .. loop_end (supports for, while, and do-while)
      if (node.type === 'loop_start') {
        const startLines = node.text
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const startNonIdLines = startLines.filter((l) => !/^цикл\s*\d*$/i.test(l) && !/^do$/i.test(l));

        // Find matching loop_end with nesting depth tracking
        const nextEdge = outs[0];
        let cursor = nextEdge?.to || null;
        let matchingEndId: string | null = null;
        let depth = 1;
        const probeVisited = new Set<string>();
        while (cursor && !probeVisited.has(cursor)) {
          probeVisited.add(cursor);
          const cn = nodeMap.get(cursor);
          if (cn?.type === 'loop_start') {
            depth++;
          } else if (cn?.type === 'loop_end') {
            depth--;
            if (depth === 0) {
              matchingEndId = cn.id;
              break;
            }
          }
          const co = getOutgoing(cursor);
          cursor = co[0]?.to || null;
        }

        const endNodeObj = matchingEndId ? nodeMap.get(matchingEndId) : undefined;
        const endLines = endNodeObj
          ? endNodeObj.text
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const endCondLines = endLines.filter((l) => !/^цикл\s*\d*$/i.test(l));

        // If loop_start has no condition and loop_end has the condition -> do ... while (...)
        if (startNonIdLines.length === 0 && endCondLines.length > 0) {
          const rawEndCond = endCondLines.join(' ');
          const cond = normalizeCondition(rawEndCond, 'while');
          pushLine(`${indent}do`, [node.id]);
          pushLine(`${indent}{`, [node.id]);
          if (nextEdge?.to) {
            emitNodeSequence(nextEdge.to, matchingEndId, indent + '    ', nextStack);
          }
          if (matchingEndId) visitedGlobal.add(matchingEndId);
          pushLine(
            `${indent}} while (${cond});`,
            matchingEndId ? [matchingEndId] : [node.id]
          );
        } else {
          const rawHdr = startNonIdLines.join(' ') || startLines[0] || 'int i = 0; i < 10; i++';
          if (/^while\b/i.test(rawHdr) || (!rawHdr.includes(';') && !/^for\b/i.test(rawHdr) && startNonIdLines.length > 0)) {
            const cond = normalizeCondition(rawHdr, 'while');
            pushLine(`${indent}while (${cond})`, [node.id]);
          } else {
            const hdr = normalizeCondition(rawHdr, 'for');
            pushLine(
              `${indent}for (${hdr.includes(';') ? hdr : 'int i = 0; i < 10; i++'})`,
              [node.id]
            );
          }
          pushLine(`${indent}{`, [node.id]);

          if (nextEdge?.to) {
            emitNodeSequence(nextEdge.to, matchingEndId, indent + '    ', nextStack);
          }
          if (matchingEndId) visitedGlobal.add(matchingEndId);
          pushLine(`${indent}}`, matchingEndId ? [matchingEndId] : [node.id]);
        }

        if (matchingEndId) {
          const afterEnd = getOutgoing(matchingEndId)[0];
          currId = afterEnd ? afterEnd.to : null;
        } else {
          currId = null;
        }
        continue;
      }

      // Loop via 'prep' hexagon (for / while loop)
      if (node.type === 'prep') {
        const rawTxt = node.text.trim();
        if (/^while\b/i.test(rawTxt) && !rawTxt.includes(';')) {
          const cond = normalizeCondition(rawTxt, 'while');
          pushLine(`${indent}while (${cond})`, [node.id]);
        } else {
          const hdr = normalizeCondition(rawTxt, 'for');
          pushLine(`${indent}for (${hdr})`, [node.id]);
        }
        pushLine(`${indent}{`, [node.id]);

        // Also support back-edges that enter a connector immediately above `node.id`
        const incomingBackEdges = edges.filter((e) => {
          if (e.style === 'dashed' || !e.from) return false;
          const src = nodeMap.get(e.from);
          if (!src) return false;
          const isUp = e.style === 'loop_left' || src.y > node.y + 10;
          if (!isUp) return false;
          if (e.to === node.id) return true;
          const tgt = e.to ? nodeMap.get(e.to) : undefined;
          return Boolean(tgt?.type === 'connector' && getOutgoing(tgt.id)[0]?.to === node.id);
        });

        const exitEdge =
          outs.find((e) => e.style === 'bypass_right' || isNoLabel(e.rightLabel || e.leftLabel)) ||
          outs.find(
            (e) =>
              e.to &&
              incomingBackEdges.length > 0 &&
              !incomingBackEdges.some((be) => isReachable(e.to, be.from!, node.id))
          ) ||
          outs.find((e) => e.fromPort === 'right');
        const bodyEdge =
          outs.find((e) => e !== exitEdge && isYesLabel(e.rightLabel || e.leftLabel)) ||
          outs.find((e) => e !== exitEdge) ||
          outs[0];

        if (bodyEdge && bodyEdge.to && bodyEdge.to !== node.id) {
          emitNodeSequence(bodyEdge.to, node.id, indent + '    ', nextStack);
        }
        pushLine(`${indent}}`, [node.id]);

        if (exitEdge && exitEdge.to) {
          currId = exitEdge.to;
        } else {
          currId = null;
        }
        continue;
      }

      const formatCaseHeader = (rawTxt: string): string => {
        const clean = rawTxt.replace(/\s+/g, ' ').trim().replace(/:$/, '').trim();
        if (/^default$/i.test(clean)) return 'default:';
        const val = clean.replace(/^case\s*/i, '').trim() || '1';
        return `case ${val}:`;
      };

      const getCaseRightAndDownEdges = (caseNodeId: string) => {
        const cOuts = getOutgoing(caseNodeId);
        const rightEdge =
          cOuts.find((e) => /^(?:1|да|yes|true)$/i.test((e.rightLabel || e.leftLabel).trim())) ||
          cOuts.find((e) => e.fromPort === 'right' || e.fromPort === 'left') ||
          cOuts[0];
        const downEdge =
          cOuts.find(
            (e) =>
              e !== rightEdge &&
              (/^(?:0|нет|no|false)$/i.test((e.rightLabel || e.leftLabel).trim()) || e.fromPort === 'bottom')
          ) || cOuts.find((e) => e !== rightEdge);
        return { rightEdge, downEdge };
      };

      const emitCascadeSwitch = (headerNode: FlowNode, firstCaseId: string | null): string | null => {
        const isExplicitSwitch = /^switch\b/i.test(headerNode.text.trim());
        const expr = isExplicitSwitch ? normalizeCondition(headerNode.text, 'switch') : 'a';
        pushLine(`${indent}switch (${expr})`, [headerNode.id]);
        pushLine(`${indent}{`, [headerNode.id]);

        let caseCursorId: string | null = firstCaseId;
        const visitedCases = new Set<string>();

        while (caseCursorId && !visitedCases.has(caseCursorId)) {
          const caseNode = nodeMap.get(caseCursorId);
          if (!isCaseDiamondNode(caseNode) || !caseNode) break;

          visitedCases.add(caseNode.id);
          visitedGlobal.add(caseNode.id);
          pushLine(`${indent}    ${formatCaseHeader(caseNode.text)}`, [caseNode.id]);

          const { rightEdge, downEdge } = getCaseRightAndDownEdges(caseNode.id);
          const nextCaseNode = downEdge?.to ? nodeMap.get(downEdge.to) : undefined;

          // Check if this case diamond falls through into the exact same connector as the next case diamond
          let isFallthroughToSharedConnector = false;
          if (rightEdge?.to && isCaseDiamondNode(nextCaseNode) && nextCaseNode) {
            const targetRight = nodeMap.get(rightEdge.to);
            if (targetRight?.type === 'connector') {
              const nextEdges = getCaseRightAndDownEdges(nextCaseNode.id);
              if (nextEdges.rightEdge?.to === targetRight.id) {
                isFallthroughToSharedConnector = true;
              }
            }
          }

          if (!isFallthroughToSharedConnector) {
            let hCurrId: string | null = rightEdge?.to || null;
            if (hCurrId && nodeMap.get(hCurrId)?.type === 'connector') {
              visitedGlobal.add(hCurrId);
              hCurrId = getOutgoing(hCurrId)[0]?.to || null;
            }

            let emittedBreak = false;
            const visitedHoriz = new Set<string>();
            while (hCurrId && !visitedHoriz.has(hCurrId)) {
              visitedHoriz.add(hCurrId);
              const hNode = nodeMap.get(hCurrId);
              if (!hNode || hNode.type === 'connector' || isCaseDiamondNode(hNode)) break;
              if (hNode.type === 'terminator' && !/^return\b/i.test(hNode.text.trim())) break;

              visitedGlobal.add(hNode.id);
              const hTxt = hNode.text.trim();
              if (/^br(?:ea|a)ke?\s*;?$/i.test(hTxt)) {
                pushLine(`${indent}        break;`, [hNode.id]);
                emittedBreak = true;
                break;
              }

              const hLines = hNode.text
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean);

              if (hNode.type === 'io') {
                const joined = hLines.join(' ');
                if (/^(?:cin|cout|cerr|printf|scanf|getline)\b/.test(joined)) {
                  pushLine(`${indent}        ${ensureSemicolon(joined)}`, [hNode.id]);
                } else if (/^ввод[:\s]+/i.test(joined)) {
                  const vars = splitExpressions(joined.replace(/^ввод[:\s]+/i, ''));
                  pushLine(`${indent}        cin >> ${vars.join(' >> ')};`, [hNode.id]);
                } else if (/^вывод[:\s]+/i.test(joined)) {
                  const ex = splitExpressions(joined.replace(/^вывод[:\s]+/i, '')).join(' << ');
                  pushLine(`${indent}        cout << ${ex} << endl;`, [hNode.id]);
                } else {
                  pushLine(`${indent}        ${ensureSemicolon(joined)}`, [hNode.id]);
                }
              } else if (hNode.type !== 'brace' && hNode.type !== 'comment') {
                hLines.forEach((ln) => {
                  if (/^br(?:ea|a)ke?\s*;?$/i.test(ln)) {
                    pushLine(`${indent}        break;`, [hNode.id]);
                    emittedBreak = true;
                  } else {
                    pushLine(`${indent}        ${ensureSemicolon(ln)}`, [hNode.id]);
                  }
                });
              }

              const hOuts = getOutgoing(hNode.id);
              hCurrId = hOuts[0]?.to || null;
            }

            if (!emittedBreak) {
              pushLine(`${indent}        break;`, [caseNode.id]);
            }
          }

          caseCursorId = downEdge?.to || null;
        }

        pushLine(`${indent}}`, [headerNode.id]);
        if (caseCursorId && nodeMap.get(caseCursorId)?.type === 'connector') {
          visitedGlobal.add(caseCursorId);
          return getOutgoing(caseCursorId)[0]?.to || null;
        }
        return caseCursorId;
      };

      // Process block with switch (...) followed by vertical case diamonds
      if (node.type === 'process' && /^switch\b/i.test(node.text.trim())) {
        const firstTargetId = outs[0]?.to || null;
        currId = emitCascadeSwitch(node, firstTargetId);
        continue;
      }

      // Decision diamond: could be while/for pre-condition loop, cascade switch-case, multi-branch switch-case, or if-else
      if (node.type === 'decision') {
        const rawText = node.text.trim();

        // Check if this decision node is itself a standalone cascade of `case ...:` diamonds
        if (isCaseDiamondNode(node)) {
          currId = emitCascadeSwitch(node, node.id);
          continue;
        }

        // Check if there is an upward loop back-edge into this decision node (excluding do-while back-edges)
        const isExplicitIf = /^if\b/i.test(rawText);
        const incomingBackEdges = isExplicitIf
          ? []
          : edges.filter((e) => {
              if (e.style === 'dashed' || !e.from) return false;
              if (handledDoWhileCondIds.has(e.from)) return false;
              const src = nodeMap.get(e.from);
              if (!src) return false;
              const isUp = e.style === 'loop_left' || src.y > node.y + 10;
              if (!isUp) return false;
              if (!isReachable(node.id, src.id, stopNodeId)) return false;
              if (e.to === node.id) return true;
              const tgt = e.to ? nodeMap.get(e.to) : undefined;
              return Boolean(
                tgt?.type === 'connector' &&
                  !visitedGlobal.has(tgt.id) &&
                  getOutgoing(tgt.id)[0]?.to === node.id
              );
            });

        const isForDiamond = /^for\b/i.test(rawText) || (rawText.match(/;/g) || []).length >= 2;
        const isWhileDiamond = /^while\b/i.test(rawText);

        if (incomingBackEdges.length > 0 || isForDiamond || isWhileDiamond) {
          if (isForDiamond) {
            const hdr = normalizeCondition(rawText, 'for');
            pushLine(`${indent}for (${hdr})`, [node.id]);
          } else {
            const cond = normalizeCondition(rawText, 'while');
            pushLine(`${indent}while (${cond})`, [node.id]);
          }
          pushLine(`${indent}{`, [node.id]);

          // Identify bodyEdge (branch that leads into the loop body and returns via incomingBackEdges, or labeled Да/1)
          const bodyEdge =
            outs.find((e) => isYesLabel(e.rightLabel || e.leftLabel)) ||
            outs.find(
              (e) =>
                e.to &&
                incomingBackEdges.some((be) => isReachable(e.to, be.from!, node.id))
            ) ||
            outs.find((e) => e.style !== 'bypass_right' && !isNoLabel(e.rightLabel || e.leftLabel)) ||
            outs[0];

          const exitEdge =
            outs.find((e) => e !== bodyEdge && (e.style === 'bypass_right' || isNoLabel(e.rightLabel || e.leftLabel))) ||
            outs.find((e) => e !== bodyEdge);

          if (bodyEdge && bodyEdge.to && bodyEdge.to !== node.id) {
            emitNodeSequence(bodyEdge.to, node.id, indent + '    ', nextStack);
          }
          pushLine(`${indent}}`, [node.id]);
          currId = exitEdge?.to || null;
          continue;
        }

        // Check if switch-case (either cascade of case diamonds or multi-branch)
        if (/^switch\b/i.test(rawText) || outs.length > 2) {
          const firstTarget = outs[0]?.to ? nodeMap.get(outs[0].to) : undefined;
          if (outs.length === 1 && isCaseDiamondNode(firstTarget)) {
            currId = emitCascadeSwitch(node, outs[0].to);
            continue;
          }

          const expr = normalizeCondition(rawText, 'switch');
          pushLine(`${indent}switch (${expr})`, [node.id]);
          pushLine(`${indent}{`, [node.id]);

          // Find join connector
          let joinId: string | null = null;
          for (const br of outs) {
            let probe = br.to;
            const seen = new Set<string>();
            while (probe && !seen.has(probe)) {
              seen.add(probe);
              const pn = nodeMap.get(probe);
              if (pn?.type === 'connector') {
                joinId = pn.id;
                break;
              }
              probe = getOutgoing(probe)[0]?.to || null;
            }
            if (joinId) break;
          }

          outs.forEach((br) => {
            const rawLbl = (br.rightLabel || br.leftLabel || '').replace(/^==\s*/, '').trim();
            if (!rawLbl || rawLbl === 'default') {
              pushLine(`${indent}    default:`, [node.id]);
            } else {
              pushLine(`${indent}    case ${rawLbl}:`, [node.id]);
            }
            if (br.to) {
              emitNodeSequence(br.to, joinId, indent + '        ', nextStack);
            }
            pushLine(`${indent}        break;`, [node.id]);
          });

          pushLine(`${indent}}`, [node.id]);
          currId = joinId ? getOutgoing(joinId)[0]?.to || null : null;
          continue;
        }

        // Standard if / else diamond
        const cond = normalizeCondition(rawText, 'if');
        pushLine(`${indent}if (${cond})`, [node.id]);
        pushLine(`${indent}{`, [node.id]);

        const yesEdge =
          outs.find((e) => /да|yes|true|1/i.test(e.rightLabel || e.leftLabel)) ||
          outs.find((e) => e.fromPort === 'left' || e.fromPort === 'bottom') ||
          outs[0];
        const noEdge = outs.find((e) => e !== yesEdge);

        // Find merge connector reachable from yesEdge or noEdge
        const findReachableConnector = (start: string | null): string | null => {
          let p = start;
          const seen = new Set<string>();
          while (p && !seen.has(p)) {
            seen.add(p);
            const pn = nodeMap.get(p);
            if (pn?.type === 'connector') return pn.id;
            const po = getOutgoing(p);
            p = po[0]?.to || null;
          }
          return null;
        };

        const mergeId =
          (noEdge?.to && nodeMap.get(noEdge.to)?.type === 'connector' ? noEdge.to : null) ||
          findReachableConnector(yesEdge?.to || null) ||
          findReachableConnector(noEdge?.to || null);

        if (yesEdge?.to && yesEdge.to !== mergeId) {
          emitNodeSequence(yesEdge.to, mergeId, indent + '    ', nextStack);
        }
        pushLine(`${indent}}`, [node.id]);

        if (noEdge?.to && noEdge.to !== mergeId) {
          pushLine(`${indent}else`, [node.id]);
          pushLine(`${indent}{`, [node.id]);
          emitNodeSequence(noEdge.to, mergeId, indent + '    ', nextStack);
          pushLine(`${indent}}`, [node.id]);
        }

        currId = mergeId ? getOutgoing(mergeId)[0]?.to || null : null;
        continue;
      }

      // Regular process / IO / predefined / storage node
      const rawLines = (node.sourceText || node.text)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      if (node.type === 'io') {
        const exact = node.sourceText || node.text;
        const joined = rawLines.join(' ');
        if (/^(?:std::)?(?:w?cin|w?cout|w?cerr|printf|scanf|getline)\b/.test(joined)) {
          const lines = ensureSemicolon(exact).split('\n');
          lines.forEach(line => pushLine(indent + line, [node.id]));
        } else if (/^ввод[:\s]+/i.test(joined)) {
          const vars = splitExpressions(joined.replace(/^ввод[:\s]+/i, ''));
          pushLine(`${indent}cin >> ${vars.join(' >> ')};`, [node.id]);
        } else if (/^вывод[:\s]+/i.test(joined)) {
          const expr = splitExpressions(joined.replace(/^вывод[:\s]+/i, '')).join(' << ');
          pushLine(`${indent}cout << ${expr} << endl;`, [node.id]);
        } else {
          pushLine(`${indent}${ensureSemicolon(joined)}`, [node.id]);
        }
      } else if (node.type !== 'brace' && node.type !== 'comment') {
        rawLines.forEach((ln) => {
          // If the user has an `int main()` block on the canvas, link it to the outer main() header instead of duplicating it!
          if (isMainHeaderLine(ln)) {
            mainHeaderLineNums.forEach((lineNo) => {
              if (!node.sourceLines?.includes(lineNo)) {
                node.sourceLines = [...(node.sourceLines || []), lineNo];
              }
            });
            return;
          }
          if (/^br(?:ea|a)ke?\s*;?$/i.test(ln)) {
            pushLine(`${indent}break;`, [node.id]);
          } else {
            pushLine(`${indent}${ensureSemicolon(ln)}`, [node.id]);
          }
        });
      }

      if (/^(?:return|break|continue)\b/.test(node.text.trim())) break;
      const nextEdge = outs[0];
      currId = nextEdge ? nextEdge.to : null;
    }
  };

  const existingMainNodes = clonedNodes.filter((n) => isMainHeaderLine(n.text));

  if (startTerminators.length === 0) {
    // Fallback if user drew a flowchart without a 'Начало' terminator:
    // link any existing `int main()` block on the canvas to the outer main() header
    const mainNodeIds = existingMainNodes.map((n) => n.id);
    pushLine('int main()', mainNodeIds);
    const hdrLine = outLines.length;
    pushLine('{', mainNodeIds);
    mainHeaderLineNums = [hdrLine, outLines.length];

    const functional = clonedNodes.filter(
      (n) => n.type !== 'brace' && n.type !== 'comment' && n.type !== 'connector'
    );
    const roots = functional
      .filter((n) => !edges.some((e) => e.to === n.id && e.style !== 'dashed'))
      .sort((a, b) => a.y - b.y || a.cx - b.cx);
    const entryNodes = roots.length > 0 ? roots : [...functional].sort((a, b) => a.y - b.y);
    entryNodes.forEach((rn) => {
      if (!visitedGlobal.has(rn.id)) {
        emitNodeSequence(rn.id, null, '    ', new Set());
      }
    });
    if (!outLines.some((l) => /\breturn\b/.test(l))) {
      pushLine('    return 0;');
    }
    pushLine('}', mainNodeIds);
  } else {
    let emittedMainAlready = false;
    startTerminators.forEach((startNode, idx) => {
      const firstOut = getOutgoing(startNode.id)[0];
      let bodyStartId = firstOut?.to || null;
      let fnHeader = 'int main()';
      const headerNodeIds = [startNode.id];

      // Check if startNode itself has a custom function name like "Начало calcSum"
      const customStartMatch = startNode.text.trim().match(/^начало\s+([a-zA-Z_]\w*)/i);
      if (customStartMatch && customStartMatch[1].toLowerCase() !== 'main') {
        fnHeader = `void ${customStartMatch[1]}()`;
      }

      if (bodyStartId) {
        const firstTarget = nodeMap.get(bodyStartId);
        if (
          firstTarget &&
          (isMainHeaderLine(firstTarget.text) ||
            functionHeaderName(firstTarget.text))
        ) {
          const cleanHdr = firstTarget.text.trim().replace(/;$/, '');
          fnHeader = isMainHeaderLine(cleanHdr) ? 'int main()' : cleanHdr;
          headerNodeIds.push(firstTarget.id);
          visitedGlobal.add(firstTarget.id);
          bodyStartId = getOutgoing(firstTarget.id)[0]?.to || null;
        }
      }

      const isMainFn = isMainHeaderLine(fnHeader);
      if (isMainFn) {
        existingMainNodes.forEach((mn) => {
          if (!headerNodeIds.includes(mn.id)) headerNodeIds.push(mn.id);
        });
      }

      // Never emit two `int main()` functions if there are multiple start terminators without custom function names
      if (isMainFn && emittedMainAlready) {
        if (bodyStartId && !visitedGlobal.has(bodyStartId)) {
          emitNodeSequence(bodyStartId, null, '    ', new Set([startNode.id]));
        }
        return;
      }

      if (idx > 0 && outLines[outLines.length - 1] !== '') pushLine('');
      pushLine(fnHeader, headerNodeIds);
      const hdrLine = outLines.length;
      pushLine('{', headerNodeIds);
      if (isMainFn) {
        emittedMainAlready = true;
        mainHeaderLineNums = [hdrLine, outLines.length];
      }
      emitNodeSequence(bodyStartId, null, '    ', new Set([startNode.id]));
      if (isMainFn && !outLines.slice(hdrLine).some((l) => /\breturn\b/.test(l))) {
        pushLine('    return 0;', headerNodeIds);
      }
      pushLine('}', headerNodeIds);
    });
  }

  return {
    code: outLines.join('\n'),
    updatedNodes: clonedNodes,
  };
}
