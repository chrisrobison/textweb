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
    // Use domcontentloaded + a short settle, not networkidle (SPAs never go idle)
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for network to settle or 3s max — whichever comes first
    await Promise.race([
      this.page.waitForLoadState('networkidle').catch(() => {}),
      new Promise(r => setTimeout(r, 3000)),
    ]);
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
    await this._settle();
    return await this.snapshot();
  }

  async type(ref, text) {
    const el = this._getElement(ref);
    await this.page.click(el.selector);
    await this.page.fill(el.selector, text);
    return await this.snapshot();
  }

  /**
   * Fill a field by CSS selector without re-rendering (faster for batch fills)
   */
  async fillBySelector(selector, text) {
    try {
      await this.page.click(selector, { timeout: 5000 });
      await this.page.fill(selector, text);
    } catch (e) {
      // Fallback: try typing character by character (for contenteditable, etc.)
      try {
        await this.page.click(selector, { timeout: 5000 });
        await this.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) { el.value = ''; el.textContent = ''; }
        }, selector);
        await this.page.type(selector, text, { delay: 10 });
      } catch (e2) {
        throw new Error(`Cannot fill ${selector}: ${e.message}`);
      }
    }
  }

  /**
   * Upload a file by CSS selector
   */
  async uploadBySelector(selector, filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    await this.page.setInputFiles(selector, paths);
  }

  async press(key) {
    await this.page.keyboard.press(key);
    await this._settle();
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

  /**
   * Get the current page URL
   */
  getCurrentUrl() {
    return this.page ? this.page.url() : null;
  }

  /**
   * Find elements matching a CSS selector
   * Returns array of {tag, text, selector, visible} objects
   */
  async query(selector) {
    if (!this.page) throw new Error('No page open. Call navigate() first.');
    return await this.page.evaluate((sel) => {
      const els = document.querySelectorAll(sel);
      return Array.from(els).map((el, i) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().substring(0, 200),
        selector: `${sel}:nth-child(${i + 1})`,
        visible: el.offsetParent !== null,
        href: el.href || null,
        value: el.value || null,
      }));
    }, selector);
  }

  /**
   * Take a screenshot (for debugging)
   * @param {object} options - Playwright screenshot options (path, fullPage, type, etc.)
   */
  async screenshot(options = {}) {
    if (!this.page) throw new Error('No page open. Call navigate() first.');
    return await this.page.screenshot({
      fullPage: true,
      type: 'png',
      ...options,
    });
  }

  /**
   * Wait for page to settle after an interaction.
   * Races networkidle against a short timeout to avoid hanging on SPAs.
   */
  async _settle() {
    await Promise.race([
      this.page.waitForLoadState('networkidle').catch(() => {}),
      new Promise(r => setTimeout(r, 3000)),
    ]);
  }

  _getElement(ref) {
    if (!this.lastResult) throw new Error('No snapshot. Navigate first.');
    const el = this.lastResult.elements[ref];
    if (!el) throw new Error(`Element ref [${ref}] not found. Available: ${Object.keys(this.lastResult.elements).join(', ')}`);
    return el;
  }
}

module.exports = { AgentBrowser };
