import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(dirname(fileURLToPath(import.meta.url)));
const checks = [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ...['parser-tests.ts', 'router-tests.ts', 'break-ports-tests.ts', 'routing-fixes-tests.ts', 'matrix-routing-tests.ts', 'return-route-tests.ts', 'validator-tests.ts', 'graph-editing-tests.ts', 'integration-tests.ts', 'arrays-tests.ts'].map(file => ['node_modules/tsx/dist/cli.mjs',file]),
];
for(const args of checks){
  console.log('\nRunning: node '+args.join(' '));
  const result=spawnSync(process.execPath,args,{stdio:'inherit'});
  if(result.status!==0) process.exit(result.status||1);
}
