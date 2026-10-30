import assert from 'node:assert/strict';
import { validateGostFlowchart, applyGostAutoFix } from './src/engine/gostValidator';
import { buildFlowFromCpp } from './src/engine/cppParserAndBuilder';
import { EXAMPLE_CODE, COMPLEX_CPP_CODE, SWITCH_CASE_CODE, LOOP_IF_CODE, TRIANGLE_IF_CODE, type FlowNode, type FlowEdge } from './src/types/flow';
const n=(id:string,type:FlowNode['type']='process',text='x = 1',cx=0,y=0):FlowNode=>({id,type,text,cx,y,w:60,h:30});
const e=(id:string,from:string,to:string,extra:Partial<FlowEdge>={}):FlowEdge=>({id,from,to,fromEdge:null,toEdge:null,fromPort:'bottom',toPort:'top',leftLabel:'',rightLabel:'',style:'ortho',bendOffset:0,...extra});
const ids=(ns:FlowNode[],es:FlowEdge[])=>validateGostFlowchart(ns,es).map(i=>i.id);
const has=(ns:FlowNode[],es:FlowEdge[],prefix:string)=>assert(ids(ns,es).some(id=>id.startsWith(prefix)),prefix);
const lacks=(ns:FlowNode[],es:FlowEdge[],prefix:string)=>assert(!ids(ns,es).some(id=>id.startsWith(prefix)),prefix);
const a=n('a','process','x=1',-100,0),b=n('b','process','x=2',100,0),target=n('t','process','x=3',0,150);
has([a,b,target],[e('a','a','t'),e('b','b','t')],'multiple_inputs_');
const j=n('j','connector','',0,100); j.w=2;j.h=2;
lacks([a,b,j,target],[e('a','a','j'),e('b','b','j'),e('c','j','t')],'multiple_inputs_');
has([a,b,target],[e('a','a','t'),e('b','b','t',{toPort:'left'})],'multiple_inputs_');
const prep=n('prep','prep','i=0; i<n; i++',0,150);
lacks([a,b,prep],[e('initial','a','prep'),e('loop','b','prep',{toPort:'left',style:'loop_left'})],'multiple_inputs_');
has([a,b,prep],[e('initial','a','prep'),e('loop','b','prep',{toPort:'left',style:'loop_left'}),e('extra','a','prep',{toPort:'left',style:'loop_left'})],'multiple_inputs_');
lacks([a,b,{...prep,control:{kind:'loop',joinId:'j'}}],[e('initial','a','prep'),e('mergedReturn','b','prep',{toPort:'left'})],'multiple_inputs_');
const decision=n('d','decision','x>0');
has([decision,...[0,1,2,3].map(i=>n('o'+i,'process','x=1',i*150,200))],[0,1,2,3].map(i=>e('o'+i,'d','o'+i)),'decision_outputs_');
has([a,target],[e('return','t','a',{style:'loop_left',toPort:'left'})],'invalid_process_port_');
lacks([a,b],[e('seq','a','b',{fromPort:'right',toPort:'left'})],'invalid_process_port_');
has([n('call','process','result = ns::calculate(x);')],[],'missing_predefined_');
lacks([n('call','process','x = sizeof(int);')],[],'missing_predefined_');
for (const text of [
 'std::vector<std::vector<int>> m(2, std::vector<int>(3, 1));',
 'std::vector<int> values{3, 1, 2};',
 'int a[2] = {abs(-1), abs(-2)};',
 'int matrix[2][2] = {{abs(-1), abs(-2)}, {abs(-3), abs(-4)}};',
 'Widget objects[2] = {makeWidget(), makeWidget()};',
 'Widget object(2);',
 'int* p = new int[n];',
 'Widget* p = new Widget(2);',
 'delete[] p;',
 'new Widget(2);',
]) lacks([n('declaration','process',text)],[],'missing_predefined_');
for (const text of [
 'int result = calculate(x);',
 'int a = compute();',
 'a[0] = compute();',
 'int a[2] = {abs(-1), abs(-2)}; result = compute();',
 'Widget result = ns::calculate(x);',
 'std::vector<int> values = makeValues();',
 'std::vector<int> values(3); result = calculate(x);',
 'ns::transform<int>(x);',
 'return calculate(x);',
]) has([n('call','process',text)],[],'missing_predefined_');
lacks([n('call','process','text = "call(x)";')],[],'missing_predefined_');
for (const text of ['cin >> arr[i][j];', 'std::cout << arr[i][j][k] << std::endl;', 'cout << "line\\n";']) {
 const io=n('raw','io',text);
 assert(!validateGostFlowchart([io],[]).some(issue=>issue.nodeId===io.id && /синтаксис|подпис|данных/i.test(issue.title)), 'raw I/O is supported');
 assert.equal(io.text,text,'validation preserves raw C++ syntax');
}
lacks([{...n('io','io','Вывод: x'),sourceText:'cout << x;'}],[],'unsanitized_io_');
const end1={...n('end1','terminator','Конец'),fnId:'f'},end2={...n('end2','terminator','Конец',200),fnId:'f'};
has([end1,end2],[],'multiple_ends_');
lacks([end1,{...end2,fnId:'g'}],[],'multiple_ends_');
const obstacle=n('block','process','x=1',0,100), src=n('src','terminator','Начало',0,0), dst=n('dst','terminator','Конец',0,200);
has([src,obstacle,dst],[e('cross','src','dst',{style:'straight'})],'edge_node_intersection_');
lacks([src,dst],[e('ok','src','dst')],'edge_node_intersection_');
const ns=[n('s1','process','x=1',0,0),n('t1','process','x=2',0,300),n('s2','process','x=3',0,70),n('t2','process','x=4',0,220)];
has(ns,[e('e1','s1','t1',{style:'straight'}),e('e2','s2','t2',{style:'straight'})],'edge_overlap_');
lacks([a,b,j,target],[e('a','a','j'),e('b','b','j'),e('c','j','t')],'edge_overlap_');
// Sharing a junction does not excuse a long accidental common track.
const farJoin={...n('farJoin','connector','',0,300),w:2,h:2};
has([ns[0],ns[2],farJoin],[e('long1','s1','farJoin',{style:'straight'}),e('long2','s2','farJoin',{style:'straight'})],'edge_overlap_');
const near={...n('near','process','x=0',0,275),h:10};
lacks([ns[0],near,farJoin],[e('merge1','s1','farJoin',{style:'straight'}),e('merge2','near','farJoin',{style:'straight'})],'edge_overlap_');
const empty=n('empty','io','');const issue=validateGostFlowchart([empty],[]).find(i=>i.id==='empty_text_empty')!;
const fixed=applyGostAutoFix(issue,[empty],[],10); assert.equal(fixed.nodes[0].text,'cin >> x;');
for (const [name,code] of Object.entries({EXAMPLE_CODE,COMPLEX_CPP_CODE,SWITCH_CASE_CODE,LOOP_IF_CODE,TRIANGLE_IF_CODE})) {
 for (const gostLoopBounds of [false,true]) for(const groupStmts of [false,true]) {
 const graph=buildFlowFromCpp(code, {exampleStyle:false, showKeywords:false, gostLoopBounds, groupStmts, gostNumbers:false, autoSyncCpp:false});
 const issues=validateGostFlowchart(graph.nodes,graph.edges);
 assert.equal(issues.length,0, name + ' bounds=' + gostLoopBounds + ' grouped=' + groupStmts + ': ' + issues.map(i=>i.id).join(', '));
 }
 console.log(name + ': 4 option combinations passed');
}
console.log('Validator regressions passed');

