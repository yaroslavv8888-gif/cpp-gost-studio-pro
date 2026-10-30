import assert from 'node:assert/strict';
import { buildFlowFromCpp, synthesizeCppFromGraph } from './src/engine/cppParserAndBuilder';
import { LOOP_IF_CODE, TRIANGLE_IF_CODE, COMPLEX_CPP_CODE, SWITCH_CASE_CODE, type CodeGenOptions } from './src/types/flow';
const base: CodeGenOptions = { exampleStyle: false, showKeywords: true, gostLoopBounds: false, groupStmts: false, gostNumbers: false, autoSyncCpp: true };
const fixtures = [LOOP_IF_CODE, TRIANGLE_IF_CODE, COMPLEX_CPP_CODE, SWITCH_CASE_CODE,
  'int main(){int x=0;switch(x){case 0:if(x){foo();}else{while(x){x--;}}case 1:for(int i=0;i<3;i++){bar(i);}break;default:do{x++;}while(x<5);}return 0;}',
  'int f(int a){if(a){return 1;}else{return 2;}}int main(){return f(2);}',
  'int main(){int x=0;while(x<4){switch(x){case 0:x++;continue;case 1:if(x){break;}x++;break;default:break;}x++;}return 0;}',
  'int main(){int x=0;do{if(x){continue;}if(x>4){break;}x++;}while(x<8);return 0;}',
  'int main(){int a,b;std::cin >> a >> b;std::cout << "http://host/* literal */" << a << "\\n" << std::endl;return 0;}',
  "int main(){char x=':';switch(x){default:x='b';case ':':x='a';break;}return 0;}",
  'int main(){if(a){if(b){long_call();}else{if(c){other_call();}}}else{if(d){f();}else{g();}}return 0;}',
  'int main(){for(;;){}while(x){}do{}while(x);if(x){}else{}switch(x){}return 0;}'
];
let runs=0;
for (let flags=0; flags<16; flags++) for (const code of fixtures) {
  const options={...base,exampleStyle:!!(flags&1),showKeywords:!!(flags&2),gostLoopBounds:!!(flags&4),groupStmts:!!(flags&8)};
  const g=buildFlowFromCpp(code,options);
  const ids=new Set(g.nodes.map(n=>n.id));
  for(const e of g.edges){assert.ok(!e.from||ids.has(e.from));assert.ok(!e.to||ids.has(e.to));}
  for(const fn of new Set(g.nodes.map(n=>n.fnId))) {
    const endpoints=g.nodes.filter(n=>n.fnId===fn&&n.type==='terminator'&&/^(?:Конец|return\b)/.test(n.text));
    assert.equal(endpoints.length,1);
    assert.equal(g.edges.filter(e=>e.from===endpoints[0].id&&e.style!=='dashed').length,0);
  }
  for(const n of g.nodes){
    assert.ok(Number.isFinite(n.cx)&&Number.isFinite(n.y));
    if(n.type==='decision') assert.ok(g.edges.filter(e=>e.from===n.id&&e.style!=='dashed').length<=3);
    if(n.type==='io') assert.match(n.text, /(?:cin|cout|cerr|scanf|printf|getline)\b/);
    if(n.type!=='connector'&&n.type!=='comment'&&n.type!=='brace') assert.ok(g.edges.filter(e=>e.to===n.id&&e.toPort==='top'&&e.style!=='dashed').length<=1, n.text+' top inputs');
    if(n.control) for(const id of [n.control.joinId,n.control.bodyId,n.control.conditionId,n.control.yesId,n.control.noId,...(n.control.cases||[]).flatMap(c=>[c.entryId,c.stopId])].filter(Boolean)) assert.ok(ids.has(id!));
  }
  const functional=g.nodes.filter(n=>!['brace','comment','connector'].includes(n.type));
  for(let i=0;i<functional.length;i++) for(let j=i+1;j<functional.length;j++){
    const a=functional[i],b=functional[j];
    assert.ok(!(Math.abs(a.cx-b.cx)<(a.w+b.w)/2&&a.y<b.y+b.h&&b.y<a.y+a.h), 'overlap '+a.text+' / '+b.text);
  }
  if(options.gostLoopBounds&&g.nodes.some(n=>n.control?.kind==='loop'||n.control?.kind==='dowhile')) assert.ok(g.nodes.some(n=>n.type==='loop_start')&&g.nodes.some(n=>n.type==='loop_end'));
  if(options.exampleStyle) assert.ok(g.nodes.some(n=>n.type==='brace'));
  const rebuilt=synthesizeCppFromGraph(g.nodes,g.edges).code;
  assert.doesNotMatch(rebuilt,/Ввод:|Вывод:/);
  assert.equal((rebuilt.match(/\breturn\b/g)||[]).length,(code.match(/\breturn\b/g)||[]).length);
  runs++;
}
const jumps=buildFlowFromCpp(fixtures[6],base);
const sw=jumps.nodes.find(n=>n.control?.kind==='switch')!;
for(const b of jumps.nodes.filter(n=>/^break/.test(n.text))) assert.equal(jumps.edges.find(e=>e.from===b.id)?.to,sw.control!.joinId);
const cont=jumps.nodes.find(n=>/^continue/.test(n.text))!;
const continueJoin=jumps.edges.find(e=>e.from===cont.id)?.to;
assert.equal(jumps.nodes.find(n=>n.id===continueJoin)?.type,'connector');
assert.equal(jumps.edges.find(e=>e.from===continueJoin)?.to,jumps.nodes.find(n=>n.control?.kind==='loop')!.id);
const fall=buildFlowFromCpp('int main(){switch(x){case 1:x++;case 2:x+=2;break;default:x=0;}return 0;}',base);
const meta=fall.nodes.find(n=>n.control?.kind==='switch')!.control!;
const firstTail=fall.nodes.find(n=>n.text==='x++;')!;
assert.equal(fall.edges.find(e=>e.from===firstTail.id)?.to,meta.cases![1].entryId);
for(const n of fall.nodes.filter(n=>n.type==='process'&&n.text.startsWith('x'))) assert.ok(fall.edges.filter(e=>e.to===n.id).every(e=>e.toPort==='top'||e.toPort==='left'));
const calls=buildFlowFromCpp('int main(){x=external(2);std::sort(a,b);s="literal(";return 0;}',base);
assert.equal(calls.nodes.find(n=>n.text==='x=external(2);')?.type,'predefined');
assert.equal(calls.nodes.find(n=>n.text==='std::sort(a,b);')?.type,'predefined');
assert.equal(calls.nodes.find(n=>n.text==='s="literal(";')?.type,'process');
const io=buildFlowFromCpp(fixtures[8],base);
assert.ok(synthesizeCppFromGraph(io.nodes,io.edges).code.includes('"http://host/* literal */"'));
const stripped=JSON.parse(JSON.stringify(io));
for(const n of stripped.nodes) delete n.control;
assert.ok(synthesizeCppFromGraph(stripped.nodes,stripped.edges).code.includes('"http://host/* literal */"'));
console.log(`Parser topology, layout and synthesis: ${runs} option/fixture combinations passed.`);
// Current edges override generated branch references after user edits.
const edited=buildFlowFromCpp('int main(){int x=0;if(x){x=1;}else{x=2;}return 0;}',base);
const decision=edited.nodes.find(n=>n.control?.kind==='if')!;
const yes=edited.edges.find(e=>e.from===decision.id&&e.rightLabel==='1')!;
const no=edited.edges.find(e=>e.from===decision.id&&e.rightLabel==='0')!;
const removed=synthesizeCppFromGraph(edited.nodes,edited.edges.filter(e=>e.id!==yes.id)).code;
assert.ok(!removed.includes('x=1;'));
[yes.to,no.to]=[no.to,yes.to];
const swapped=synthesizeCppFromGraph(edited.nodes,edited.edges).code;
assert.ok(swapped.indexOf('x=2;')<swapped.indexOf('x=1;'));
const changedIO=buildFlowFromCpp('int main(){cout<<a;return 0;}',base);
const data=changedIO.nodes.find(n=>n.type==='io')!;delete data.sourceText;data.text='Вывод: "a,b", f(1,2), x';
assert.ok(synthesizeCppFromGraph(changedIO.nodes,changedIO.edges).code.includes('cout << "a,b" << f(1,2) << x << endl;'));
const scoped=buildFlowFromCpp('int main(){int x=1;switch(x){case 1:{int y=1;return y;}case 2:{int y=2;return y;}}return 0;}',base);
assert.equal(scoped.nodes.find(n=>n.control?.kind==='switch')!.control!.cases!.filter(c=>c.hasBraces).length,2);
const emptyIf=buildFlowFromCpp('int main(){if(x);x++;return 0;}',base);
assert.equal(emptyIf.nodes.find(n=>n.control?.kind==='if')!.control!.yesId,undefined);
console.log('Parser edit and scope regressions passed.');
const scopedBreak=buildFlowFromCpp('int main(){int x=1;switch(x){case 1:{int y=1;x=y;}break;case 2:{int y=2;x=y;}break;}return 0;}',base);
assert.equal(scopedBreak.nodes.find(n=>n.control?.kind==='switch')!.control!.cases!.filter(c=>c.hasBraces).length,2);
const editedCase=buildFlowFromCpp('int main(){switch(x){case 1:break;}return 0;}',base);
editedCase.nodes.find(n=>n.text==='case 1:')!.text='case 7:';
assert.ok(synthesizeCppFromGraph(editedCase.nodes,editedCase.edges).code.includes('case 7:'));
for(const [code,kind] of [
  ['int main(){int x=0;do{x++;}while(x<2);return x;}','dowhile'],
  ['int main(){int x=0;while(x<2){x++;}return x;}','loop'],
  ['int main(){int x=0;switch(x){case 0:x++;break;default:x+=2;}return x;}','switch']
] as const){
  const g=buildFlowFromCpp(code,base);const control=g.nodes.find(n=>n.control?.kind===kind)!;
  const outgoing=g.edges.filter(e=>e.from===control.id);const bodyEdge=outgoing.find(e=>e.rightLabel==='1')||outgoing[0];
  const rebuilt=synthesizeCppFromGraph(g.nodes,g.edges.filter(e=>e.id!==bodyEdge.id)).code;
  assert.ok(!rebuilt.includes('x++;'),kind+' detached body must not synthesize');
}
const disconnectedCase=buildFlowFromCpp('int main(){int x=0;switch(x){case 0:x++;break;default:x+=2;}return x;}',base);
const caseDecision=disconnectedCase.nodes.find(n=>n.text==='case 0:')!;
const caseBodyEdge=disconnectedCase.edges.find(e=>e.from===caseDecision.id&&e.rightLabel==='1')!;
assert.ok(!synthesizeCppFromGraph(disconnectedCase.nodes,disconnectedCase.edges.filter(e=>e.id!==caseBodyEdge.id)).code.includes('x++;'));
const caseEntry=disconnectedCase.nodes.find(n=>n.control?.kind==='switch')!.control!.cases![0].entryId;
const bodyEntryEdge=disconnectedCase.edges.find(e=>e.to===caseEntry)!;
assert.ok(!synthesizeCppFromGraph(disconnectedCase.nodes,disconnectedCase.edges.filter(e=>e.id!==bodyEntryEdge.id)).code.includes('x++;'));
console.log('All structured control detach regressions passed.');

