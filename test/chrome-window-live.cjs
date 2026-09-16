const http = require('node:http');
const { discover, openProfile, closeWindow } = require('../src/chrome.cjs');

async function run() {
  const title = 'Antigravity OAuth 0123456789abcdef';
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>${title}</title><p>Window close test</p>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const found = discover();
    if (!found.executable || !found.profiles.length) throw new Error('Chrome was not found.');
    openProfile(found.executable, found.profiles[0].directory, `http://127.0.0.1:${server.address().port}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!await closeWindow(title)) throw new Error('The test Chrome window was not found or closed.');
    process.stdout.write('Chrome app window opened and closed successfully.\n');
  } finally { server.closeAllConnections(); server.close(); }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
