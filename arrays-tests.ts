import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFlowFromCpp, synthesizeCppFromGraph } from './src/engine/cppParserAndBuilder';
import { validateGostFlowchart } from './src/engine/gostValidator';
const header='#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n';
const fixtures=[
  {name:'array_1d',code:header+'int main(){int arr[5] = {5, 1, 4, 2, 3};sort(arr,arr+5);for(int i=0;i<5;i++){cout << arr[i] << " ";}return 0;}',inputs:[''],tokens:['int arr[5] = {5, 1, 4, 2, 3};','cout << arr[i] << " ";']},
  {name:'matrix_2d',code:header+'int main(){int mat[2][2] = {{1, 2}, {3, 4}};int sum=0;for(int i=0;i<2;i++){for(int j=0;j<2;j++){cin >> mat[i][j];if(mat[i][j]>0){sum+=mat[i][j];}}}cout << sum << endl;return 0;}',inputs:['1 2 3 4','-1 0 5 -2'],tokens:['int mat[2][2] = {{1, 2}, {3, 4}};','cin >> mat[i][j];','mat[i][j]>0']},
  {name:'cube_3d',code:header+'int main(){int a[2][2][2]={{{1,2},{3,4}},{{5,6},{7,8}}};int sum=0;for(int i=0;i<2;i++){for(int j=0;j<2;j++){for(int k=0;k<2;k++){if(a[i][j][k]%2==0){sum+=a[i][j][k];}}}}cout<<sum;return 0;}',inputs:[''],tokens:['int a[2][2][2]={{{1,2},{3,4}},{{5,6},{7,8}}};','a[i][j][k]%2==0']},
  {name:'bubble_sort',code:header+'int main(){int a[]={4,3,2,1};for(int i=0;i<4;i++){for(int j=0;j<3-i;j++){if(a[j]>a[j+1]){swap(a[j],a[j+1]);}}}for(auto& x : a){cout<<x;}return 0;}',inputs:[''],tokens:['int a[]={4,3,2,1};','a[j]>a[j+1]','auto& x : a']},
  {name:'dynamic_array',code:header+'int main(){int n=4;int* p = new int[n]{1,2,3,4};p[1]=p[0]+5;cout << p[1];delete[] p;return 0;}',inputs:[''],tokens:['int* p = new int[n]{1,2,3,4};','delete[] p;','p[1]=p[0]+5;']},
  {name:'vector_templates',code:header+'int main(){std::vector<std::vector<int>> m(2, std::vector<int>(3, 1));std::vector<int> values{3, 1, 2};std::sort(values.begin(), values.end());int total=0;for(auto& row : m){for(auto value : row){total+=value;}}for(const auto& x : values){cout<<x;}cout<<total;return 0;}',inputs:[''],tokens:['std::vector<std::vector<int>> m(2, std::vector<int>(3, 1));','std::vector<int> values{3, 1, 2};','auto& row : m','const auto& x : values']},
  {name:'array_function',code:header+'int sum(int a[],int n){int result=0;for(int i=0;i<n;i++){if(a[i]<0){return -1;}result+=a[i];}return result;}int main(){int a[3]={1,2,3};cin  >> a[1];cout  << sum(a,3) << "\\n" << std::endl;return 0;}',inputs:['4','-2'],tokens:['int a[3]={1,2,3};','cin  >> a[1];','cout  << sum(a,3) << "\\n" << std::endl;']},
  {name:'array_switch',code:header+'int main(){int a[2]={2,1};switch(a[0]){case 2:{int m[2][2]={{1,2},{3,4}};cout<<m[1][1];break;}default:cout<<a[1];}return 0;}',inputs:[''],tokens:['int m[2][2]={{1,2},{3,4}};','cout<<m[1][1];']},
  {name:'constexpr_std_array',code:header+'#include <array>\nint main(){constexpr int n=3;constexpr int a[n]{1,2,3};std::array<std::array<int,2>,2> mat{{{{1,2}},{{3,4}}}};int total=0;for(auto x : std::array<int,3>{a[0],a[1],a[2]}){total+=x;}for(const auto& row : mat){for(auto value : row){cout << value;}}cout<<total;return 0;}',inputs:[''],tokens:['constexpr int a[n]{1,2,3};','std::array<std::array<int,2>,2> mat{{{{1,2}},{{3,4}}}};','auto x : std::array<int,3>{a[0],a[1],a[2]}','cout << value;']},
  {name:'struct_aggregate_methods',code:header+'int main(){struct Point {int x;int y;};Point p{1,2};std::vector<int> a{};a.push_back(p.x);a.push_back(p.y);int* ptr=new int[2]();ptr[0]=a[0]+a[1];cout<<ptr[0];delete [] ptr;return 0;}',inputs:[''],tokens:['struct Point {int x;int y;};','Point p{1,2};','a.push_back(p.x);','int* ptr=new int[2]();','delete [] ptr;']},
  {name:'stream_nested_operators',code:header+'int main(){int arr[4]={10,20,30,40};int i=2;cin >> arr[i >> 1];cout << "<< >>" << arr[i >> 1] << (i << 1) << endl;return 0;}',inputs:['7','-3'],tokens:['cin >> arr[i >> 1];','cout << "<< >>" << arr[i >> 1] << (i << 1) << endl;']},
];
const base={exampleStyle:true,showKeywords:true,gostLoopBounds:false,groupStmts:false,gostNumbers:false,autoSyncCpp:true};
mkdirSync('.engine-checks',{recursive:true});let scenarios=0;const diagnostics:string[]=[];
for(const fixture of fixtures){
  for(const groupStmts of [false,true]){
    const g=buildFlowFromCpp(fixture.code,{...base,groupStmts});
    for(const token of fixture.tokens) assert.ok(g.nodes.some(n=>n.text.includes(token)),fixture.name+': intact '+token);
    for(const n of g.nodes.filter(n=>n.type==='io')) assert.ok(fixture.code.includes(n.text),fixture.name+': exact I/O');
    for(const fn of new Set(g.nodes.map(n=>n.fnId))){
      const ends=g.nodes.filter(n=>n.fnId===fn&&n.type==='terminator'&&!/^Начало/.test(n.text));
      assert.equal(ends.length,1);assert.match(ends[0].text,/^return\b/);assert.ok(!g.edges.some(e=>e.from===ends[0].id));
      const closing=g.nodes.filter(n=>n.fnId===fn&&n.type==='brace'&&n.text==='}').sort((a,b)=>b.y-a.y)[0];
      assert.ok(closing&&closing.y>=ends[0].y+ends[0].h);
    }
    if(fixture.name==='vector_templates') for(const token of fixture.tokens.slice(0,2)) assert.equal(g.nodes.find(n=>n.text.includes(token))!.type,'process');
    if(fixture.name==='dynamic_array') for(const token of fixture.tokens.slice(0,2)) assert.equal(g.nodes.find(n=>n.text.includes(token))!.type,'process');
    for(const n of g.nodes.filter(n=>/^(?:std::)?(?:sort|swap)\(/.test(n.text))) assert.equal(n.type,'process');
    for(const n of g.nodes.filter(n=>/^a\.push_back\(/.test(n.text))) assert.equal(n.type,'process');
    const issues=validateGostFlowchart(g.nodes,g.edges).filter(i=>i.severity!=='ok');
    diagnostics.push(...issues.map(i=>fixture.name+': '+i.id));
    const rebuilt=synthesizeCppFromGraph(g.nodes,g.edges).code;
    const executables:string[]=[];
    for(const [version,code] of [['original',fixture.code],['rebuilt',rebuilt]]){
      const file=join('.engine-checks',fixture.name+'-'+Number(groupStmts)+'-'+version+'.cpp');
      const exe=file.replace(/\.cpp$/,'.exe');writeFileSync(file,code);
      const result=spawnSync(process.env.CXX||'g++',['-std=c++17',file,'-o',exe],{encoding:'utf8',timeout:30000});
      assert.equal(result.status,0,fixture.name+' '+version+': '+result.stderr);executables.push(exe);
    }
    for(const input of fixture.inputs){
      const results=executables.map(exe=>spawnSync(exe,[],{input,encoding:'utf8',timeout:5000}));
      assert.equal(results[1].error,undefined);assert.equal(results[1].status,results[0].status);assert.equal(results[1].stdout,results[0].stdout);scenarios++;
    }
  }
  console.log(fixture.name+' arrays/raw-I/O roundtrip passed');
}
assert.deepEqual(diagnostics,[],'array topology and symbol diagnostics');
console.log('Arrays: '+fixtures.length+' fixtures, both statement-grouping modes, '+scenarios+' compiled execution comparisons passed.');
