/**
 * Browser E2E: navigation module hide toggle on local GitHub Pages build.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = resolve(root, 'site');
const basePath = '/genospace';

function resolveFile(urlPath) {
  const rel = urlPath.startsWith(basePath) ? urlPath.slice(basePath.length) : urlPath;
  const clean = rel.replace(/^\//, '');
  const file = join(siteDir, clean);
  if (clean && existsSync(file) && statSync(file).isFile()) return file;
  return join(siteDir, 'index.html');
}

function startStaticServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const urlPath = req.url?.split('?')[0] || '/';
      const file = resolveFile(urlPath);
      const ext = file.slice(file.lastIndexOf('.'));
      const types = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.webmanifest': 'application/manifest+json',
        '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.listen(0, () => resolvePromise({ server, port: server.address().port }));
  });
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const { server, port } = await startStaticServer();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('CONSOLE:', msg.text());
    });

    await page.goto(`${origin}${basePath}/setup`, { waitUntil: 'networkidle0', timeout: 60000 });

    if (await page.$('#setup-form')) {
      await page.type('#username', 'admin');
      await page.type('#display_name', 'Admin');
      await page.type('#password', 'password123');
      await page.type('#confirm_password', 'password123');
      await page.click('#setup-btn');
      await wait(3000);
    } else if (await page.$('#login-form, form.login-form')) {
      await page.type('#username', 'admin');
      await page.type('#password', 'password123');
      await page.click('button[type="submit"]');
      await wait(3000);
    }

    await page.goto(`${origin}${basePath}/settings/personal/navigation`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    console.log('URL after nav:', page.url());
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
    console.log('Body snippet:', bodySnippet);

    await page.waitForSelector('#module-toggles', { timeout: 20000 });
    await page.waitForSelector('[data-built-in-module-toggle="calendar"]', { timeout: 10000 });

    const before = await page.$eval('[data-built-in-module-toggle="calendar"]', (el) => el.checked);
    console.log('calendar checked before:', before);

    if (before) {
      await page.click('[data-built-in-module-toggle="calendar"]');
      await wait(2500);
    }

    const stored = await page.evaluate(async (base) => {
      const mod = await import(`${base}/api.js`);
      const res = await mod.api.get('/preferences');
      return res?.data?.disabled_modules;
    }, basePath);

    const afterChecked = await page.$eval('[data-built-in-module-toggle="calendar"]', (el) => el.checked);
    const statusText = await page.$eval(
      '[data-built-in-module-toggle="calendar"]',
      (el) => el.closest('.settings-module-row')?.querySelector('.settings-module-status')?.textContent?.trim(),
    );

    console.log('disabled_modules from API:', JSON.stringify(stored));
    console.log('calendar checked after:', afterChecked);
    console.log('status badge:', statusText);

    const navHasCalendar = await page.evaluate(() => {
      return [...document.querySelectorAll('.nav-sidebar a[data-route], .nav-sidebar a[href]')]
        .some((a) => (a.getAttribute('href') || a.dataset.route || '').includes('calendar'));
    });
    console.log('sidebar has calendar:', navHasCalendar);

    assert.ok(Array.isArray(stored), 'expected disabled_modules array from API');
    assert.ok(stored.includes('calendar'), `calendar missing from disabled_modules: ${JSON.stringify(stored)}`);
    assert.equal(afterChecked, false, 'toggle should remain unchecked after save+rerender');
    assert.equal(navHasCalendar, false, 'sidebar should hide calendar when disabled');

    console.log('E2E PASS');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error('E2E FAIL:', err.stack || err);
  process.exit(1);
});
