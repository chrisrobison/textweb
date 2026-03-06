/**
 * AgentBrowser — the main interface for AI agents to browse the web
 */

const { chromium } = require('playwright');

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    this.defaultTimeout = options.timeout || 30000;
    this.defaultRetries = options.retries ?? 2;
    this.defaultRetryDelayMs = options.retryDelayMs ?? 250;
  }

  async _withRetries(actionName, fn, options = {}) {
    const retries = options.retries ?? this.defaultRetries;
    const retryDelayMs = options.retryDelayMs ?? this.defaultRetryDelayMs;

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt >= retries) break;
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }

    throw new Error(`${actionName} failed after ${retries + 1} attempt(s): ${lastError?.message || 'unknown error'}`);
  }

  _contextOptions(storageStatePath = null) {
    const opts = {
      viewport: DEFAULT_VIEWPORT,
      userAgent: DEFAULT_USER_AGENT,
    };
    if (storageStatePath) {
      opts.storageState = storageStatePath;
    }
    return opts;
  }

  async _createContext(storageStatePath = null) {
    this.context = await this.browser.newContext(this._contextOptions(storageStatePath));
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.defaultTimeout);
  }

  async launch(options = {}) {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }

    if (!this.context) {
      await this._createContext(options.storageStatePath || null);
    }

    return this;
  }

  async navigate(url, options = {}) {
    if (!this.page) await this.launch();
    this.scrollY = 0;

    await this._withRetries('navigate', async () => {
      // Use domcontentloaded + a short settle, not networkidle (SPAs never go idle)
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs || this.defaultTimeout });
      // Wait for network to settle or 3s max — whichever comes first
      await Promise.race([
        this.page.waitForLoadState('networkidle').catch(() => {}),
        new Promise(r => setTimeout(r, 3000)),
      ]);
    }, options);

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

  async click(ref, options = {}) {
    const el = this._getElement(ref);
    await this._withRetries(`click ref=${ref}`, async () => {
      await this.page.click(el.selector);
      await this._settle();
    }, options);
    return await this.snapshot();
  }

  async type(ref, text, options = {}) {
    const el = this._getElement(ref);
    await this._withRetries(`type ref=${ref}`, async () => {
      await this.page.click(el.selector);
      await this.page.fill(el.selector, text);
    }, options);
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

  async press(key, options = {}) {
    await this._withRetries(`press key=${key}`, async () => {
      await this.page.keyboard.press(key);
      await this._settle();
    }, options);
    return await this.snapshot();
  }

  async upload(ref, filePaths, options = {}) {
    const el = this._getElement(ref);
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    await this._withRetries(`upload ref=${ref}`, async () => {
      await this.page.setInputFiles(el.selector, paths);
    }, options);
    return await this.snapshot();
  }

  async select(ref, value, options = {}) {
    const el = this._getElement(ref);
    await this._withRetries(`select ref=${ref}`, async () => {
      await this.page.selectOption(el.selector, value);
    }, options);
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

  async evaluate(fn, arg) {
    return await this.page.evaluate(fn, arg);
  }

  /**
   * Save cookies/localStorage/sessionStorage state to disk
   */
  async saveStorageState(path) {
    if (!this.context) throw new Error('No browser context open.');
    await this.context.storageState({ path });
    return { saved: true, path };
  }

  /**
   * Load cookies/localStorage/sessionStorage state from disk into a fresh context
   */
  async loadStorageState(path) {
    if (!this.browser) {
      await this.launch();
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }

    await this._createContext(path);
    this.scrollY = 0;
    this.lastResult = null;
    return { loaded: true, path };
  }

  /**
   * Wait until one or more conditions are true, then return a fresh snapshot.
   * Supported conditions: selector, text, urlIncludes.
   */
  async waitFor(options = {}) {
    if (!this.page) throw new Error('No page open. Call navigate() first.');

    const timeout = options.timeoutMs || this.defaultTimeout;
    const pollMs = options.pollMs || 100;

    await this._withRetries('waitFor', async () => {
      const waits = [];

      if (options.selector) {
        waits.push(
          this.page.waitForSelector(options.selector, {
            state: options.state || 'visible',
            timeout,
          })
        );
      }

      if (options.text) {
        waits.push(
          this.page.waitForFunction(
            (text) => document.body && document.body.innerText.includes(text),
            options.text,
            { timeout, polling: pollMs }
          )
        );
      }

      if (options.urlIncludes) {
        waits.push(
          this.page.waitForFunction(
            (needle) => window.location.href.includes(needle),
            options.urlIncludes,
            { timeout, polling: pollMs }
          )
        );
      }

      if (!waits.length) {
        await this.page.waitForTimeout(timeout);
      } else {
        await Promise.all(waits);
      }
    }, options);

    await this._settle();
    return await this.snapshot();
  }

  /**
   * Assert a field's value/text by ref.
   * comparator: equals | includes | regex | not_empty
   */
  async assertField(ref, expected, options = {}) {
    if (!this.page) throw new Error('No page open. Call navigate() first.');
    const el = this._getElement(ref);
    const comparator = options.comparator || 'equals';
    const attribute = options.attribute || null;

    const actual = await this.page.evaluate(({ selector, attributeName }) => {
      const target = document.querySelector(selector);
      if (!target) return null;

      if (attributeName) {
        return target.getAttribute(attributeName);
      }

      const tag = (target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return target.value ?? '';
      }
      return (target.textContent || '').trim();
    }, { selector: el.selector, attributeName: attribute });

    let pass = false;
    const actualStr = actual == null ? '' : String(actual);
    const expectedStr = expected == null ? '' : String(expected);

    switch (comparator) {
      case 'equals':
        pass = actualStr === expectedStr;
        break;
      case 'includes':
        pass = actualStr.includes(expectedStr);
        break;
      case 'regex': {
        const re = new RegExp(expectedStr);
        pass = re.test(actualStr);
        break;
      }
      case 'not_empty':
        pass = actualStr.trim().length > 0;
        break;
      default:
        throw new Error(`Unknown comparator: ${comparator}`);
    }

    return {
      pass,
      ref,
      selector: el.selector,
      comparator,
      expected: expectedStr,
      actual: actualStr,
    };
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
