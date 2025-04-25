## Dev & Build

To watch the site files, and re-build automatically, run:

```bash
pnpm build:watch # gen /dist/
pnpm analyze:watch # gen /custom-elements.json
pnpm bundle:watch # gen /bundle/ (depends on /dist/)
pnpm docs:gen:watch # gen /docs/ (depends on /bundle/ and /custom-elements.json)
```

The site will usually be served at http://localhost:8000.
