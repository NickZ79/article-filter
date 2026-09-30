import { ArticleFilter } from './article-filter.js';

// Any number of filters can live on one page; each reads its own data source.
document.querySelectorAll('[data-article-filter]').forEach((root) => {
  new ArticleFilter(root, { source: root.dataset.source }).init();
});
