import assert from 'node:assert/strict';
import {buildFlowFromCpp,synthesizeCppFromGraph} from './src/engine/cppParserAndBuilder';
import {getEdgePoints,getLoopRoutingScopes} from './src/engine/orthoRouter';
import {validateGostFlowchart} from './src/engine/gostValidator';
import {LOOP_IF_CODE,TRIANGLE_IF_CODE,COMPLEX_CPP_CODE,SWITCH_CASE_CODE,EXAMPLE_CODE} from './src/types/flow';
const options={exampleStyle:true,showKeywords:true,gostLoopBounds:false,groupStmts:false,gostNumbers:false,autoSyncCpp:true};
const mixed=buildFlowFromCpp('int main(){for(int i=0;i<3;i++){if(i==1){continue;}x++;}while(x>0){if(x==2){x--;continue;}x--;}return 0;}',options);
for(const head of mixed.nodes.filter(n=>n.control?.kind==='loop')){
 const scope=getLoopRoutingScopes(mixed.nodes,mixed.edges).find(s=>s.headId===head.id)!;
 const ret=mixed.edges.find(e=>e.to===scope.entryId&&e.style==='loop_left')!;
 assert(ret,'return channel exists');
 const target=mixed.nodes.find(n=>n.id===ret.to)!;
 if(head.control!.keyword==='for'){
  assert.equal(target.id,head.id,'for returns to its hexagon');
  assert.equal(ret.toPort,'left');
  assert.deepEqual(getEdgePoints(mixed.nodes,mixed.edges,ret)!.at(-1),{x:head.cx-head.w/2,y:head.y+head.h/2});
  assert.equal(mixed.edges.filter(e=>e.to===head.id&&e.style==='loop_left').length,1,'continue and normal completion share the side inlet');
 }else{assert.equal(target.type,'connector');assert(target.y<head.y,'while returns above diamond');}
}
const nested='int main(){int a[3][3]={{1,2,3},{3,2,1},{1,1,1}};for(int i=0;i<3;i++){for(int j=0;j<3;j++){if(a[i][j]>1){a[i][j]--;}else{a[i][j]++;}}}for(int k=0;k<3;k++){cout<<a[k][0];}return 0;}';
const samples=[EXAMPLE_CODE,LOOP_IF_CODE,TRIANGLE_IF_CODE,COMPLEX_CPP_CODE,SWITCH_CASE_CODE,nested,'int main(){for(;;){}while(x){}return 0;}'];
const coords=new Set<string>();
for(const code of samples){
 const base=buildFlowFromCpp(code,options),cpp=synthesizeCppFromGraph(base.nodes,base.edges).code;
 for(let seed=1;seed<=24;seed++){
  const opts={...options,layoutSeed:seed};
  const g=buildFlowFromCpp(code,opts);
  assert.deepEqual(buildFlowFromCpp(code,opts),g,'fixed seed reproduces layout');
  assert.equal(synthesizeCppFromGraph(g.nodes,g.edges).code,cpp,'variation preserves C++');
  const geometry=validateGostFlowchart(g.nodes,g.edges).filter(i=>/^edge_(overlap|node_intersection)_/.test(i.id));
  assert.deepEqual(geometry,[],`seed ${seed}: no line collisions`);
  const before=JSON.stringify(g.nodes.map(n=>[n.cx,n.y]));
  for(const e of g.edges)getEdgePoints(g.nodes,g.edges,e);
  assert.equal(JSON.stringify(g.nodes.map(n=>[n.cx,n.y])),before,'rendering never randomizes saved coordinates');
  for(const d of g.nodes.filter(n=>n.control?.kind==='if')){
   const join=g.nodes.find(n=>n.id===d.control!.joinId)!;
   if(join.type==='connector'){
    const incoming=g.edges.filter(e=>e.to===join.id && e.style!=='dashed');
    const ends=incoming.map(e=>getEdgePoints(g.nodes,g.edges,e)!.at(-1));
    assert(ends.every(p=>p!.x===join.cx&&p!.y===join.y+join.h/2),'if branches share one exact junction');
   }
  }
  if(code===nested)coords.add(before);
 }
}
assert(coords.size>10,'different seeds produce different layouts');
console.log('While/for return ports, common joins and 168 seeded layout variants passed.');
