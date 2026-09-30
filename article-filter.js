/**
 * ArticleFilter
 *
 * A searchable, filterable article list built with native DOM APIs only:
 * no framework, no build step. It fetches its data, renders with
 * createElement/textContent (never innerHTML, so article text can't inject
 * markup), and keeps the current filters in the URL so a filtered view can
 * be bookmarked or shared.
 *
 * Markup contract (see index.html):
 *   [data-article-filter]      root element, with data-source="<json url>"
 *   [data-filter-form]         the <form> holding the controls
 *   [data-filter-search]       <input type="search">
 *   [data-filter-categories]   <fieldset> the category radios are rendered into
 *   [data-filter-status]       live region announcing result counts
 *   [data-filter-list]         <ul> the article cards are rendered into
 */

const DEBOUNCE_MS = 200;
const ALL = 'all';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  // Dates in the data are plain YYYY-MM-DD strings, which Date parses as UTC
  // midnight. Formatting in UTC keeps "March 14" from showing as "March 13"
  // for anyone west of Greenwich.
  timeZone: 'UTC',
});

export class ArticleFilter {
  constructor(root, { source }) {
    this.root = root;
    this.source = source;
    this.articles = [];
    this.categories = [];
    this.state = { query: '', category: ALL };
    this.controller = null;

    this.form = root.querySelector('[data-filter-form]');
    this.searchInput = root.querySelector('[data-filter-search]');
    this.categoryGroup = root.querySelector('[data-filter-categories]');
    this.status = root.querySelector('[data-filter-status]');
    this.list = root.querySelector('[data-filter-list]');

    // Debounce typing so we re-render once the user pauses, not on every key.
    this.handleSearchInput = debounce(this.handleSearchInput.bind(this), DEBOUNCE_MS);
  }

  async init() {
    this.readStateFromUrl();
    this.bindEvents();
    this.setBusy(true);
    this.setStatus('Loading articles…');

    try {
      this.articles = await this.fetchArticles();
      this.categories = uniqueSorted(this.articles.map((a) => a.category));

      // A shared URL might name a category that no longer exists.
      if (this.state.category !== ALL && !this.categories.includes(this.state.category)) {
        this.state.category = ALL;
      }

      this.renderCategories();
      this.syncControls();
      this.render();
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      this.renderError();
    } finally {
      this.setBusy(false);
    }
  }

  /* ---------- Data ---------- */

  async fetchArticles() {
    // Abort any request still in flight if init() is ever called again.
    this.controller?.abort();
    this.controller = new AbortController();

    const response = await fetch(this.source, { signal: this.controller.signal });
    if (!response.ok) {
      throw new Error(`Could not load articles (HTTP ${response.status})`);
    }

    const data = await response.json();
    return data
      .map(normalizeArticle)
      .filter(Boolean)
      .sort((a, b) => b.date - a.date); // newest first
  }

  getVisibleArticles() {
    const query = this.state.query.trim().toLowerCase();
    const { category } = this.state;

    return this.articles.filter((article) => {
      const inCategory = category === ALL || article.category === category;
      const matchesQuery =
        !query ||
        article.title.toLowerCase().includes(query) ||
        article.summary.toLowerCase().includes(query);
      return inCategory && matchesQuery;
    });
  }

  /* ---------- Events ---------- */

  bindEvents() {
    this.searchInput.addEventListener('input', this.handleSearchInput);

    // One listener on the fieldset handles every radio, including ones
    // rendered after the data arrives (event delegation).
    this.categoryGroup.addEventListener('change', (event) => {
      if (event.target.name !== 'category') return;
      this.state.category = event.target.value;
      this.update();
    });

    // Search runs as you type, so Enter shouldn't reload the page.
    this.form.addEventListener('submit', (event) => event.preventDefault());

    this.form.addEventListener('reset', (event) => {
      // Take over from the browser's reset so state, controls, and the URL
      // all change together.
      event.preventDefault();
      this.state = { query: '', category: ALL };
      this.syncControls();
      this.update();
      this.searchInput.focus();
    });
  }

  handleSearchInput() {
    this.state.query = this.searchInput.value;
    this.update();
  }

  update() {
    this.writeStateToUrl();
    this.render();
  }

  /* ---------- URL state ---------- */

  readStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    this.state.query = params.get('q') ?? '';
    this.state.category = params.get('category') ?? ALL;
  }

  writeStateToUrl() {
    const url = new URL(window.location.href);
    const { query, category } = this.state;

    if (query.trim()) url.searchParams.set('q', query.trim());
    else url.searchParams.delete('q');

    if (category !== ALL) url.searchParams.set('category', category);
    else url.searchParams.delete('category');

    // replaceState rather than pushState: filtering shouldn't fill the back
    // button with one history entry per keystroke.
    window.history.replaceState(null, '', url);
  }

  syncControls() {
    this.searchInput.value = this.state.query;
    const selected = this.categoryGroup.querySelector(
      `input[name="category"][value="${CSS.escape(this.state.category)}"]`
    );
    if (selected) selected.checked = true;
  }

  /* ---------- Rendering ---------- */

  renderCategories() {
    const options = [ALL, ...this.categories];
    const fragment = document.createDocumentFragment();

    for (const value of options) {
      const label = document.createElement('label');
      label.className = 'chip';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'category';
      input.value = value;
      input.className = 'visually-hidden';

      const text = document.createElement('span');
      text.textContent = value === ALL ? 'All' : value;

      label.append(input, text);
      fragment.append(label);
    }

    // Keep the <legend>; replace everything after it.
    this.categoryGroup.querySelectorAll('.chip').forEach((chip) => chip.remove());
    this.categoryGroup.append(fragment);
  }

  render() {
    const visible = this.getVisibleArticles();
    const query = this.state.query.trim();

    if (visible.length === 0) {
      this.list.replaceChildren(this.createEmptyState());
    } else {
      const fragment = document.createDocumentFragment();
      for (const article of visible) {
        fragment.append(this.createCard(article, query));
      }
      // One DOM write for the whole list instead of one per card.
      this.list.replaceChildren(fragment);
    }

    this.setStatus(this.describeResults(visible.length, query));
  }

  createCard(article, query) {
    const item = document.createElement('li');
    item.className = 'card';

    const card = document.createElement('article');
    card.setAttribute('aria-labelledby', `article-${article.id}`);

    const meta = document.createElement('p');
    meta.className = 'card__meta';

    const category = document.createElement('span');
    category.className = 'card__category';
    category.textContent = article.category;

    const time = document.createElement('time');
    time.dateTime = article.dateString;
    time.textContent = dateFormatter.format(article.date);

    meta.append(category, ' · ', time);

    const title = document.createElement('h3');
    title.className = 'card__title';
    title.id = `article-${article.id}`;
    title.append(highlight(article.title, query));

    const summary = document.createElement('p');
    summary.className = 'card__summary';
    summary.append(highlight(article.summary, query));

    card.append(meta, title, summary);
    item.append(card);
    return item;
  }

  createEmptyState() {
    const item = document.createElement('li');
    item.className = 'empty-state';

    const message = document.createElement('p');
    message.textContent = 'No articles match those filters.';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Clear filters';
    // form.reset() fires the same reset event as the main Clear button.
    button.addEventListener('click', () => this.form.reset());

    item.append(message, button);
    return item;
  }

  renderError() {
    const item = document.createElement('li');
    item.className = 'empty-state';

    const message = document.createElement('p');
    message.textContent = "Articles couldn't be loaded right now.";

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => this.init(), { once: true });

    item.append(message, retry);
    this.list.replaceChildren(item);
    this.setStatus("Articles couldn't be loaded.");
  }

  describeResults(count, query) {
    const total = this.articles.length;
    const noun = total === 1 ? 'article' : 'articles';
    let text = `Showing ${count} of ${total} ${noun}`;
    if (this.state.category !== ALL) text += ` in ${this.state.category}`;
    if (query) text += ` matching “${query}”`;
    return `${text}.`;
  }

  setStatus(text) {
    // The status element is role="status" (aria-live="polite"), so screen
    // readers announce the new count without stealing focus.
    this.status.textContent = text;
  }

  setBusy(isBusy) {
    this.list.setAttribute('aria-busy', String(isBusy));
  }
}

/* ---------- Helpers ---------- */

function normalizeArticle(raw) {
  if (!raw || typeof raw.title !== 'string' || typeof raw.date !== 'string') return null;
  const date = new Date(raw.date);
  if (Number.isNaN(date.getTime())) return null;

  return {
    id: String(raw.id),
    title: raw.title,
    summary: raw.summary ?? '',
    category: raw.category ?? 'Uncategorized',
    date,
    dateString: raw.date,
  };
}

/**
 * Returns a DocumentFragment with each case-insensitive match of `query`
 * wrapped in <mark>. Built from text nodes, so it's safe with any input.
 */
function highlight(text, query) {
  const fragment = document.createDocumentFragment();
  if (!query) {
    fragment.append(text);
    return fragment;
  }

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let start = 0;
  let index = haystack.indexOf(needle, start);

  while (index !== -1) {
    fragment.append(text.slice(start, index));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(index, index + needle.length);
    fragment.append(mark);
    start = index + needle.length;
    index = haystack.indexOf(needle, start);
  }

  fragment.append(text.slice(start));
  return fragment;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function debounce(fn, wait) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
