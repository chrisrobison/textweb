#!/usr/bin/env node

/**
 * TextWeb MCP Server
 * 
 * Model Context Protocol server that gives any MCP client
 * (Claude Desktop, Cursor, Windsurf, Cline, OpenClaw, etc.)
 * text-based web browsing capabilities.
 * 
 * Communicates over stdio using JSON-RPC 2.0.
 */

const { AgentBrowser } = require('../src/browser');

const SERVER_INFO = {
  name: 'textweb',
  version: '0.1.0',
};

const TOOLS = [
  {
    name: 'textweb_navigate',
    description: 'Navigate to a URL and render the page as a structured text grid. Interactive elements are annotated with [ref] numbers for clicking/typing. Returns the text grid view, element map, and page metadata. Use this as your primary way to view web pages — no screenshots or vision model needed.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
        cols: { type: 'number', description: 'Grid width in characters (default: 120)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'textweb_click',
    description: 'Click an interactive element by its reference number. Returns the updated text grid after the click (page may navigate or update).',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'number', description: 'Element reference number from the text grid (e.g., 3 for [3])' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'textweb_type',
    description: 'Type text into an input field by its reference number. Clears existing content and types the new text. Returns the updated text grid.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'number', description: 'Element reference number of the input field' },
        text: { type: 'string', description: 'Text to type into the field' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'textweb_select',
    description: 'Select an option from a dropdown/select element by its reference number.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'number', description: 'Element reference number of the select/dropdown' },
        value: { type: 'string', description: 'Value or visible text of the option to select' },
      },
      required: ['ref', 'value'],
    },
  },
  {
    name: 'textweb_scroll',
    description: 'Scroll the page up or down. Returns the updated text grid showing the new viewport position.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Number of pages to scroll (default: 1)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'textweb_snapshot',
    description: 'Re-render the current page as a text grid without navigating. Useful after waiting for dynamic content to load.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'textweb_press',
    description: 'Press a keyboard key (e.g., Enter, Tab, Escape, ArrowDown). Returns the updated text grid.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g., "Enter", "Tab", "Escape", "ArrowDown")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'textweb_upload',
    description: 'Upload a file to a file input element by its reference number.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'number', description: 'Element reference number of the file input' },
        path: { type: 'string', description: 'Absolute path to the file to upload' },
      },
      required: ['ref', 'path'],
    },
  },
];

// ─── Browser Instance ────────────────────────────────────────────────────────

let browser = null;

async function getBrowser(cols) {
  if (!browser) {
    browser = new AgentBrowser({ cols: cols || 120, headless: true });
    await browser.launch();
  }
  return browser;
}

function formatResult(result) {
  const refs = Object.entries(result.elements || {})
    .map(([ref, el]) => `[${ref}] ${el.semantic}: ${el.text || '(no text)'}`)
    .join('\n');

  return `URL: ${result.meta?.url || 'unknown'}\nTitle: ${result.meta?.title || 'unknown'}\nRefs: ${result.meta?.totalRefs || 0}\n\n${result.view}\n\nInteractive elements:\n${refs}`;
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

async function executeTool(name, args) {
  const b = await getBrowser(args.cols);

  switch (name) {
    case 'textweb_navigate': {
      const result = await b.navigate(args.url);
      return formatResult(result);
    }
    case 'textweb_click': {
      const result = await b.click(args.ref);
      return formatResult(result);
    }
    case 'textweb_type': {
      const result = await b.type(args.ref, args.text);
      return formatResult(result);
    }
    case 'textweb_select': {
      const result = await b.select(args.ref, args.value);
      return formatResult(result);
    }
    case 'textweb_scroll': {
      const result = await b.scroll(args.direction, args.amount || 1);
      return formatResult(result);
    }
    case 'textweb_snapshot': {
      const result = await b.snapshot();
      return formatResult(result);
    }
    case 'textweb_press': {
      const result = await b.press(args.key);
      return formatResult(result);
    }
    case 'textweb_upload': {
      const result = await b.upload(args.ref, args.path);
      return formatResult(result);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC / MCP Protocol ────────────────────────────────────────────────

function jsonrpc(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return jsonrpc(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case 'notifications/initialized':
      return null; // No response needed

    case 'tools/list':
      return jsonrpc(id, { tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const text = await executeTool(name, args || {});
        return jsonrpc(id, {
          content: [{ type: 'text', text }],
        });
      } catch (err) {
        return jsonrpc(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    case 'ping':
      return jsonrpc(id, {});

    default:
      if (id) return jsonrpcError(id, -32601, `Method not found: ${method}`);
      return null;
  }
}

// ─── stdio Transport ─────────────────────────────────────────────────────────

function main() {
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    
    // Process complete lines (newline-delimited JSON)
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        const response = await handleMessage(msg);
        if (response) {
          process.stdout.write(response + '\n');
        }
      } catch (err) {
        // Parse error
        process.stdout.write(
          jsonrpcError(null, -32700, `Parse error: ${err.message}`) + '\n'
        );
      }
    }
  });

  process.stdin.on('end', async () => {
    if (browser) await browser.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    if (browser) await browser.close();
    process.exit(0);
  });
}

main();
