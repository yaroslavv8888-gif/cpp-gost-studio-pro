import assert from 'node:assert/strict';
import {buildFlowFromCpp} from './src/engine/cppParserAndBuilder';
import {getEdgePoints,getLoopRoutingScopes,resetRoutingTracks} from './src/engine/orthoRouter';
const opts={exampleStyle:true,showKeywords:true,gostLoopBounds:false,groupStmts:false,gostNumbers:false,autoSyncCpp:true};
for(const fixture of ['matrix2','matrix3','bubble','wide'] as const){
  const depth=fixture==='matrix3'?3:2;
  let body=depth===3?'a[i][j][k]++;':'a[i][j]++;';
  for(let d=depth-1;d>=0;d--){const v=['i','j','k'][d];body=`for(int ${v}=0;${v}<2;${v}++){${body}}`;}
  const declaration=depth===3?'int a[2][2][2]={{{1,2},{3,4}},{{5,6},{7,8}}};':'int a[2][2]={{1,2},{3,4}};';
  if(fixture==='bubble') body='for(int i=0;i<n;i++){for(int j=0;j<n-i-1;j++){if(a[j]>a[j+1]){int tmp=a[j];a[j]=a[j+1];a[j+1]=tmp;}}}';
  if(fixture==='wide') body='for(int row=0;row<rows;row++){for(int column=0;column<columns;column++){matrix[row][column]=left_hand_matrix_with_long_name[row][column]+right_hand_matrix_with_long_name[row][column];}}';
  const g=buildFlowFromCpp(`int main(){${declaration}${body}return 0;}`,opts);
  const scopes=getLoopRoutingScopes(g.nodes,g.edges);
  assert.deepEqual(scopes.map(s=>s.loopTrackIndex),Array.from({length:depth},(_,i)=>i),'innermost is track0, parents increment outward');
  scopes.forEach(s=>{
    assert.equal(s.returnTrackX,s.minBodyX-28-s.loopTrackIndex*22,'exact left channel allocation');
    assert.equal(s.bypassTrackX,s.maxBodyX+28+s.loopTrackIndex*22,'exact right channel allocation');
    const contained=g.nodes.filter(n=>s.nodeIds.includes(n.id)&&!['brace','comment'].includes(n.type));
    assert.ok(contained.every(n=>n.cx-n.w/2>=s.minBodyX-.01&&n.cx+n.w/2<=s.maxBodyX+.01),'complete expression widths included');
    for(const child of scopes.filter(c=>c!==s&&s.nodeIds.includes(c.headId))) {
      assert.ok(s.minBodyX<=child.returnTrackX&&s.maxBodyX>=child.bypassTrackX,'child tracks propagate into parent bounds');
    }
  });
  const loops=g.nodes.filter(n=>n.control?.kind==='loop').sort((a,b)=>b.y-a.y);
  const channels=loops.map(head=>{
    const entry=g.edges.find(e=>e.to===head.id)!.from;
    const back=g.edges.find(e=>e.to===entry && e.style==='loop_left')!;
    assert.ok(back,'loop has a return channel');
    const pts=getEdgePoints(g.nodes,g.edges,back)!;
    const vertical=pts.slice(1).map((b,i)=>({a:pts[i],b})).filter(s=>s.a.x===s.b.x&&s.b.y<s.a.y);
    assert.ok(vertical.length,'return must travel up');
    return {x:Math.min(...vertical.map(s=>s.a.x)),points:pts};
  });
  const bypasses=loops.map(head=>getEdgePoints(g.nodes,g.edges,g.edges.find(e=>e.from===(head.control!.conditionId||head.id)&&e.to===head.control!.joinId&&e.style==='bypass_right')!)!);
  loops.forEach((head,i)=>{
    const scope=scopes.find(s=>s.headId===head.id)!;
    assert.equal(channels[i].x,scope.returnTrackX,'rendered return uses allocated X');
    assert.equal(Math.max(...bypasses[i].map(p=>p.x)),scope.bypassTrackX,'rendered bypass uses allocated X');
  });
  const all=[...channels.map(c=>c.points),...bypasses];
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)for(let s=1;s<all[i].length;s++)for(let t=1;t<all[j].length;t++) {
    const a=all[i][s-1],b=all[i][s],c=all[j][t-1],d=all[j][t];
    const crosses=a.x===b.x&&c.y===d.y&&a.x>Math.min(c.x,d.x)&&a.x<Math.max(c.x,d.x)&&c.y>Math.min(a.y,b.y)&&c.y<Math.max(a.y,b.y);
    const reverse=a.y===b.y&&c.x===d.x&&c.x>Math.min(a.x,b.x)&&c.x<Math.max(a.x,b.x)&&a.y>Math.min(c.y,d.y)&&a.y<Math.max(c.y,d.y);
    assert.ok(!crosses&&!reverse,fixture+': loop return/exit routes must not cross');
  }
  const original=g.edges.map(e=>getEdgePoints(g.nodes,g.edges,e));
  resetRoutingTracks();
  [...g.edges].reverse().forEach(e=>assert.deepEqual(getEdgePoints(g.nodes,g.edges,e),original[g.edges.indexOf(e)],'edge request order is deterministic'));
  for(let i=1;i<channels.length;i++) assert.ok(channels[i].x<=channels[i-1].x-22,'outer return channel must lie at least 22px left of inner');
  for(let i=0;i<channels.length;i++)for(let j=i+1;j<channels.length;j++){
    for(let s=1;s<channels[i].points.length;s++)for(let t=1;t<channels[j].points.length;t++){
      const a=channels[i].points[s-1],b=channels[i].points[s],c=channels[j].points[t-1],d=channels[j].points[t];
      const cross=a.x===b.x&&c.y===d.y&&a.x>Math.min(c.x,d.x)&&a.x<Math.max(c.x,d.x)&&c.y>Math.min(a.y,b.y)&&c.y<Math.max(a.y,b.y);
      const reverse=a.y===b.y&&c.x===d.x&&c.x>Math.min(a.x,b.x)&&c.x<Math.max(a.x,b.x)&&a.y>Math.min(c.y,d.y)&&a.y<Math.max(c.y,d.y);
      assert.ok(!cross&&!reverse,'nested return routes must not cross');
    }
  }
  console.log(`${fixture}: distinct ordered channels ${channels.map(c=>c.x).join(', ')}`);
}

const separate=buildFlowFromCpp('int f(int n){for(int i=0;i<n;i++){if(i){return 1;}}for(int j=0;j<n;j++){very_wide_sequential_sibling_variable_name+=j;}return 0;}int main(){for(int x=0;x<3;x++){x++;}return f(2);}',opts);
const independent=getLoopRoutingScopes(separate.nodes,separate.edges);
assert.equal(independent.length,3);
assert.ok(independent.every(s=>s.loopTrackIndex===0),'sequential and separate-function loops stay independent');
for(const scope of independent) {
  const head=separate.nodes.find(n=>n.id===scope.headId)!;
  const members=separate.nodes.filter(n=>scope.nodeIds.includes(n.id));
  assert.ok(members.every(n=>n.fnId===head.fnId&&n.type!=='terminator'),'scope excludes other functions and shared function exits');
  assert.ok(independent.filter(s=>s!==scope).every(s=>!scope.nodeIds.includes(s.headId)),'scope excludes sequential sibling headers');
}
