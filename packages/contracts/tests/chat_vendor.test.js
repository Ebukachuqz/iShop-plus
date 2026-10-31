import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
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
  const notice=JSON.parse(readFileSync(new URL('apps/shopify/extensions/drake/assets/deep-chat-license.json',root),'utf8'));
  assert.equal(notice.license,readFileSync(join(dirname(packagePath),'LICENSE'),'utf8'));
});

test('Shopify extension assets use supported formats and a small schema entrypoint',()=>{
  const assets=new URL('apps/shopify/extensions/drake/assets/',root);
  const allowed=new Set(['jpg','jpeg','js','css','png','svg','json','wasm']);
  for(const file of readdirSync(assets)) assert.ok(allowed.has(file.split('.').at(-1)),`Unsupported Shopify asset: ${file}`);
  const liquid=readFileSync(new URL('apps/shopify/extensions/drake/blocks/drake-embed.liquid',root),'utf8');
  const schema=JSON.parse(liquid.split('{% schema %}')[1].split('{% endschema %}')[0]);
  assert.equal(schema.javascript,'drake-entry.js');
  assert.ok(statSync(new URL(schema.javascript,assets)).size < 10000);
});
