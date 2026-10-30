import assert from 'node:assert/strict';
import {getEdgePoints,getPortCoords} from './src/engine/orthoRouter';
import type {FlowNode,FlowEdge} from './src/types/flow';
const block=(id:string,text:string,cx:number,y:number):FlowNode=>({id,text,cx,y,w:120,h:50,type:'process'});
const edge=(from:string,to:string):FlowEdge=>({id:from+to,from,to,fromPort:'bottom',toPort:'top',fromEdge:null,toEdge:null,leftLabel:'',rightLabel:'',style:'ortho',bendOffset:0});
const b=block('b','break;',250,200);
for(const [source,port] of [[block('left','x++;',50,200),'left'],[block('right','x++;',450,200),'right'],[block('above','x++;',250,30),'top']] as const){
  const e=edge(source.id,b.id);
  assert.deepEqual(getEdgePoints([source,b],[e],e)!.at(-1),getPortCoords(b,port));
}
for(const [target,port] of [[block('up','next',250,20),'top'],[block('down','next',250,400),'bottom']] as const){
  const e=edge(b.id,target.id);
  assert.deepEqual(getEdgePoints([b,target],[e],e)![0],getPortCoords(b,port));
}
console.log('Break: horizontal side entry, vertical top entry, adaptive top/bottom exit passed.');
const source=block('source','x++;',50,200), target=block('target','next',500,400);
const input=edge(source.id,b.id), output=edge(b.id,target.id);
assert.deepEqual(getEdgePoints([source,b,target],[input,output],output)![0],getPortCoords(b,'right'),'horizontal branch must leave break through its right side');
const verticalSource=block('vertical','x++;',250,20), verticalInput=edge('vertical',b.id);
assert.deepEqual(getEdgePoints([verticalSource,b,target],[verticalInput,output],output)![0],getPortCoords(b,'bottom'),'vertical branch must leave break through its bottom');
