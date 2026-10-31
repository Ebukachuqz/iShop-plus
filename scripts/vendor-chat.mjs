// Reproduce the pinned, self-hosted storefront dependency (no shopper-time CDN).
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(new URL('../apps/shopify/package.json', import.meta.url));
const source = dirname(require.resolve('deep-chat/package.json'));
const assets = new URL('../apps/shopify/extensions/drake/assets/', import.meta.url);
copyFileSync(resolve(source, 'dist/deepChat.bundle.js'), new URL('deep-chat-2.5.1.js', assets));
copyFileSync(resolve(source, 'LICENSE'), new URL('deep-chat-LICENSE.txt', assets));
