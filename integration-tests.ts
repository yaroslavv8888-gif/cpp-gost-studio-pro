import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFlowFromCpp, synthesizeCppFromGraph } from './src/engine/cppParserAndBuilder';
import { getEdgePoints, resetRoutingTracks } from './src/engine/orthoRouter';
import { validateGostFlowchart } from './src/engine/gostValidator';
import { LOOP_IF_CODE, TRIANGLE_IF_CODE, COMPLEX_CPP_CODE, SWITCH_CASE_CODE } from './src/types/flow';

const prefix = '#include <iostream>\nusing namespace std;\n';
const fixtures = [
  {name:'case_scope',code:'int main(){int x=1;switch(x){case 1:{int y=1;return y;}case 2:{int y=2;return y;}}return 0;}',inputs:['']},
  {name:'switch',code:SWITCH_CASE_CODE,inputs:['1','2','3','4','9']},
  {name:'triangle',code:TRIANGLE_IF_CODE,inputs:['3 3 3','3 3 4','3 4 5','1 1 4']},
  {name:'loop',code:LOOP_IF_CODE,inputs:['']},
  {name:'functions',code:COMPLEX_CPP_CODE,inputs:['1 3 2','1 -1 2','2 3 2','9 3 2']},
  {name:'fallthrough',code:prefix+'int main(){int a;cin>>a;int s=0;switch(a){case 1:s+=1;case 2:s+=2;break;default:s=8;}cout<<s;return 0;}',inputs:['1','2','3']},
  {name:'jumps',code:prefix+'int main(){int s=0;for(int i=0;i<6;i++){switch(i){case 1:continue;case 3:break;default:s+=i;}s+=10;}cout<<s;return 0;}',inputs:['']},
  {name:'early_return',code:prefix+'int pick(int a){if(a<0){return -1;}else if(a==0){return 7;}return a*2;}int main(){int a;cin>>a;cout<<pick(a);return 0;}',inputs:['-2','0','4']},
  {name:'postcondition',code:prefix+'int main(){int i=0;int s=0;do{i++;if(i==2){continue;}s+=i;if(i==4){break;}}while(i<8);cout<<s;return 0;}',inputs:['']},
  {name:'nested_switch',code:prefix+'int main(){int a;cin>>a;int s=0;switch(a){case 1:if(a>0){switch(a){case 1:s=3;break;default:s=4;}}break;default:s=9;}cout<<s;return 0;}',inputs:['1','4']},
];
const options = {exampleStyle:true,showKeywords:true,gostLoopBounds:false,groupStmts:true,gostNumbers:false,autoSyncCpp:true};
mkdirSync('.engine-checks',{recursive:true});
let executions=0;
for(const f of fixtures){
  const graph=buildFlowFromCpp(f.code,options);
  assert.ok(graph.nodes.length, f.name);
  for(const e of graph.edges){assert.ok(!e.from||graph.nodes.some(n=>n.id===e.from));assert.ok(!e.to||graph.nodes.some(n=>n.id===e.to));}
  resetRoutingTracks();
  for(const e of graph.edges){const pts=getEdgePoints(graph.nodes,graph.edges,e);assert.ok(pts?.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),f.name+': finite route');}
  const issues=validateGostFlowchart(graph.nodes,graph.edges);
  console.log(f.name, graph.nodes.length+' nodes',issues.length+' diagnostics');
  assert.equal(issues.length,0,f.name+': generated graph has diagnostics: '+issues.map(i=>i.id).join(', '));
  const rebuilt=synthesizeCppFromGraph(graph.nodes,graph.edges).code;
  const executables:string[]=[];
  for(const [version,code] of [['original',f.code],['rebuilt',rebuilt]]){
    const cpp=join('.engine-checks',f.name+'-'+version+'.cpp');
    const exe=join('.engine-checks',f.name+'-'+version+'.exe');
    writeFileSync(cpp,code);
    const compiled=spawnSync(process.env.CXX||'g++',[cpp,'-o',exe],{encoding:'utf8',timeout:30000});
    assert.equal(compiled.status,0,f.name+' '+version+': '+compiled.stderr);
    executables.push(exe);
  }
  for(const input of f.inputs){
    const results=executables.map(exe=>spawnSync(exe,[],{input,encoding:'utf8',timeout:5000}));
    assert.equal(results[1].error,undefined,f.name+': runtime error');
    assert.equal(results[1].status,results[0].status,f.name+': exit');
    assert.equal(results[1].stdout,results[0].stdout,f.name+': output for '+input);
    executions++;
  }
}
console.log('Compiled C++ round-trip: '+fixtures.length+' fixtures, '+executions+' input scenarios passed.');
