// Inlines the Vite build into one HTML fragment (no <html>/<head>/<body>
// wrappers) so the app can be hosted anywhere that takes a single file.
// Usage: npm run build && node scripts/bundle-single.mjs [out.html]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve('dist')
const out = resolve(process.argv[2] ?? 'dist/drum-lab.single.html')
const html = readFileSync(resolve(dist, 'index.html'), 'utf8')

const asset = (href) => readFileSync(resolve(dist, href.replace(/^\//, '')), 'utf8')
const inlineUrls = (text) =>
  text.replace(/url\((["']?)\/([^"')]+\.(?:jpg|jpeg|png|webp|svg))\1\)/g, (match, _q, file) => {
    const path = resolve(dist, file)
    if (!existsSync(path)) return match
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }[file.split('.').pop()]
    return `url("data:${mime};base64,${readFileSync(path).toString('base64')}")`
  })
const css = inlineUrls(
  [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => asset(m[1])).join('\n'),
)
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)]
  .map((m) => asset(m[1]).replaceAll('</script', '<\\/script'))
  .join('\n')
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Drum lab'
const fonts = [...html.matchAll(/<link[^>]*fonts\.googleapis\.com[^>]*>/g)].map((m) => m[0]).join('\n')

const single = `<title>${title}</title>
${fonts}
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`
writeFileSync(out, single)
console.log(`wrote ${out} (${(single.length / 1024).toFixed(0)} kB)`)
if (!existsSync(out)) process.exit(1)
