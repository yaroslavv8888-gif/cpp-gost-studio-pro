import { hasUserSubprogramCall, userSubprogramNames } from './userSubprograms';
import { FlowEdge, FlowNode, GostIssue } from '../types/flow';
import { calcAutoSize, getEdgePoints, TRACK_GAP, sharesCollector } from './orthoRouter';

/** Construction/allocation is an operation, not a call to a predefined routine.
 * Check each statement so grouped declarations cannot hide later function calls. */
function hasRoutineCall(code: string, names: Set<string>): boolean {
  return code.split(';').some(raw => {
    const statement = raw.trim();
    if (!statement) return false;
    if (/^(?:std::)?setlocale\s*\(/.test(statement)) return false;
    const knownDeclaration = /^(?:(?:const|static|constexpr|volatile|unsigned|signed|long|short)\s+)*(?:(?:std::)?(?:vector|array|deque|list|map|set|unordered_map|unordered_set|basic_string|string)\b|(?:int|double|float|long|short|char|bool|size_t|auto)\b)/.test(statement);
    const customConstruction = /^(?!(?:return|throw|co_return)\b)(?:(?:const|static|constexpr|volatile)\s+)*[A-Za-z_]\w*(?:::\w+)*(?:\s*<[^;{}]*>)?[\s*&]+[A-Za-z_]\w*\s*[({[]/.test(statement);
    const directConstruction = !statement.includes('=') && (knownDeclaration || customConstruction);
    // Array brace initialization remains one declaration even when its values
    // are computed by calls; a later scalar assignment still needs its symbol.
    const arrayInitialization = (knownDeclaration || customConstruction) &&
      /\b[A-Za-z_]\w*\s*(?:\[[^\]]*\]\s*)+\s*=\s*\{/.test(statement);
    const allocation = /^(?:delete\s*(?:\[\s*\])?\s+|(?:[\s\S]*?=\s*)?new\s+)/.test(statement);
    if (directConstruction || arrayInitialization || allocation) return false;
    return hasUserSubprogramCall(statement, names);
  });
}

export function validateGostFlowchart(nodes: FlowNode[], edges: FlowEdge[]): GostIssue[] {
  const issues: GostIssue[] = [];

  if (nodes.length === 0) {
    return issues;
  }

  const functionalNodes = nodes.filter((n) => n.type !== 'brace' && n.type !== 'comment');
  const terminators = functionalNodes.filter((n) => n.type === 'terminator');

  const startNodes = terminators.filter(
    (n) =>
      /^начало/i.test(n.text.trim()) ||
      !edges.some((e) => e.to === n.id && e.style !== 'dashed')
  );
  const endNodes = terminators.filter(
    (n) =>
      !startNodes.some((s) => s.id === n.id) ||
      /^(?:конец|return\b|выход)/i.test(n.text.trim())
  );

  // 1. Проверка наличия начального терминатора (п. 3.4.2 ГОСТ)
  if (startNodes.length === 0) {
    issues.push({
      id: 'missing_start_terminator',
      severity: 'error',
      gostClause: 'п. 3.4.2 ГОСТ 19.701-90',
      title: 'Отсутствует терминатор «Начало»',
      description: 'Вход в схему алгоритма должен обозначаться символом «Терминатор» с надписью «Начало».',
      fixType: 'add_start_terminator',
    });
  }

  // 2. Проверка наличия конечного терминатора (п. 3.4.2 ГОСТ)
  if (endNodes.length === 0) {
    issues.push({
      id: 'missing_end_terminator',
      severity: 'error',
      gostClause: 'п. 3.4.2 ГОСТ 19.701-90',
      title: 'Отсутствует терминатор завершения',
      description: 'Выход из алгоритма должен завершаться символом «Терминатор» (return 0; или «Конец»).',
      fixType: 'add_end_terminator',
    });
  }

  // 3. Проверка блоков «Решение» (п. 3.2.2.4 ГОСТ)
  functionalNodes
    .filter((n) => n.type === 'decision')
    .forEach((dec) => {
      const outs = edges.filter((e) => e.from === dec.id && e.style !== 'dashed');
      const isCaseNode = /^(?:case\b|case\d|default\b)/i.test(dec.text.trim());
      if (outs.length < 2) {
        issues.push({
          id: `decision_branches_${dec.id}`,
          severity: 'error',
          gostClause: 'п. 3.2.2.4 ГОСТ 19.701-90',
          title: `У блока «Решение» менее 2 выходов`,
          description: `Символ «Решение» (${dec.text.split('\n')[0] || 'без текста'}) имеет только ${outs.length} вых. линию. По ГОСТу требуется минимум две альтернативные ветви.`,
          nodeId: dec.id,
        });
      } else {
        const unlabeled = outs.filter((e) => !e.rightLabel.trim() && !e.leftLabel.trim());
        if (unlabeled.length > 0) {
          issues.push({
            id: `decision_labels_${dec.id}`,
            severity: 'warning',
            gostClause: 'п. 3.2.2.4 ГОСТ',
            title: 'Не подписаны ветви выхода из «Решения»',
            description: isCaseNode
              ? `У выходов из условия «${dec.text.split('\n')[0]}» отсутствуют подписи условий («1» / «0»).`
              : `У выходов из условия «${dec.text.split('\n')[0]}» отсутствуют подписи условий («1» / «0»).`,
            nodeId: dec.id,
            fixType: 'add_decision_labels',
          });
        }
      }
    });

  // 4. Проверка парности «Граница цикла» (п. 3.2.2.6 ГОСТ)
  const loopStarts = functionalNodes.filter((n) => n.type === 'loop_start');
  const loopEnds = functionalNodes.filter((n) => n.type === 'loop_end');
  if (loopStarts.length !== loopEnds.length) {
    const targetNode = loopStarts[0] || loopEnds[0];
    issues.push({
      id: 'loop_bounds_mismatch',
      severity: 'error',
      gostClause: 'п. 3.2.2.6 ГОСТ 19.701-90',
      title: 'Непарные символы «Граница цикла»',
      description: `Найдено начал цикла: ${loopStarts.length}, концов цикла: ${loopEnds.length}. Символы границы цикла всегда используются парами.`,
      nodeId: targetNode?.id,
    });
  } else if (loopStarts.length > 0) {
    loopStarts.forEach((ls, idx) => {
      const le = loopEnds[idx];
      const startName = ls.text.split('\n')[0]?.trim() || '';
      const endLines = le.text.split('\n').map((s) => s.trim());
      if (startName && !endLines.includes(startName)) {
        issues.push({
          id: `loop_name_${ls.id}`,
          severity: 'warning',
          gostClause: 'п. 3.2.2.6 ГОСТ 19.701-90',
          title: 'Разные имена в границах одного цикла',
          description: `Имя в начале цикла («${startName}») должно совпадать с идентификатором в конце цикла («${le.text}»).`,
          nodeId: le.id,
          fixType: 'match_loop_bounds',
        });
      }
    });
  }

  // 5. Проверка связности (правило проекта)
  functionalNodes.forEach((n) => {
    const inEdges = edges.filter((e) => e.to === n.id && e.style !== 'dashed');
    const outEdges = edges.filter((e) => e.from === n.id && e.style !== 'dashed');
    const isStart = startNodes.some((s) => s.id === n.id);
    const isBreakNode = /^br(?:ea|a)ke?\s*;?$/i.test(n.text.trim());
    const isEnd = (endNodes.some((e) => e.id === n.id) && !isStart) || isBreakNode;

    if (!isStart && inEdges.length === 0) {
      issues.push({
        id: `no_incoming_${n.id}`,
        severity: 'error',
        gostClause: 'Правило проекта: связность',
        title: 'Блок не имеет входящей линии потока',
        description: `В символ «${n.text.split('\n')[0] || n.type}» не входит ни одна линия потока управления.`,
        nodeId: n.id,
        fixType: 'connect_dangling_to_end',
      });
    } else if (!isEnd && outEdges.length === 0) {
      issues.push({
        id: `no_outgoing_${n.id}`,
        severity: 'error',
        gostClause: 'Правило проекта: связность',
        title: 'Обрыв потока управления (нет выхода)',
        description: `Из символа «${n.text.split('\n')[0] || n.type}» не выходит линия потока к следующему шагу или терминатору.`,
        nodeId: n.id,
        fixType: 'connect_dangling_to_end',
      });
    }
  });

  // 6. Проверка пустых блоков (правило проекта)
  functionalNodes.forEach((n) => {
    if (n.type !== 'connector' && n.type !== 'parallel' && n.type !== 'omission' && !n.text.trim()) {
      issues.push({
        id: `empty_text_${n.id}`,
        severity: 'warning',
        gostClause: 'Правило проекта: текст символов',
        title: 'Пустой символ без описания операции',
        description: `Символ типа «${n.type}» не содержит текста внутри контура.`,
        nodeId: n.id,
        fixType: 'fill_empty_node_text',
      });
    }
  });

  // 7. Проверка комментариев (п. 3.4.3 ГОСТ)
  nodes
    .filter((n) => n.type === 'comment')
    .forEach((cNode) => {
      const connectedEdges = edges.filter((e) => e.from === cNode.id || e.to === cNode.id);
      if (connectedEdges.length === 0) {
        issues.push({
          id: `unlinked_comment_${cNode.id}`,
          severity: 'warning',
          gostClause: 'п. 3.4.3 ГОСТ 19.701-90',
          title: 'Комментарий не привязан пунктиром',
          description: `Символ «Комментарий» должен быть соединён пунктирной линией с комментируемым блоком или линией потока.`,
          nodeId: cNode.id,
        });
      } else {
        const nonDashed = connectedEdges.find((e) => e.style !== 'dashed');
        if (nonDashed) {
          issues.push({
            id: `solid_comment_edge_${nonDashed.id}`,
            severity: 'warning',
            gostClause: 'п. 3.4.3 ГОСТ 19.701-90',
            title: 'Сплошная линия у комментария вместо пунктира',
            description: 'По ГОСТ 19.701-90 связь с открытой скобкой комментария изображается только пунктирной линией.',
            edgeId: nonDashed.id,
            nodeId: cNode.id,
            fixType: 'fix_comment_dashed',
          });
        }
      }
    });

  // 8. Проверка наложения блоков (правило проекта)
  for (let i = 0; i < functionalNodes.length; i++) {
    for (let j = i + 1; j < functionalNodes.length; j++) {
      const a = functionalNodes[i];
      const b = functionalNodes[j];
      const overlapX = Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 - 6;
      const aMidY = a.y + a.h / 2;
      const bMidY = b.y + b.h / 2;
      const overlapY = Math.abs(aMidY - bMidY) < (a.h + b.h) / 2 - 6;
      if (overlapX && overlapY) {
        issues.push({
          id: `overlap_${a.id}_${b.id}`,
          severity: 'warning',
          gostClause: 'Правило проекта: геометрия',
          title: 'Пересечение контуров двух блоков',
          description: `Блоки «${a.text.split('\n')[0] || a.type}» и «${b.text.split('\n')[0] || b.type}» накладываются друг на друга.`,
          nodeId: b.id,
          fixType: 'separate_overlapping_nodes',
        });
      }
    }
  }

  validateProjectRules(functionalNodes, endNodes, nodes, edges, issues);
  return issues;
}

/** Project constraints intentionally stricter than the cited symbol definitions. */
function validateProjectRules(functional: FlowNode[], ends: FlowNode[], nodes: FlowNode[], edges: FlowEdge[], issues: GostIssue[]) {
  const userNames = userSubprogramNames(nodes, edges);
  const flow = edges.filter(e => e.style !== 'dashed');
  const byId = new Map(nodes.map(n => [n.id,n]));
  const junction = (n: FlowNode) => n.type === 'connector' && !n.text.trim() && n.w <= 8 && n.h <= 8;
  const report = (id: string, title: string, description: string, nodeId?: string, edgeId?: string) =>
    issues.push({id,title,description,nodeId,edgeId,severity:'error',gostClause:'Правило проекта: топология и геометрия'});
  for (const n of functional) {
    const incoming = flow.filter(e => e.to === n.id && !e.toEdge);
    const loopHeadInputs = (n.type === 'prep' || n.type === 'decision') && incoming.length === 2 &&
      incoming.filter(e => e.toPort === 'top').length === 1 &&
      incoming.filter(e => e.toPort === 'left' && (e.style === 'loop_left' || n.control?.kind === 'loop')).length === 1;
    if (!junction(n) && incoming.length > 1 && !loopHeadInputs)
      report(`multiple_inputs_${n.id}`, 'Несколько прямых входов в блок', 'Объедините ветви в узел на линии перед блоком.', n.id);
    if (n.type === 'decision' && flow.filter(e=>e.from===n.id && !e.fromEdge).length>3)
      report(`decision_outputs_${n.id}`, 'У решения более трёх прямых выходов', 'Используйте каскад решений или линию распределения (ограничение проекта).', n.id);
    if (n.type === 'process') {
      for (const e of incoming) {
        const source=byId.get(e.from || '');
        // 4.2.4 allows ordinary left inputs. Restrict only returns and branches.
        if (!/^(?:case\b|default\b)/.test(source?.text.trim() || '') && (e.toPort==='left' || e.toPort==='right') && (e.style==='loop_left' ||
          (source && source.y>n.y+n.h) || source?.type==='decision' ||
          (source && flow.filter(x=>x.from===source.id).length>1)))
          report(`invalid_process_port_${e.id}`, 'Возврат или ветвь входит сбоку в процесс', 'Сведите ветвь с основной линией перед блоком. Последовательный вход слева допустим.', n.id,e.id);
      }
      const code=n.text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'');
      if (hasRoutineCall(code, userNames))
        issues.push({id:`missing_predefined_${n.id}`,severity:'warning',gostClause:'п. 3.2.2.1 ГОСТ 19.701-90; правило проекта: вызовы пользовательских подпрограмм',title:'Вызов подпрограммы в обычном процессе',description:'Используйте символ «Предопределённый процесс» для вызова пользовательской подпрограммы, определённой отдельно.',nodeId:n.id});
    }
  }
  const groups=new Map<string,FlowNode[]>();
  for(const n of ends) { const key=n.fnId || '__algorithm'; groups.set(key,[...(groups.get(key)||[]),n]); }
  for(const [fn,ns] of groups) if(ns.length>1)
    report(`multiple_ends_${fn}`, 'Несколько конечных терминаторов в одной функции', 'Все выходы функции должны сходиться перед одним терминатором «Конец» (правило проекта).', ns[1].id);
  type Point={x:number;y:number};
  const eps=0.01;
  const rendered=flow.map(edge=>({edge,points:getEdgePoints(nodes,edges,edge)||[]}));
  const hitsBox=(a:Point,b:Point,n:FlowNode)=>{
    let lo=0,hi=1;
    for(const [v,d,min,max] of [[a.x,b.x-a.x,n.cx-n.w/2+eps,n.cx+n.w/2-eps],[a.y,b.y-a.y,n.y+eps,n.y+n.h-eps]]) {
      if(Math.abs(d)<eps) { if(v<=min || v>=max)return false; }
      else {const t1=(min-v)/d,t2=(max-v)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}
    }
    return hi>lo+eps && hi>0 && lo<1;
  };
  for(const {edge,points} of rendered) for(const n of functional) {
    if(n.id===edge.from || n.id===edge.to || junction(n))continue;
    if(points.slice(1).some((b,i)=>hitsBox(points[i],b,n)))
      report(`edge_node_intersection_${edge.id}_${n.id}`, 'Линия пересекает посторонний блок', 'Проложите линию вне габаритов блока.',n.id,edge.id);
  }
  const overlaps=(a:Point,b:Point,c:Point,d:Point)=>{
    const vertical=Math.abs(a.x-b.x)<eps && Math.abs(c.x-d.x)<eps && Math.abs(a.x-c.x)<eps;
    const horizontal=Math.abs(a.y-b.y)<eps && Math.abs(c.y-d.y)<eps && Math.abs(a.y-c.y)<eps;
    return vertical ? Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))>eps :
      horizontal && Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))>eps;
  };
  for(let i=0;i<rendered.length;i++)for(let j=i+1;j<rendered.length;j++) {
    const a=rendered[i],b=rendered[j];
    const shared=[a.edge.from,a.edge.to].filter(Boolean).filter(id=>id===b.edge.from || id===b.edge.to);
    // Explicit line attachments and shared connector buses represent intentional merges.
    if(a.edge.toEdge===b.edge.id || a.edge.fromEdge===b.edge.id || b.edge.toEdge===a.edge.id || b.edge.fromEdge===a.edge.id)continue;
    const intentional=(p:Point,q:Point,r:Point,t:Point)=>shared.some(id=>{
      const n=byId.get(id!);if(!n || !junction(n))return false;
      if (sharesCollector(a.edge,b.edge,nodes,edges)) {
        const rightmost = Math.max(...[a.edge.from,b.edge.from].map(id=>{const s=byId.get(id!);return s?s.cx+s.w/2:Infinity;}));
        if (p.x===q.x && r.x===t.x && Math.abs(p.x-r.x)<eps && p.x>rightmost) return true;
        if ([p,q,r,t].every(v=>Math.abs(v.y-(n.y+n.h/2))<eps)) return true;
      }
      const at=(v:Point)=>Math.abs(v.x-n.cx)<eps && Math.abs(v.y-(n.y+n.h/2))<eps;
      if(!(at(p)||at(q)) || !(at(r)||at(t)))return false;
      const vertical=Math.abs(p.x-q.x)<eps;
      const low=vertical?Math.max(Math.min(p.y,q.y),Math.min(r.y,t.y)):Math.max(Math.min(p.x,q.x),Math.min(r.x,t.x));
      const high=vertical?Math.min(Math.max(p.y,q.y),Math.max(r.y,t.y)):Math.min(Math.max(p.x,q.x),Math.max(r.x,t.x));
      return high-low<=TRACK_GAP+eps;
    });
    if(a.points.slice(1).some((p,k)=>b.points.slice(1).some((q,l)=>overlaps(a.points[k],p,b.points[l],q) && !intentional(a.points[k],p,b.points[l],q))))
      report(`edge_overlap_${a.edge.id}_${b.edge.id}`, 'Совпадающие участки независимых линий', 'Разведите участки по разным каналам либо обозначьте общий узел.',undefined,b.edge.id);
  }
}

