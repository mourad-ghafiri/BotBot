/**
 * Browser skill — Playwright-based browser automation.
 * Standalone module: class with methods matching tool names.
 *
 * Modes:
 *   "cdp"     — Launch system Chrome with persistent profile, connect via CDP.
 *               Anti-detection flags, persistent cookies/storage across runs.
 *   "default" — Use Playwright's bundled Chromium (ephemeral, no persistence).
 *
 * Pages persist between agent runs (not closed on session cleanup or browser_close).
 */

let playwright;
try { playwright = require('playwright'); } catch {}

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const DEFAULT_SESSION = '__default__';

function findChromePath() {
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  if (process.platform === 'linux') {
    const names = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'];
    for (const name of names) {
      try {
        const result = execSync(`which ${name}`, { encoding: 'utf8' }).trim();
        if (result) return result;
      } catch {}
    }
    return null;
  }

  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

class BrowserSkill {
  constructor(config = {}) {
    this._config = config;
    this._mode = config.mode || 'default';  // "cdp" | "default"
    this._browser = null;
    this._defaultContext = null;
    this._chromeProcess = null;
    this._sessions = new Map(); // correlationId -> { pages, currentPageIndex }
    this._workDir = config.workspace || process.cwd();
  }

  _healthCheck() {
    if (!playwright) throw new Error('playwright not installed — browser skill unavailable');
    if (this._mode === 'cdp' && !findChromePath()) {
      throw new Error('Chrome/Chromium not found — browser skill unavailable (mode=cdp)');
    }
  }

  _sessionKey(args) {
    return (args && args._correlationId) || DEFAULT_SESSION;
  }

  _getSession(args) {
    return this._sessions.get(this._sessionKey(args)) || null;
  }

  _getPage(args) {
    const session = this._getSession(args);
    if (!session) return null;
    return session.pages[session.currentPageIndex] || null;
  }

  // ── Profile path — always derived from workspace, never a config param ──

  _profilePath() {
    return path.join(this._workDir, 'browser_profile');
  }

  // ── Launch modes ──────────────────────────────────────────────────────────

  async launch() {
    if (this._browser) return;

    if (this._mode === 'cdp') {
      await this._launchCDP();
    } else {
      await this._launchDefault();
    }
  }

  async _launchDefault() {
    if (!playwright) throw new Error('playwright not installed');
    this._browser = await playwright.chromium.launch({
      headless: this._config.headless !== false,
    });
    this._defaultContext = await this._browser.newContext();
  }

  async _launchCDP() {
    const chromePath = findChromePath();
    if (!chromePath) throw new Error('Chrome/Chromium not found on this system');

    const profilePath = this._profilePath();
    const debugPort = this._config.cdp_port || 9222;

    fs.mkdirSync(profilePath, { recursive: true });

    // Minimal flags — match a normal Chrome launch as closely as possible.
    // Automation-hiding flags (--disable-blink-features, --disable-infobars)
    // are themselves detectable fingerprints, so we omit them intentionally.
    const chromeArgs = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];

    if (this._config.headless !== false) {
      const windowSize = this._config.headless_window_size || '1920,1080';
      chromeArgs.push('--headless=new', `--window-size=${windowSize}`);
    }

    chromeArgs.push('about:blank');

    this._chromeProcess = spawn(chromePath, chromeArgs, {
      stdio: 'ignore',
      detached: false,
    });

    this._chromeProcess.on('error', (err) => {
      console.error(`Chrome process error: ${err.message}`);
    });

    const endpoint = `http://127.0.0.1:${debugPort}`;
    await this._waitForCDP(endpoint, 10000);

    this._browser = await playwright.chromium.connectOverCDP(endpoint);
    this._defaultContext = this._browser.contexts()[0];
  }

  /**
   * Connect to an already-running Chrome CDP endpoint (worker mode).
   * Only relevant for mode=cdp; for mode=default, falls back to launch().
   */
  async connect() {
    if (this._browser) return;

    if (this._mode !== 'cdp') {
      return this._launchDefault();
    }

    if (!playwright) throw new Error('playwright not installed');

    const debugPort = this._config.cdp_port || 9222;
    const endpoint = `http://127.0.0.1:${debugPort}`;

    await this._waitForCDP(endpoint, 10000);

    this._browser = await playwright.chromium.connectOverCDP(endpoint);
    this._defaultContext = this._browser.contexts()[0];
  }

  _waitForCDP(endpoint, timeoutMs) {
    const url = `${endpoint}/json/version`;
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Chrome CDP not ready after ${timeoutMs}ms`));
        }
        http.get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) resolve();
            else setTimeout(attempt, 200);
          });
        }).on('error', () => {
          setTimeout(attempt, 200);
        });
      };
      attempt();
    });
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────

  async shutdown() {
    // Close all pages in the context (bot shutdown — full cleanup)
    if (this._defaultContext) {
      for (const page of this._defaultContext.pages()) {
        await page.close().catch(() => {});
      }
    }
    this._sessions.clear();

    if (this._mode === 'cdp') {
      // Disconnect Playwright (don't use .close() — that sends CDP Browser.close)
      if (this._browser) {
        try { this._browser.disconnect(); } catch {}
      }
    } else {
      // Default mode — close the browser normally
      if (this._browser) {
        try { await this._browser.close(); } catch {}
      }
    }
    this._browser = null;
    this._defaultContext = null;

    // Kill Chrome process (CDP mode, main process only)
    if (this._chromeProcess) {
      const proc = this._chromeProcess;
      this._chromeProcess = null;

      try { proc.kill('SIGTERM'); } catch {}

      await new Promise((resolve) => {
        const forceKill = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
          resolve();
        }, 3000);
        proc.on('exit', () => {
          clearTimeout(forceKill);
          resolve();
        });
      });
    }
  }

  // ── Session management ────────────────────────────────────────────────────

  async _ensureBrowser(args) {
    if (!playwright) throw new Error('playwright not installed');
    if (!this._browser || !this._defaultContext) {
      throw new Error('Browser not launched — call launch() first');
    }

    const key = this._sessionKey(args);
    if (!this._sessions.has(key)) {
      // Adopt existing pages from the context (persistent browser model).
      // This lets follow-up agent runs reuse pages from previous runs.
      const existingPages = this._defaultContext.pages();
      if (existingPages.length > 0) {
        this._sessions.set(key, { pages: [...existingPages], currentPageIndex: existingPages.length - 1 });
      } else {
        const page = await this._defaultContext.newPage();
        this._sessions.set(key, { pages: [page], currentPageIndex: 0 });
      }
    }
  }

  cleanupSession(correlationId) {
    const key = correlationId || DEFAULT_SESSION;
    // Only unmap session tracking — pages stay alive in the context
    // so follow-up agent runs can reuse them (persistent browser model).
    this._sessions.delete(key);
  }

  // ── Tool handlers ─────────────────────────────────────────────────────────

  async browser_open(args) {
    await this._ensureBrowser(args);
    const page = this._getPage(args);
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    return `Navigated to: ${args.url}\nTitle: ${title}`;
  }

  async browser_click(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    await page.click(args.selector, { timeout: 10000 });
    return `Clicked: ${args.selector}`;
  }

  async browser_type(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    if (args.clear) await page.fill(args.selector, '');
    await page.fill(args.selector, args.text);
    return `Typed into: ${args.selector}`;
  }

  async browser_screenshot(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    if (!fs.existsSync(this._workDir)) fs.mkdirSync(this._workDir, { recursive: true });
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(this._workDir, filename);

    const opts = { path: filepath };
    if (args.selector) {
      const el = await page.$(args.selector);
      if (!el) return `Error: element not found: ${args.selector}`;
      await el.screenshot(opts);
    } else {
      opts.fullPage = args.full_page === true || args.full_page === 'true' || args.full_page === 'True';
      await page.screenshot(opts);
    }
    return `Screenshot saved: ${filepath}\n[NEW_FILES]\n${filepath}\n[/NEW_FILES]`;
  }

  async browser_content(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    if (args.selector) {
      const el = await page.$(args.selector);
      if (!el) return `Error: element not found: ${args.selector}`;
      return (await el.textContent()) || '(empty)';
    }
    const text = await page.evaluate(() => document.body.innerText);
    return (text || '(empty)').slice(0, 50000);
  }

  async browser_html(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    if (args.selector) {
      const el = await page.$(args.selector);
      if (!el) return `Error: element not found: ${args.selector}`;
      return (await el.innerHTML()).slice(0, 50000);
    }
    return (await page.content()).slice(0, 50000);
  }

  async browser_eval(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    const result = await page.evaluate(args.script);
    return JSON.stringify(result, null, 2) || '(undefined)';
  }

  async browser_scroll(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    const amount = args.amount || 500;
    const dir = args.direction || 'down';
    const scrollMap = { down: [0, amount], up: [0, -amount], right: [amount, 0], left: [-amount, 0] };
    const [x, y] = scrollMap[dir] || [0, amount];
    await page.evaluate(([dx, dy]) => window.scrollBy(dx, dy), [x, y]);
    return `Scrolled ${dir} by ${amount}px`;
  }

  async browser_wait(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    const state = args.state || 'visible';
    await page.waitForSelector(args.selector, { state, timeout: args.timeout || 30000 });
    return `Element ${args.selector} is ${state}`;
  }

  async browser_back(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    await page.goBack();
    return `Navigated back to: ${page.url()}`;
  }

  async browser_forward(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    await page.goForward();
    return `Navigated forward to: ${page.url()}`;
  }

  async browser_refresh(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    await page.reload();
    return 'Page refreshed';
  }

  async browser_url(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    return page.url();
  }

  async browser_title(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    return await page.title();
  }

  async browser_tabs(args) {
    const session = this._getSession(args);
    if (!session) return 'Error: no browser open.';
    return session.pages.map((p, i) => `[${i}] ${p.url()}`).join('\n');
  }

  async browser_newtab(args) {
    await this._ensureBrowser(args);
    const session = this._getSession(args);
    const page = await this._defaultContext.newPage();
    session.pages.push(page);
    session.currentPageIndex = session.pages.length - 1;
    if (args.url) await page.goto(args.url, { waitUntil: 'domcontentloaded' });
    return `New tab opened (index ${session.currentPageIndex})`;
  }

  async browser_closetab(args) {
    const session = this._getSession(args);
    if (!session) return 'Error: no browser open.';
    const idx = args.index ?? session.currentPageIndex;
    if (idx < 0 || idx >= session.pages.length) return 'Error: invalid tab index.';
    await session.pages[idx].close();
    session.pages.splice(idx, 1);
    if (session.currentPageIndex >= session.pages.length) session.currentPageIndex = Math.max(0, session.pages.length - 1);
    return `Tab ${idx} closed. ${session.pages.length} tabs remain.`;
  }

  async browser_select(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    await page.selectOption(args.selector, args.value || '');
    return `Selected: ${args.value} in ${args.selector}`;
  }

  async browser_hover(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    await page.hover(args.selector);
    return `Hovered: ${args.selector}`;
  }

  async browser_cookies(args) {
    if (!this._defaultContext) return 'Error: no browser open.';
    let cookies = await this._defaultContext.cookies();
    if (args.domain) cookies = cookies.filter((c) => c.domain.includes(args.domain));
    return JSON.stringify(cookies, null, 2);
  }

  async browser_setcookie(args) {
    if (!this._defaultContext) return 'Error: no browser open.';
    await this._defaultContext.addCookies([{
      name: args.name,
      value: args.value,
      domain: args.domain || 'localhost',
      path: args.path || '/',
    }]);
    return `Cookie set: ${args.name}`;
  }

  async browser_pdf(args) {
    const page = this._getPage(args);
    if (!page) return 'Error: no page open.';
    if (!fs.existsSync(this._workDir)) fs.mkdirSync(this._workDir, { recursive: true });
    const filepath = args.path || path.join(this._workDir, `page_${Date.now()}.pdf`);
    await page.pdf({ path: filepath });
    return `PDF saved: ${filepath}\n[NEW_FILES]\n${filepath}\n[/NEW_FILES]`;
  }

  async browser_close(args) {
    const key = this._sessionKey(args);
    // Unmap session tracking only — pages stay alive in the persistent context.
    // Use browser_closetab to close specific tabs.
    this._sessions.delete(key);
    return 'Browser session ended. Pages remain open for reuse.';
  }
}

module.exports = { BrowserSkill };

// CLI entry point
if (require.main === module) {
  const toolName = process.argv[2];
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  let config = {};
  if (process.env.SKILL_CONFIG) {
    try { config = JSON.parse(process.env.SKILL_CONFIG); } catch {}
  }
  const skill = new BrowserSkill(config);
  const handler = skill[toolName];
  if (!handler) { console.error(`Unknown tool: ${toolName}`); process.exit(1); }
  handler.call(skill, args).then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
}
