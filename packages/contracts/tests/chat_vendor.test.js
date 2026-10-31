import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
const root = new URL('../../../', import.meta.url);
const require = createRequire(new URL('apps/shopify/package.json',root));

test('self-hosted Deep Chat asset exactly matches the pinned dependency',()=>{
  const packagePath=require.resolve('deep-chat/package.json');
  assert.equal(JSON.parse(readFileSync(packagePath,'utf8')).version,'2.5.1');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(readFileSync(join(dirname(packagePath),'dist/deepChat.bundle.js'))),
    hash(readFileSync(new URL('apps/shopify/extensions/drake/assets/deep-chat-2.5.1.js',root))));
  assert.match(readFileSync(new URL('apps/shopify/extensions/drake/assets/deep-chat-LICENSE.txt',root),'utf8'),/MIT License/);
});
