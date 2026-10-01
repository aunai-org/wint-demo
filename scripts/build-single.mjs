// Builds a single self-contained page (no network, no extra files): the engine is inlined as
// base64 WASM, the sample data as a string, and the live-forecast controls are hidden.
//   node scripts/build-single.mjs <out.html> [--fragment]
// --fragment omits <!doctype>/<html>/<head>/<body>, for hosts that supply their own page skeleton.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const [out, ...flags] = process.argv.slice(2);
if (!out) { console.error('usage: build-single.mjs <out.html> [--fragment]'); process.exit(2); }
const fragment = flags.includes('--fragment');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).trim();
const title = /<title>(.*?)<\/title>/.exec(html)[1];
const description = /<meta name="description" content="(.*?)">/.exec(html)[1];

// Turn the ES-module glue into a plain object so everything fits in one inline script.
const glue = read('vendor/wint.js');
const names = [...glue.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
const wint = glue
  .replace(/^export function /gm, 'function ')
  .replace(/^export \{[^}]*\};?\s*$/m, '');
const app = read('app.js').replace(/^import init, \* as wint from .*$/m, 'const init = wint.default;');
if (app.includes("from './vendor")) throw new Error('app.js import was not replaced');

const wasmB64 = readFileSync(join(root, 'vendor/wint_bg.wasm')).toString('base64');
const sample = read('sample-forecast.json').trim();
JSON.parse(sample); // fail the build on a corrupt sample
const sampleMulti = read('sample-multi-model.json').trim();
JSON.parse(sampleMulti);

const script = `window.WINT_EMBED = true;
window.WINT_WASM_B64 = ${JSON.stringify(wasmB64)};
window.WINT_SAMPLE = ${JSON.stringify(sample)};
window.WINT_SAMPLE_MULTI = ${JSON.stringify(sampleMulti)};
const wint = (() => {
${wint}
return { default: __wbg_init, initSync, ${names.join(', ')} };
})();
${app}`;
if (/<\/script/i.test(script)) throw new Error('script contains </script');

const style = read('style.css');
const content = `<title>${title}</title>
<style>
${style}
</style>
${body}
<script type="module">
${script}
</script>
`;
const doc = fragment
  ? content
  : `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${description}">\n${content}</body></html>\n`;
writeFileSync(out, doc);
console.log(`${out}: ${(doc.length / 1024).toFixed(0)} KB${fragment ? ' (fragment)' : ''}`);
