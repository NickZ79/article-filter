# Article Filter

A searchable, filterable article list built with native DOM APIs, semantic HTML, and modern CSS. No framework, no dependencies, no build step.

**Live demo:** https://nkzastrow.dev/article-filter/

## Run it

The component loads its data with `fetch`, so it needs to be served over HTTP rather than opened as a file:

```bash
npx serve .
# or
python3 -m http.server
```

Then open the local URL it prints.

## What it does

- Loads articles from `articles.json` and sorts them newest first
- Filters by category (radio buttons generated from the data) and by a search term
- Highlights matching text in titles and summaries
- Keeps the current filters in the URL (`?q=grid&category=CSS`), so a filtered view can be bookmarked or shared
- Announces result counts to screen readers through a polite live region
- Shows clear empty and error states, with a retry button if loading fails

## How it's built

**JavaScript (`article-filter.js`)**

- **DOM creation without `innerHTML`.** Cards are built with `createElement` and `textContent`, so article text can never inject markup. Search highlighting splits text into text nodes and `<mark>` elements instead of building an HTML string.
- **Batched rendering.** Cards are assembled in a `DocumentFragment` and written with one `replaceChildren()` call per render.
- **Event delegation.** One `change` listener on the category `<fieldset>` handles every radio button, including ones rendered after the data loads.
- **Debounced search.** Input waits 200 ms after typing stops before re-rendering.
- **Cancellable fetch.** `AbortController` cancels any in-flight request if the component re-initializes, such as after a retry.
- **URL state.** `URLSearchParams` reads filters on load; `history.replaceState` updates them without adding a history entry per keystroke.
- **Data normalization.** Malformed records are dropped instead of breaking the render, and dates are formatted in UTC so a `YYYY-MM-DD` date never displays as the day before.

**HTML (`index.html`)**

- A `role="search"` form with a labeled search input and a `<fieldset>`/`<legend>` for the category group
- Results in a `<ul>` of `<article>` elements, each labeled by its own heading
- A skip link, and `aria-busy` on the list while data loads
- The component is found through `data-*` attributes, so styling classes can change without breaking behavior

**CSS (`styles.css`)**

- Design tokens as CSS custom properties, redefined under `prefers-color-scheme: dark`
- A responsive card grid with `repeat(auto-fill, minmax(min(100%, 18rem), 1fr))`, so no media queries are needed for columns
- Flexbox for the control bar
- Radio buttons stay native and keyboard-accessible; their checked and focus states are drawn on the label with `:has()`
- 44px minimum touch targets, visible `:focus-visible` outlines, and `prefers-reduced-motion` support

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup and the component's markup contract |
| `article-filter.js` | The `ArticleFilter` class |
| `main.js` | Finds each `[data-article-filter]` on the page and starts it |
| `styles.css` | Tokens, layout, and component styles |
| `articles.json` | Sample data |
