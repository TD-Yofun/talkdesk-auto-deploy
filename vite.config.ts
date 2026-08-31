import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import monkey, { type MonkeyUserScript } from 'vite-plugin-monkey';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

const userscriptConfig: MonkeyUserScript = {
  name: 'Auto-Approve Deploy Gates',
  namespace: 'https://github.com/auto-deploy-gates',
  version: pkg.version,
  description: 'Automatically click "Start all waiting jobs" on Deploy (PRD) workflow runs',
  author: 'auto-deploy',
  homepageURL: 'https://github.com/TD-Yofun/github-auto-deploy',
  supportURL: 'https://github.com/TD-Yofun/github-auto-deploy/issues',
  updateURL: 'https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js',
  downloadURL: 'https://github.com/TD-Yofun/github-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js',
  match: ['https://github.com/*'],
  grant: [
    'GM_xmlhttpRequest',
    'GM_getValue',
    'GM_setValue',
    'GM_addStyle',
    'GM_registerMenuCommand',
    'GM_notification',
  ],
  connect: ['github.com', 'release-assets.githubusercontent.com'],
  'run-at': 'document-idle',
};

/** Minify HTML inside .innerHTML = `...`; Sass is compiled and minified by Vite. */
function minifyTemplateStrings(): Plugin {
  return {
    name: 'minify-template-strings',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;

        // Minify HTML in template literals assigned to .innerHTML
        chunk.code = chunk.code.replace(
          /(\.innerHTML\s*=\s*`)([^`]+)(`)/g,
          (_, pre, html, post) => pre + minifyHTML(html) + post,
        );
      }
    },
  };
}

function minifyHTML(html: string): string {
  return html
    .replace(/\s*\n\s*/g, '')                         // collapse newlines + indentation
    .replace(/>\s+</g, '><')                          // remove space between tags
    .replace(/\s{2,}/g, ' ')                          // collapse remaining whitespace
    .trim();
}

export default defineConfig(({ mode, command }) => {
  const isProd = mode === 'production';
  const isPreview = command === 'serve' && mode === 'preview';
  const fileName = isProd
    ? 'auto-approve-deploy.min.user.js'
    : 'auto-approve-deploy.user.js';

  return {
    plugins: [
      ...(!isPreview ? [
        monkey({
          entry: 'src/main.ts',
          userscript: userscriptConfig,
          build: { fileName },
          server: { mountGmApi: true },
        }),
        ...(isProd ? [minifyTemplateStrings()] : []),
      ] : []),
    ],
    build: {
      outDir: 'build',
      emptyOutDir: false,
      minify: isProd ? 'esbuild' : false,
    },
  };
});
