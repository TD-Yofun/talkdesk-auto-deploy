import { defineConfig, type Plugin } from 'vite';
import monkey, { type MonkeyUserScript } from 'vite-plugin-monkey';

const userscriptConfig: MonkeyUserScript = {
  name: 'Auto-Approve Deploy Gates',
  namespace: 'https://github.com/auto-deploy-gates',
  version: '1.0.0',
  description: 'Automatically approve GitHub Actions deployment gates & skip wait timers',
  author: 'auto-deploy',
  match: ['https://github.com/*/actions/runs/*'],
  grant: [
    'GM_xmlhttpRequest',
    'GM_getValue',
    'GM_setValue',
    'GM_addStyle',
    'GM_registerMenuCommand',
  ],
  connect: ['api.github.com'],
  'run-at': 'document-idle',
};

/** Minify CSS inside GM_addStyle(`...`) and HTML inside .innerHTML = `...` */
function minifyTemplateStrings(): Plugin {
  return {
    name: 'minify-template-strings',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;

        // Minify CSS in GM_addStyle(`...`)
        chunk.code = chunk.code.replace(
          /(GM_addStyle\s*\(\s*`)([^`]+)(`\s*\))/g,
          (_, pre, css, post) => pre + minifyCSS(css) + post,
        );

        // Minify HTML in template literals assigned to .innerHTML
        chunk.code = chunk.code.replace(
          /(\.innerHTML\s*=\s*`)([^`]+)(`)/g,
          (_, pre, html, post) => pre + minifyHTML(html) + post,
        );
      }
    },
  };
}

function minifyCSS(css: string): string {
  return css
    .replace(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, '') // remove comments
    .replace(/\s*\n\s*/g, '')                         // collapse newlines
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')            // remove space around symbols
    .replace(/;}/g, '}')                              // remove trailing semicolons
    .replace(/\s{2,}/g, ' ')                          // collapse remaining whitespace
    .trim();
}

function minifyHTML(html: string): string {
  return html
    .replace(/\s*\n\s*/g, '')                         // collapse newlines + indentation
    .replace(/>\s+</g, '><')                          // remove space between tags
    .replace(/\s{2,}/g, ' ')                          // collapse remaining whitespace
    .trim();
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  const fileName = isProd
    ? 'auto-approve-deploy.min.user.js'
    : 'auto-approve-deploy.user.js';

  return {
    plugins: [
      monkey({
        entry: 'src/main.ts',
        userscript: userscriptConfig,
        build: { fileName },
      }),
      ...(isProd ? [minifyTemplateStrings()] : []),
    ],
    build: {
      outDir: '.',
      emptyOutDir: false,
      minify: isProd ? 'esbuild' : false,
    },
  };
});
