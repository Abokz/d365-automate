// build.js — esbuild config
// Run: node build.js           → one-shot build
//      node build.js --watch   → watch mode for development
//      node build.js --minify  → minified production build

const esbuild = require('esbuild');
const watch  = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');
const buildTime = new Date().toISOString();

const sharedOptions = {
  entryPoints: ['src/index.js'],
  bundle:      true,
  format:      'iife',
  globalName:  'D365ToolkitBundle',
  platform:    'browser',
  target:      ['chrome110', 'firefox115', 'edge110'],
  outfile:     minify ? 'dist/d365-toolkit.min.js' : 'dist/d365-toolkit.js',
  minify,
  define: {
      __BUILD_VERSION__: JSON.stringify(buildTime),
  },
  banner: {
    js: `/* D365 Toolkit — built ${buildTime} */`,
  },
};

if (watch) {
  esbuild.context(sharedOptions).then(ctx => {
    ctx.watch();
    console.log('[esbuild] watching for changes…');
  });
} else {
  esbuild.build(sharedOptions)
    .then(() => console.log(`[esbuild] ✅ ${sharedOptions.outfile} built successfully`))
    .catch(e => { console.error(e); process.exit(1); });
}
