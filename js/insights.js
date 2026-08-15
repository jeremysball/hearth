// insights.js: merged Trends + Growth view, one long scroll (Trends first).
import { trends } from './trends.js';
import { growth } from './growth.js';

export function insights() {
  return `<div class="insights-view">${trends()}${growth()}</div>`;
}