export function applyGostAutoFix(
  issue: GostIssue,
  nodes: FlowNode[],
  edges: FlowEdge[],
  nextId: number
): { nodes: FlowNode[]; edges: FlowEdge[]; nextId: number } {
  let newNodes = nodes.map((n) => ({ ...n }));
  let newEdges = edges.map((e) => ({ ...e }));
  let idCounter = nextId;

  if (issue.fixType === 'add_decision_labels' && issue.nodeId) {
    const decNode = newNodes.find((n) => n.id === issue.nodeId);
    const isCaseNode = Boolean(decNode && /^(?:case\b|case\d|default\b)/i.test(decNode.text.trim()));
    const outs = newEdges.filter((e) => e.from === issue.nodeId && e.style !== 'dashed');
    if (outs.length >= 2) {
      if (isCaseNode) {
        outs.forEach((e) => {
          if (!e.rightLabel.trim() && !e.leftLabel.trim()) {
            e.rightLabel = e.fromPort === 'bottom' ? '0' : '1';
          }
        });
      } else {
        const usedYes = outs.some((e) => /да|yes|true|1/i.test(e.rightLabel || e.leftLabel));
        outs.forEach((e, idx) => {
          if (!e.rightLabel.trim() && !e.leftLabel.trim()) {
            e.rightLabel = idx === 0 && !usedYes ? '1' : '0';
          }
        });
      }
    }
  } else if (issue.fixType === 'fix_comment_dashed' && issue.edgeId) {
    newEdges = newEdges.map((e) => (e.id === issue.edgeId ? { ...e, style: 'dashed' } : e));
  } else if (issue.fixType === 'fill_empty_node_text' && issue.nodeId) {
    newNodes = newNodes.map((n) => {
      if (n.id !== issue.nodeId) return n;
      const defaultTxt =
        n.type === 'decision'
          ? 'if (x > 0)'
          : n.type === 'io'
          ? 'cin >> x;'
          : n.type === 'terminator'
          ? 'return 0;'
          : 'x = x + 1;';
      const sz = calcAutoSize(n.type, defaultTxt);
      return { ...n, text: defaultTxt, w: sz.w, h: sz.h };
    });
  } else if (issue.fixType === 'separate_overlapping_nodes' && issue.nodeId) {
    const target = newNodes.find((n) => n.id === issue.nodeId);
    if (target) {
      const shiftY = target.h + 36;
      newNodes.forEach((n) => {
        if (n.id === target.id || n.y > target.y) {
          n.y += shiftY;
        }
      });
    }
  } else if (issue.fixType === 'match_loop_bounds') {
    const loopStarts = newNodes.filter((n) => n.type === 'loop_start');
    const loopEnds = newNodes.filter((n) => n.type === 'loop_end');
    loopStarts.forEach((ls, idx) => {
      const le = loopEnds[idx];
      if (le) {
        const startName = ls.text.split('\n')[0]?.trim() || `Цикл ${idx + 1}`;
        le.text = startName;
      }
    });
  } else if (issue.fixType === 'add_start_terminator') {
    const topNode = [...newNodes]
      .filter((n) => n.type !== 'brace' && n.type !== 'comment')
      .sort((a, b) => a.y - b.y)[0];
    const cx = topNode ? topNode.cx : 360;
    const y = topNode ? topNode.y - 96 : 30;
    const sz = calcAutoSize('terminator', 'Начало');
    const startId = 'n' + idCounter++;
    newNodes.unshift({
      id: startId,
      type: 'terminator',
      text: 'Начало',
      cx,
      y,
      w: sz.w,
      h: sz.h,
    });
    if (topNode) {
      newEdges.push({
        id: 'e' + idCounter++,
        from: startId,
        fromEdge: null,
        to: topNode.id,
        toEdge: null,
        fromPort: 'bottom',
        toPort: 'top',
        leftLabel: '',
        rightLabel: '',
        style: 'ortho',
        bendOffset: 0,
      });
    }
  } else if (issue.fixType === 'add_end_terminator') {
    const botNode = [...newNodes]
      .filter((n) => n.type !== 'brace' && n.type !== 'comment')
      .sort((a, b) => b.y + b.h - (a.y + a.h))[0];
    const cx = botNode ? botNode.cx : 360;
    const y = botNode ? botNode.y + botNode.h + 44 : 300;
    const sz = calcAutoSize('terminator', 'return 0;');
    const endId = 'n' + idCounter++;
    newNodes.push({
      id: endId,
      type: 'terminator',
      text: 'return 0;',
      cx,
      y,
      w: sz.w,
      h: sz.h,
    });
    if (botNode) {
      newEdges.push({
        id: 'e' + idCounter++,
        from: botNode.id,
        fromEdge: null,
        to: endId,
        toEdge: null,
        fromPort: 'bottom',
        toPort: 'top',
        leftLabel: '',
        rightLabel: '',
        style: 'ortho',
        bendOffset: 0,
      });
    }
  } else if (issue.fixType === 'connect_dangling_to_end' && issue.nodeId) {
    const node = newNodes.find((n) => n.id === issue.nodeId);
    if (node) {
      const inEdges = newEdges.filter((e) => e.to === node.id && e.style !== 'dashed');
      const outEdges = newEdges.filter((e) => e.from === node.id && e.style !== 'dashed');
      if (inEdges.length === 0) {
        const prevCand = newNodes
          .filter((n) => n.id !== node.id && n.type !== 'brace' && n.type !== 'comment' && n.y < node.y)
          .sort((a, b) => Math.hypot(a.cx - node.cx, a.y - node.y) - Math.hypot(b.cx - node.cx, b.y - node.y))[0];
        if (prevCand) {
          newEdges.push({
            id: 'e' + idCounter++,
            from: prevCand.id,
            fromEdge: null,
            to: node.id,
            toEdge: null,
            fromPort: 'bottom',
            toPort: 'top',
            leftLabel: '',
            rightLabel: '',
            style: 'ortho',
            bendOffset: 0,
          });
        }
      } else if (outEdges.length === 0) {
        const nextCand = newNodes
          .filter((n) => n.id !== node.id && n.type !== 'brace' && n.type !== 'comment' && n.y > node.y)
          .sort((a, b) => Math.hypot(a.cx - node.cx, a.y - node.y) - Math.hypot(b.cx - node.cx, b.y - node.y))[0];
        if (nextCand) {
          newEdges.push({
            id: 'e' + idCounter++,
            from: node.id,
            fromEdge: null,
            to: nextCand.id,
            toEdge: null,
            fromPort: 'bottom',
            toPort: 'top',
            leftLabel: '',
            rightLabel: '',
            style: 'ortho',
            bendOffset: 0,
          });
        }
      }
    }
  }

  return { nodes: newNodes, edges: newEdges, nextId: idCounter };
}

