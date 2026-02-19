/**
 * TextWeb HTTP Server - REST API for web rendering and interaction
 */

const http = require('http');
const url = require('url');
const { AgentBrowser } = require('./browser');

class TextWebServer {
  constructor(options = {}) {
    this.options = {
      cols: options.cols || 100,
      rows: options.rows || 30,
      timeout: options.timeout || 30000,
      ...options
    };
    
    this.browser = null;
    this.lastActivity = Date.now();
    
    // Start cleanup timer (close browser after inactivity)
    setInterval(() => {
      if (this.browser && Date.now() - this.lastActivity > 300000) { // 5 minutes
        this.closeBrowser();
      }
    }, 60000); // Check every minute
  }

  /**
   * Initialize browser if not already initialized
   */
  async initBrowser() {
    if (!this.browser) {
      this.browser = new AgentBrowser({
        cols: this.options.cols,
        rows: this.options.rows,
        headless: true,
        timeout: this.options.timeout
      });
    }
    this.lastActivity = Date.now();
  }

  /**
   * Close browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Parse JSON body from request
   */
  parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Send JSON response
   */
  sendJSON(res, data, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    
    // Convert Map to Object for JSON serialization
    if (data.elements && data.elements instanceof Map) {
      const elementsObj = {};
      for (const [key, value] of data.elements) {
        elementsObj[key] = value;
      }
      data.elements = elementsObj;
    }
    
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response
   */
  sendError(res, message, status = 400) {
    this.sendJSON(res, { error: message }, status);
  }

  /**
   * Handle CORS preflight requests
   */
  handleOptions(res) {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
  }

  /**
   * Main request handler
   */
  async handleRequest(req, res) {
    const { pathname, query } = url.parse(req.url, true);
    const method = req.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return this.handleOptions(res);
    }

    try {
      switch (pathname) {
        case '/health':
          return this.handleHealth(req, res);
          
        case '/navigate':
          if (method === 'POST') {
            return await this.handleNavigate(req, res);
          }
          break;
          
        case '/click':
          if (method === 'POST') {
            return await this.handleClick(req, res);
          }
          break;
          
        case '/type':
          if (method === 'POST') {
            return await this.handleType(req, res);
          }
          break;
          
        case '/scroll':
          if (method === 'POST') {
            return await this.handleScroll(req, res);
          }
          break;
          
        case '/select':
          if (method === 'POST') {
            return await this.handleSelect(req, res);
          }
          break;

        case '/upload':
          if (method === 'POST') {
            return await this.handleUpload(req, res);
          }
          break;
          
        case '/snapshot':
          if (method === 'GET') {
            return await this.handleSnapshot(req, res);
          }
          break;
          
        case '/query':
          if (method === 'POST') {
            return await this.handleQuery(req, res);
          }
          break;
          
        case '/region':
          if (method === 'POST') {
            return await this.handleRegion(req, res);
          }
          break;
          
        case '/screenshot':
          if (method === 'POST') {
            return await this.handleScreenshot(req, res);
          }
          break;
          
        case '/close':
          if (method === 'POST') {
            return await this.handleClose(req, res);
          }
          break;
          
        default:
          this.sendError(res, 'Not found', 404);
          break;
      }
      
      this.sendError(res, `Method ${method} not allowed for ${pathname}`, 405);
      
    } catch (error) {
      console.error('Request error:', error);
      this.sendError(res, error.message, 500);
    }
  }

