import {hasFlowArrow} from './src/engine/graphEditing';
import assert from 'node:assert/strict';
import { buildFlowFromCpp, synthesizeCppFromGraph } from './src/engine/cppParserAndBuilder';
import { getEdgePoints } from './src/engine/orthoRouter';
import { validateGostFlowchart } from './src/engine/gostValidator';
const options={exampleStyle:true,showKeywords:true,gostLoopBounds:false,groupStmts:false,gostNumbers:false,autoSyncCpp:true};
const code=`int main() {
int A[3] = {3,2,1};
for(int i=0;i<2;i++) {
for(int j=0;j<2-i;j++) {
if(A[j]>A[j+1]) {
int t=A[j];A[j]=A[j+1];A[j+1]=t;
}
}
}
for(int k=0;k<3;k++) {
cout << A[k] << " ";
}
cout << endl;
return 0;
}`;
const graph=buildFlowFromCpp(code,options);
const braces=graph.nodes.filter(n=>n.type==='brace');
assert.equal(braces.length,10,'only the five actual statement scopes produce braces');
for(const brace of braces) assert(/^[{}]$/.test(code.split('\n')[brace.sourceLines![0]-1].trim().slice(-1)),'brace links to its own source line');
const loops=graph.nodes.filter(n=>n.control?.kind==='loop');
for(const head of loops){
 const exit=graph.nodes.find(n=>n.id===head.control!.joinId)!;
 assert(exit.cx>head.cx+head.w/2,'loop exit continues along the right-side channel');
 const route=getEdgePoints(graph.nodes,graph.edges,graph.edges.find(e=>e.from===head.id&&e.to===exit.id)!)!;
 assert.equal(route.at(-1)!.x,Math.max(...route.map(p=>p.x)),'exit must not bend back toward the previous axis');
}
const following=graph.nodes.find(n=>n.text.includes('for (int k'))!;
assert(following.cx>loops[0].cx+loops[0].w/2,'next group is shifted to the exit column');
const conditional=graph.nodes.find(n=>n.control?.kind==='if')!;
const join=graph.nodes.find(n=>n.id===conditional.control!.joinId)!;
const incoming=graph.edges.filter(e=>e.to===join.id);
const levels=incoming.filter(e=>e.from===conditional.id||graph.nodes.find(n=>n.id===e.from)?.type!=='connector').map(e=>getEdgePoints(graph.nodes,graph.edges,e)!.at(-1)!.y);
assert.equal(new Set(levels).size,1,'branches meet at one common junction');
const paths=graph.edges.map(e=>getEdgePoints(graph.nodes,graph.edges,e)!).filter(Boolean);
const intersects=(a:{x:number;y:number},b:{x:number;y:number},n:typeof braces[number])=>{
 const l=n.cx-n.w/2-4,r=n.cx+n.w/2+4,t=n.y-4,d=n.y+n.h+4;
 return a.x===b.x?a.x>=l&&a.x<=r&&Math.max(a.y,b.y)>=t&&Math.min(a.y,b.y)<=d:a.y>=t&&a.y<=d&&Math.max(a.x,b.x)>=l&&Math.min(a.x,b.x)<=r;
};
for(const brace of braces) assert(!paths.some(p=>p.slice(1).some((b,i)=>intersects(p[i],b,brace))),'brace must not touch a flowline: '+brace.sourceLines);
for(const text of ['int main(){int a[2]={1,2};for(int i=0;i<2;i++) if(a[i]) a[i]++;return 0;}','int main(){if(1){}else{}while(0){}return 0;}']){
 const g=buildFlowFromCpp(text,options);
 const expected=text.includes('else')?8:2;
 assert.equal(g.nodes.filter(n=>n.type==='brace').length,expected,'unbraced bodies have no invented braces; empty blocks retain theirs');
}
assert(synthesizeCppFromGraph(graph.nodes,graph.edges).code.includes('A[j+1]=t;'));
assert(!validateGostFlowchart(graph.nodes,graph.edges).some(i=>/^edge_(overlap|node_intersection)_/.test(i.id)),'no geometry diagnostics');
console.log('Real scope braces, common merges, stepped loop exits and unobstructed decorations passed.');

for(const edge of graph.edges.filter(e=>e.style==='loop_left')) assert(hasFlowArrow(edge,graph.nodes),'return arrows retained');
