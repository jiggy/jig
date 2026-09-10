// Freeze the existing SVG palette at build time. WebKit does not reliably
// inherit a page's color scheme inside an SVG loaded through <img>.
module.exports = function diagramTheme(source) {
  const theme = new URLSearchParams(this.resourceQuery.slice(1)).get('diagram-theme');
  if (theme !== 'light' && theme !== 'dark') throw new Error('Unknown diagram theme');
  return source.replace(/@media\s*\(prefers-color-scheme:\s*(light|dark)\)/g,
    (_, scheme) => `@media ${scheme === theme ? 'all' : 'not all'}`);
};
