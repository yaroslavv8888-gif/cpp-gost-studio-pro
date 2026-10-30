import assert from 'node:assert/strict';
import { computeOrthogonalPoints, getEdgePoints, getPortCoords, resetRoutingTracks, getBranchLabelPosition } from './src/engine/orthoRouter';
import type { FlowNode, FlowEdge } from './src/types/flow';
import { LOOP_IF_CODE, TRIANGLE_IF_CODE, COMPLEX_CPP_CODE, SWITCH_CASE_CODE } from './src/types/flow';
import { buildFlowFromCpp } from './src/engine/cppParserAndBuilder';

const node = (id: string, cx: number, y: number): FlowNode => ({ id, cx, y, w: 80, h: 40, text: id, type: 'process' });
const edge = (id: string, from: string, to: string, style: FlowEdge['style'] = 'ortho'): FlowEdge => ({ id, from, to, fromEdge: null, toEdge: null, fromPort: 'bottom', toPort: 'top', style, bendOffset: 0, leftLabel: '', rightLabel: '' });
function hits(points: {x:number;y:number}[], n: FlowNode) {
  return points.slice(1).some((b, i) => {
    const a = points[i];
    return a.x === b.x ? a.x > n.cx-n.w/2 && a.x < n.cx+n.w/2 && Math.max(a.y,b.y)>n.y && Math.min(a.y,b.y)<n.y+n.h
      : a.y > n.y && a.y < n.y+n.h && Math.max(a.x,b.x)>n.cx-n.w/2 && Math.min(a.x,b.x)<n.cx+n.w/2;
  });
}
const nodes = [node('a', 200, 0), node('obstacle', 200, 100), node('b', 200, 220)];
const e = edge('ab','a','b');
const routed = getEdgePoints(nodes,[e],e)!;
assert.equal(hits(routed,nodes[1]),false,'a straight automatic edge must detour around the middle block');
assert.deepEqual(routed[0], getPortCoords(nodes[0],'bottom'));
assert.deepEqual(routed.at(-1), getPortCoords(nodes[2],'top'));
assert.ok(routed.every((p,i)=>!i || p.x===routed[i-1].x || p.y===routed[i-1].y),'detour stays orthogonal');

const loopNodes = [node('top1',300,0),node('top2',300,100),node('bottom1',300,400),node('bottom2',300,500)];
const loops = [edge('outer','bottom2','top1','loop_left'),edge('inner','bottom1','top2','loop_left')];
loops.forEach(l=>l.toPort='left');
resetRoutingTracks();
const paths = loops.map(l=>getEdgePoints(loopNodes,loops,l)!);
const vertical = paths.map(p=>p.slice(1).map((b,i)=>[p[i],b]).filter(([a,b])=>a.x===b.x && Math.abs(a.y-b.y)>100));
assert.ok(Math.abs(vertical[0][0][0].x-vertical[1][0][0].x)>=22,'nested return channels are separated by 22px');
assert.deepEqual(getEdgePoints(loopNodes,loops,loops[1]),paths[1],'repeat routing is stable');
resetRoutingTracks();
assert.deepEqual(getEdgePoints(loopNodes,loops,loops[1]),paths[1],'request order does not change channel assignment');

const explicit = computeOrthogonalPoints([], {x:0,y:0},'bottom',{x:100,y:100},'top','ortho',0,null,null,'manual',0,[{x:0,y:30},{x:100,y:30}]);
assert.deepEqual(explicit,[{x:0,y:0},{x:0,y:30},{x:100,y:30},{x:100,y:100}],'valid user waypoints stay fixed');
const diamond = {...node('d',100,100),type:'decision' as const,w:160,h:80};
const labelPoint = getBranchLabelPosition([{x:180,y:140},{x:300,y:140},{x:300,y:300}],'Нет',diamond);
assert.ok(labelPoint.x<280,'branch label stays near the exit, before the first bend');
assert.ok(labelPoint.x-20>=180 || labelPoint.y+10<=100 || labelPoint.y-10>=180,'branch label clears the diamond bounds');
assert.ok(Math.abs(labelPoint.y-140)>=18,'branch label clears its horizontal flowline');

const horizontalNodes = [node('ha',0,0),node('hb',600,200),node('hc',200,0),node('hd',400,200)];
const horizontalEdges=[edge('h1','ha','hb'),edge('h2','hc','hd')];
const horizontalPaths=horizontalEdges.map(e=>getEdgePoints(horizontalNodes,horizontalEdges,e)!);
const horizontalY=horizontalPaths.map(p=>p.slice(1).map((b,i)=>[p[i],b]).filter(([a,b])=>a.y===b.y && Math.abs(a.x-b.x)>=100)[0][0].y);
assert.ok(Math.abs(horizontalY[0]-horizontalY[1])>=22,'overlapping horizontal channels are separated by 22px');

const options={exampleStyle:true,showKeywords:true,gostLoopBounds:false,groupStmts:true,gostNumbers:false,autoSyncCpp:true};
for(const [name,code] of Object.entries({loop:LOOP_IF_CODE,triangle:TRIANGLE_IF_CODE,complex:COMPLEX_CPP_CODE,switch:SWITCH_CASE_CODE,
  nested:'int main(){for(int i=0;i<3;i++){while(x){if(x){x--;}else{x++;}}}return 0;}',
  post:'int main(){do{x++;if(x){continue;}}while(x<5);return 0;}',
  returns:'int f(int x){if(x<0){return 1;}if(x>0){return 2;}return 3;}'})) {
  const graph=buildFlowFromCpp(code,options);
  resetRoutingTracks();
  const start=performance.now();
  for(const e of graph.edges) {
    const p=getEdgePoints(graph.nodes,graph.edges,e)!;
    assert.ok(p?.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y)),name+': finite points');
    for(const n of graph.nodes) {
      if(n.id===e.from||n.id===e.to||n.type==='connector'||n.type==='comment'||n.type==='brace') continue;
      assert.equal(hits(p,n),false,`${name}: ${e.id} crosses ${n.id}`);
    }
  }
  console.log(`${name}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${Math.round(performance.now()-start)}ms`);
}
console.log('router tests passed');