// Keep complete initializer/header delimiters and raw stream syntax, including
// shift operators inside indexes and quoted text that resembles stream syntax.
const lexicalCode='int main(){constexpr int a[2][2]{{1,2},{3,4}};std::array<int,2> b{1,2};int i=2;cin >> a[i >> 1][0];cout << "<< >>" << a[0][1] << endl;for(auto x : std::array<int,2>{1,2}){b.push_back(x);}return 0;}';
const lexical=buildFlowFromCpp(lexicalCode,base);
for(const text of ['constexpr int a[2][2]{{1,2},{3,4}};','std::array<int,2> b{1,2};','cin >> a[i >> 1][0];','cout << "<< >>" << a[0][1] << endl;']) assert.ok(lexical.nodes.some(n=>n.text===text),'intact '+text);
const range=lexical.nodes.find(n=>n.control?.kind==='loop')!;
assert.equal(range.type,'prep');assert.equal(range.control!.expression,'auto x : std::array<int,2>{1,2}');
assert.equal(lexical.nodes.find(n=>n.text==='b.push_back(x);')!.type,'predefined');
const lexicalRebuilt=synthesizeCppFromGraph(lexical.nodes,lexical.edges).code;
assert.ok(lexicalRebuilt.includes('cin >> a[i >> 1][0];'));
assert.ok(lexicalRebuilt.includes('cout << "<< >>" << a[0][1] << endl;'));
const initializedCalls=buildFlowFromCpp('int main(){int a[2]={abs(-1),abs(-2)};std::vector<int> v{abs(-3),abs(-4)};int scalar=abs(-5);return 0;}',base);
for(const text of ['int a[2]={abs(-1),abs(-2)};','std::vector<int> v{abs(-3),abs(-4)};']) assert.equal(initializedCalls.nodes.find(n=>n.text===text)!.type,'process');
assert.equal(initializedCalls.nodes.find(n=>n.text==='int scalar=abs(-5);')!.type,'predefined');
