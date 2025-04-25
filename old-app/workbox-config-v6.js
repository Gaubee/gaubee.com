module.exports = {
  globDirectory: 'docs/',
  globPatterns: ['**/*.{css,svg,jpg,png,webp,mjs,html,ico,txt}'],
  swDest: 'docs/sw.js',
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
};
