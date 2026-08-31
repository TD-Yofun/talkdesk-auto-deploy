import './preview.scss';

const opened = [
  ['Talkdesk/atlas-apps-configuration', '#624', 'Prevent duplicate watchdog recovery'],
  ['Talkdesk/api-gw-configuration', '#319', 'Align production gateway defaults'],
  ['Talkdesk/insurer-360-app', '#1452', 'Update launch checklist'],
];
const reviews = [
  ['Talkdesk/client-profile', '#887', 'Add production environment review'],
  ['Talkdesk/deployments', '#410', 'Simplify approval status reporting'],
];

function renderItems(items: string[][]): string {
  return items.map(([repo, number, title]) => `<div class="aad-pr-item">
    <a href="https://github.com" target="_blank" rel="noopener" class="aad-pr-link">${title}</a>
    <span class="aad-pr-meta">${repo} · ${number}</span>
  </div>`).join('');
}

function render(loading = false): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main class="preview-shell">
    <header class="preview-header"><strong>GitHub</strong><span>Dashboard</span><span>Pull requests</span><span>Issues</span></header>
    <div class="preview-layout">
      <aside class="preview-sidebar">
        <div class="preview-user">TD-Yofun</div>
        <section class="preview-repositories"><div class="preview-section-header"><strong>Top repositories</strong><button>New</button></div><input placeholder="Find a repository..." /><span>Talkdesk/atlas-apps-configuration</span><span>Talkdesk/insurer-360-app</span><span>TD-Yofun/github-auto-deploy</span></section>
        <section id="aad-pr-sidebar">
          <div class="aad-pr-header"><span>My pull requests</span><button class="aad-pr-refresh" title="Refresh pull requests">↻</button></div>
          ${loading ? '<div class="aad-pr-empty">Loading pull requests...</div>' : `<div class="aad-pr-group"><div class="aad-pr-group-title"><span>Opened by me</span><span>${opened.length}</span></div>${renderItems(opened)}<a href="https://github.com/pulls" target="_blank" rel="noopener" class="aad-pr-all">View all opened PRs</a></div><div class="aad-pr-group"><div class="aad-pr-group-title"><span>Reviewed by me</span><span>${reviews.length}</span></div>${renderItems(reviews)}<a href="https://github.com/pulls" target="_blank" rel="noopener" class="aad-pr-all">View all reviewed PRs</a></div>`}
        </section>
      </aside>
      <div class="preview-content"><h1>Home</h1><div class="preview-feed"></div><div class="preview-feed preview-feed-short"></div></div>
    </div>
  </main>`;

  document.querySelector('.aad-pr-refresh')?.addEventListener('click', () => {
    render(true);
    setTimeout(() => render(), 500);
  });
}

render();
