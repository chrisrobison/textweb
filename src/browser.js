/**
 * AgentBrowser — the main interface for AI agents to browse the web
 */

const { chromium } = require('playwright');
const { render } = require('./renderer');

class AgentBrowser {
  constructor(options = {}) {
    this.cols = options.cols || 120;
    this.scrollY = 0;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.lastResult = null;
    this.headless = options.headless !== false;
    this.charH = 16; // default, updated after first render
  }

  async launch() {
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30000);
    return this;
  }

  async navigate(url) {
    if (!this.page) await this.launch();
    this.scrollY = 0;
    await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    return await this.snapshot();
  }

  async snapshot() {
    if (!this.page) throw new Error('No page open. Call navigate() first.');
    this.lastResult = await render(this.page, {
      cols: this.cols,
      scrollY: this.scrollY,
    });
    this.lastResult.meta.url = this.page.url();
    this.lastResult.meta.title = await this.page.title();
    // Cache measured charH for scrolling
    if (this.lastResult.meta.charH) this.charH = this.lastResult.meta.charH;
    return this.lastResult;
  }

  async click(ref) {
    const el = this._getElement(ref);
    await this.page.click(el.selector);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    return await this.snapshot();
  }

  async type(ref, text) {
    const el = this._getElement(ref);
    await this.page.click(el.selector);
    await this.page.fill(el.selector, text);
    return await this.snapshot();
  }

  async press(key) {
    await this.page.keyboard.press(key);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    return await this.snapshot();
  }

  async upload(ref, filePaths) {
    const el = this._getElement(ref);
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    await this.page.setInputFiles(el.selector, paths);
    return await this.snapshot();
  }

  async select(ref, value) {
    const el = this._getElement(ref);
    await this.page.selectOption(el.selector, value);
    return await this.snapshot();
  }

  async scroll(direction = 'down', amount = 1) {
    // Scroll by roughly one "page" worth of content
    const pageH = 40 * this.charH; // ~40 lines of content
    const delta = amount * pageH;
    if (direction === 'down') {
      this.scrollY += delta;
    } else if (direction === 'up') {
      this.scrollY = Math.max(0, this.scrollY - delta);
    } else if (direction === 'top') {
      this.scrollY = 0;
    }
    await this.page.evaluate((y) => window.scrollTo(0, y), this.scrollY);
    await this.page.waitForTimeout(500);
    return await this.snapshot();
  }

  async readRegion(r1, c1, r2, c2) {
    if (!this.lastResult) throw new Error('No snapshot. Navigate first.');
    const lines = this.lastResult.view.split('\n');
    const region = [];
    for (let r = r1; r <= Math.min(r2, lines.length - 1); r++) {
      region.push(lines[r].substring(c1, c2 + 1));
    }
    return region.join('\n');
  }

  async evaluate(fn) {
    return await this.page.evaluate(fn);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  _getElement(ref) {
    if (!this.lastResult) throw new Error('No snapshot. Navigate first.');
    const el = this.lastResult.elements[ref];
    if (!el) throw new Error(`Element ref [${ref}] not found. Available: ${Object.keys(this.lastResult.elements).join(', ')}`);
    return el;
  }
}

module.exports = { AgentBrowser };
