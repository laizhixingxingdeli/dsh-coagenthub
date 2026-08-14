/**
 * Build the CoAgentHub browser-half bundle into lib/client.js, in the dsh
 * closure-factory format: `window.__ModuleLoader__.load({ id, factory })`.
 * Platform words (react, cordis, ui-slots, …) stay external and resolve
 * through the injected require; CSS Modules are compiled inline and injected
 * as a `<style data-plugin>` tag, mirroring the dsh tsdown client preset.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { build } from 'esbuild'

const PKG_ID = '@laizhixingxingdeli/dsh-coagenthub'

// Platform module table (packages/client/web/src/platform.ts): the ONLY
// specifiers the browser loader table answers; everything else is inlined.
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

/** Inline `*.module.css` imports: hashed class map + auto-injected style tag. */
const cssModulePlugin = {
  name: 'dsh-css-modules-inline',
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, async (args) => {
      const source = readFileSync(args.path, 'utf8')
      const classMap = {}
      const css = source.replace(/\.([_a-zA-Z][\w-]*)/g, (match, local) => {
        const hash = createHash('sha1').update(`${args.path}:${local}`).digest('hex').slice(0, 8)
        // 类名必须以字母开头:数字开头(如 5e…)会被 CSS tokenizer 当作
        // 科学计数法,导致整个选择器非法、规则被浏览器丢弃。
        classMap[local] = `c${hash}_${local}`
        return `.${classMap[local]}`
      })
      const tagId = `${PKG_ID}/${basename(args.path)}`
      const code = [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(PKG_ID)};`,
        `  tag.dataset.pluginCss = tagId;`,
        `  tag.textContent = css;`,
        `  document.head.appendChild(tag);`,
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
      return { contents: code, loader: 'js' }
    })
  },
}

await build({
  entryPoints: ['src/client-ui/index.ts'],
  bundle: true,
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  external: EXTERNALS,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
  plugins: [cssModulePlugin],
  logLevel: 'info',
})
