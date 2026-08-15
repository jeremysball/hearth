// insights.js: merged Trends + Growth view, one long scroll (Trends first).
import { trends } from './trends.js';
import { growth } from './growth.js';

export function insights() {
  // trends() and growth() each render their own page-hd/page-title block;
  // .insights-view hides those (see styles.css) and this header replaces
  // them with a single unified title for the merged tab.
  return `
    <div class="page-hd">
      <h1 class="page-title">Insights</h1>
    </div>
    <div class="insights-view">${trends()}${growth()}</div>`;
}