  /**
   * Health check endpoint
   */
  handleHealth(req, res) {
    this.sendJSON(res, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      browser: this.browser ? 'initialized' : 'not initialized',
      lastActivity: new Date(this.lastActivity).toISOString()
    });
  }

  /**
   * Navigate to URL
   */
  async handleNavigate(req, res) {
    const body = await this.parseBody(req);
    
    if (!body.url) {
      return this.sendError(res, 'URL is required');
    }
    
    await this.initBrowser();
    const result = await this.browser.navigate(body.url, body.options);
    
    this.sendJSON(res, {
      success: true,
      url: body.url,
      view: result.view,
      elements: result.elements,
      meta: result.meta
    });
  }

  /**
   * Click element
   */
  async handleClick(req, res) {
    const body = await this.parseBody(req);
    
    if (typeof body.ref !== 'number') {
      return this.sendError(res, 'Element reference (ref) is required');
    }
    
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const result = await this.browser.click(body.ref, body.options);
    
    this.sendJSON(res, {
      success: true,
      action: 'click',
      ref: body.ref,
      view: result.view,
      elements: result.elements,
      meta: result.meta
    });
  }

  /**
   * Type text into element
   */
  async handleType(req, res) {
    const body = await this.parseBody(req);
    
    if (typeof body.ref !== 'number') {
      return this.sendError(res, 'Element reference (ref) is required');
    }
    
    if (!body.text) {
      return this.sendError(res, 'Text is required');
    }
    
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const result = await this.browser.type(body.ref, body.text, body.options);
    
    this.sendJSON(res, {
      success: true,
      action: 'type',
      ref: body.ref,
      text: body.text,
      view: result.view,
      elements: result.elements,
      meta: result.meta
    });
  }

  /**
   * Scroll page
   */
  async handleScroll(req, res) {
    const body = await this.parseBody(req);
    
    const direction = body.direction || 'down';
    const amount = body.amount || 5;
    
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const result = await this.browser.scroll(direction, amount);
    
    this.sendJSON(res, {
      success: true,
      action: 'scroll',
      direction,
      amount,
      view: result.view,
      elements: result.elements,
      meta: result.meta
    });
  }

  /**
   * Select dropdown option
   */
  async handleSelect(req, res) {
    const body = await this.parseBody(req);
    
    if (typeof body.ref !== 'number') {
      return this.sendError(res, 'Element reference (ref) is required');
    }
    
    if (!body.value) {
      return this.sendError(res, 'Value is required');
    }
    
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const result = await this.browser.select(body.ref, body.value);
    
    this.sendJSON(res, {
      success: true,
      action: 'select',
      ref: body.ref,
      value: body.value,
      view: result.view,
      elements: result.elements,
      meta: result.meta
    });
  }

  async handleUpload(req, res) {
    const body = await this.parseBody(req);
    
    if (typeof body.ref !== 'number') {
      return this.sendError(res, 'Element reference (ref) is required');
    }
    if (!body.files) {
      return this.sendError(res, 'files (string or array of file paths) is required');
    }
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const result = await this.browser.upload(body.ref, body.files);
    
    this.sendJSON(res, {
      success: true,
      action: 'upload',
      ref: body.ref,
      view: result.view,
      elements: result.elements,
      meta: result.meta
    });
  }

  /**
   * Get current page snapshot
   */
  async handleSnapshot(req, res) {
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const result = await this.browser.snapshot();
    
    this.sendJSON(res, {
      success: true,
      action: 'snapshot',
      url: this.browser.getCurrentUrl(),
      view: result.view,
      elements: result.elements,
      meta: result.meta
    });
  }

  /**
   * Query elements by selector
   */
  async handleQuery(req, res) {
    const body = await this.parseBody(req);
    
    if (!body.selector) {
      return this.sendError(res, 'CSS selector is required');
    }
    
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const matches = await this.browser.query(body.selector);
    
    this.sendJSON(res, {
      success: true,
      action: 'query',
      selector: body.selector,
      matches
    });
  }

  /**
   * Read text from grid region
   */
  async handleRegion(req, res) {
    const body = await this.parseBody(req);
    
    const { r1, c1, r2, c2 } = body;
    
    if (typeof r1 !== 'number' || typeof c1 !== 'number' || 
        typeof r2 !== 'number' || typeof c2 !== 'number') {
      return this.sendError(res, 'Region coordinates (r1, c1, r2, c2) are required');
    }
    
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const text = this.browser.readRegion(r1, c1, r2, c2);
    
    this.sendJSON(res, {
      success: true,
      action: 'region',
      coordinates: { r1, c1, r2, c2 },
      text
    });
  }

  /**
   * Take screenshot
   */
  async handleScreenshot(req, res) {
    if (!this.browser) {
      return this.sendError(res, 'Browser not initialized. Navigate to a page first.');
    }
    
    const body = await this.parseBody(req);
    const screenshot = await this.browser.screenshot(body.options);
    
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(screenshot);
  }

  /**
   * Close browser
   */
  async handleClose(req, res) {
    await this.closeBrowser();
    
    this.sendJSON(res, {
      success: true,
      action: 'close',
      message: 'Browser closed'
    });
  }
}

/**
 * Create HTTP server instance
 */
function createServer(options = {}) {
  const server = new TextWebServer(options);
  
  return http.createServer((req, res) => {
    server.handleRequest(req, res).catch(error => {
      console.error('Server error:', error);
      if (!res.headersSent) {
        server.sendError(res, 'Internal server error', 500);
      }
    });
  });
}

module.exports = { createServer, TextWebServer };