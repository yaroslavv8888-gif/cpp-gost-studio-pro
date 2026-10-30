import assert from 'node:assert/strict';
import {buildFlowFromCpp} from './src/engine/cppParserAndBuilder';
import {getEdgePoints} from './src/engine/orthoRouter';
import {validateGostFlowchart} from './src/engine/gostValidator';
import * as examples from './src/types/flow';
const options={exampleStyle:true,showKeywords:true,gostLoopBounds:false,groupStmts:true,gostNumbers:false,autoSyncCpp:true};
for(const code of [examples.SWITCH_CASE_CODE,examples.COMPLEX_CPP_CODE]){
  const g=buildFlowFromCpp(code,options);
  for(const n of g.nodes.filter(n=>/^setlocale/.test(n.text)))assert.equal(n.type,'process');
  const breaks=g.nodes.filter(n=>n.text==='break;');
  const tracks=breaks.map(n=>{
    const e=g.edges.find(e=>e.from===n.id)!;
    assert.equal(e.toPort,'right');
    const pts=getEdgePoints(g.nodes,g.edges,e)!;
    assert.equal(pts.at(-1)!.y,pts.at(-2)!.y,'collector enters junction horizontally');
    return Math.max(...pts.map(p=>p.x));
  });
  assert.equal(new Set(tracks).size,1,'switch breaks share a single trunk');
  assert.equal(validateGostFlowchart(g.nodes,g.edges).filter(i=>/^edge_overlap_|^edge_node_intersection_/.test(i.id)).length,0);
  for(const h of g.nodes.filter(n=>n.control?.kind==='switch'))for(const c of h.control!.cases||[]){
    if(c.labels.length===1){const n=g.nodes.find(n=>n.id===c.entryId)!;const incoming=g.edges.filter(e=>e.to===n.id);if(incoming.length===1){assert.notEqual(n.type,'connector');assert.ok(['top','left'].includes(incoming[0].toPort));}}
  }
}
console.log('Shared collector, top case entries, setlocale shape and geometry regressions passed.');
const horizontal=buildFlowFromCpp(examples.SWITCH_CASE_CODE,options);
const multiply=horizontal.nodes.find(n=>n.text==='sum = sum * 2;')!;
const output=horizontal.nodes.find(n=>n.text==='cout << sum << endl;'&&n.cx>multiply.cx&&Math.abs(n.y+n.h/2-multiply.y-multiply.h/2)<1)!;
assert.equal(multiply.y+multiply.h/2,output.y+output.h/2,'simple case actions share one row');
assert.ok(output.cx>multiply.cx,'actions advance to the right');
assert.equal(horizontal.nodes.filter(n=>n.type==='brace').length,4,'only function and switch braces for unbraced cases');
