/* Build: inline every source file into one self-contained HTML document.
   Usage: node build.js [outputPath] */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');

/* Dependency order matters — these are plain globals, not modules. */
const ORDER = [
  'engine.js',
  'desktop-bridge.js',
  'store.js',
  'ui-core.js',
  'imports.js',
  'directory-sync.js',
  'pwa.js',
  'views-dashboard.js',
  'views-ribbon.js',
  'views-blueprint.js',
  'views-timeline.js',
  'views-people.js',
  'views-pipeline.js',
  'views-workload.js',
  'views-scenarios.js',
  'views-data.js',
  'app.js'
];

const template = fs.readFileSync(path.join(__dirname, 'index.template.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');

const vendor = [
  path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'),
  path.join(__dirname, 'node_modules', '@azure', 'msal-browser', 'lib', 'msal-browser.min.js')
];
vendor.forEach(p => {
  if (!fs.existsSync(p)) throw new Error(`Missing dependency: ${p}. Run npm install.`);
});

const js = vendor.map(p => `/* ===== vendor: ${path.basename(p)} ===== */\n${fs.readFileSync(p, 'utf8')}`)
  .concat(ORDER.map(f => {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) throw new Error(`Missing source file: ${f}`);
  let code = fs.readFileSync(p, 'utf8');
  // Strip the Node test hook — it would throw in a browser without CommonJS.
  code = code.replace(/^if \(typeof module !== 'undefined'.*$/gm, '');
  return `/* ===== ${f} ${'='.repeat(Math.max(0, 66 - f.length))} */\n${code}`;
})).join('\n\n');

// A literal </script> anywhere in a string would close the tag early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const out = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => safeJs);

const dest = path.resolve(process.argv[2] || path.join(__dirname, 'index.html'));
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf8');

if (path.dirname(dest) !== __dirname) {
  ['config.js', 'manifest.webmanifest', 'sw.js'].forEach(name =>
    fs.copyFileSync(path.join(__dirname, name), path.join(path.dirname(dest), name)));
  fs.cpSync(path.join(__dirname, 'icons'), path.join(path.dirname(dest), 'icons'), { recursive: true });
}

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
console.log(`Built ${dest}`);
console.log(`  ${ORDER.length} modules · ${kb} KB · zero runtime network dependencies`);
