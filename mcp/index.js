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
  version: '0.2.2',
};

const SESSION_NOTE = 'Optional session_id to isolate state across flows. Defaults to "default".';

const TOOLS = [
  {
    name: 'textweb_navigate',
    description: 'Navigate to a URL and render the page as a structured text grid. Interactive elements are annotated with [ref] numbers for clicking/typing. Returns the text grid view, element map, and page metadata. Use this as your primary way to view web pages — no screenshots or vision model needed.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
        cols: { type: 'number', description: 'Grid width in characters (default: 120)' },
        session_id: { type: 'string', description: SESSION_NOTE },
        retries: { type: 'number', description: 'Retry attempts for flaky transitions' },
        retry_delay_ms: { type: 'number', description: 'Delay between retries in ms' },
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
        session_id: { type: 'string', description: SESSION_NOTE },
        retries: { type: 'number', description: 'Retry attempts for flaky transitions' },
        retry_delay_ms: { type: 'number', description: 'Delay between retries in ms' },
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
        session_id: { type: 'string', description: SESSION_NOTE },
        retries: { type: 'number', description: 'Retry attempts for flaky transitions' },
        retry_delay_ms: { type: 'number', description: 'Delay between retries in ms' },
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
        session_id: { type: 'string', description: SESSION_NOTE },
        retries: { type: 'number', description: 'Retry attempts for flaky transitions' },
        retry_delay_ms: { type: 'number', description: 'Delay between retries in ms' },
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
        session_id: { type: 'string', description: SESSION_NOTE },
      },
      required: ['direction'],
    },
  },
  {
    name: 'textweb_snapshot',
    description: 'Re-render the current page as a text grid without navigating. Useful after waiting for dynamic content to load.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: SESSION_NOTE },
      },
    },
  },
  {
    name: 'textweb_press',
    description: 'Press a keyboard key (e.g., Enter, Tab, Escape, ArrowDown). Returns the updated text grid.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g., "Enter", "Tab", "Escape", "ArrowDown")' },
        session_id: { type: 'string', description: SESSION_NOTE },
        retries: { type: 'number', description: 'Retry attempts for flaky transitions' },
        retry_delay_ms: { type: 'number', description: 'Delay between retries in ms' },
      },
      required: ['key'],
    },
  },
  {
    name: 'textweb_session_list',
    description: 'List active textweb sessions and basic metadata (url, age).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'textweb_session_close',
    description: 'Close one session by session_id, or all sessions when all=true.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session id to close (default: default)' },
        all: { type: 'boolean', description: 'Close all active sessions' },
      },
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
        session_id: { type: 'string', description: SESSION_NOTE },
        retries: { type: 'number', description: 'Retry attempts for flaky transitions' },
        retry_delay_ms: { type: 'number', description: 'Delay between retries in ms' },
      },
      required: ['ref', 'path'],
    },
  },
  {
    name: 'textweb_storage_save',
    description: 'Save current browser storage state (cookies/localStorage/sessionStorage) to disk for later restore.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to write storage state JSON' },
        session_id: { type: 'string', description: SESSION_NOTE },
      },
      required: ['path'],
    },
  },
  {
    name: 'textweb_storage_load',
    description: 'Load storage state from disk into a fresh browser context.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of previously saved storage state JSON' },
        cols: { type: 'number', description: 'Grid width in characters (default: 120)' },
        session_id: { type: 'string', description: SESSION_NOTE },
      },
      required: ['path'],
    },
  },
  {
    name: 'textweb_wait_for',
    description: 'Wait for UI state in multi-step flows. Supports selector, text, and url_includes checks.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector that must appear (or match state)' },
        text: { type: 'string', description: 'Text that must appear in page body' },
        url_includes: { type: 'string', description: 'Substring that must appear in current URL' },
        state: { type: 'string', enum: ['attached', 'detached', 'visible', 'hidden'], description: 'Selector wait state (default: visible)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        poll_ms: { type: 'number', description: 'Polling interval for text/url waits (default: 100)' },
        retries: { type: 'number', description: 'Retry attempts for flaky transitions' },
        retry_delay_ms: { type: 'number', description: 'Delay between retries in ms' },
        session_id: { type: 'string', description: SESSION_NOTE },
      },
    },
  },
  {
    name: 'textweb_assert_field',
    description: 'Assert a field value/text by element ref. Useful in multi-step forms before submitting.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'number', description: 'Element reference number from current snapshot' },
        expected: { type: 'string', description: 'Expected value/content' },
        comparator: { type: 'string', enum: ['equals', 'includes', 'regex', 'not_empty'], description: 'Comparison mode (default: equals)' },
        attribute: { type: 'string', description: 'Optional DOM attribute name to validate (e.g., aria-invalid)' },
        session_id: { type: 'string', description: SESSION_NOTE },
      },
      required: ['ref', 'expected'],
    },
  },
];

// ─── Browser Sessions ───────────────────────────────────────────────────────

/** @type {Map<string, AgentBrowser>} */
const sessions = new Map();

function resolveSessionId(args = {}) {
  return (args.session_id || 'default').trim() || 'default';
}

async function getBrowser(args = {}) {
  const sessionId = resolveSessionId(args);
  let browser = sessions.get(sessionId);

  if (!browser) {
    browser = new AgentBrowser({ cols: args.cols || 120, headless: true });
    await browser.launch();
    sessions.set(sessionId, browser);
  }

  return { browser, sessionId };
}

function formatResult(result) {
  const refs = Object.entries(result.elements || {})
    .map(([ref, el]) => `[${ref}] ${el.semantic}: ${el.text || '(no text)'}`)
    .join('\n');

  return `URL: ${result.meta?.url || 'unknown'}\nTitle: ${result.meta?.title || 'unknown'}\nRefs: ${result.meta?.totalRefs || 0}\n\n${result.view}\n\nInteractive elements:\n${refs}`;
}

function retryOptions(args = {}) {
  return {
    retries: args.retries,
    retryDelayMs: args.retry_delay_ms,
  };
}

async function listSessions() {
  const out = [];
  for (const [sessionId, browser] of sessions.entries()) {
    out.push({
      session_id: sessionId,
      url: browser.getCurrentUrl() || null,
      initialized: Boolean(browser.page),
      refs: browser.lastResult?.meta?.totalRefs ?? null,
    });
  }
  return out;
}

async function closeSession({ session_id, all } = {}) {
  if (all) {
    const closed = [];
    for (const [sid, browser] of sessions.entries()) {
      await browser.close();
      closed.push(sid);
    }
    sessions.clear();
    return { closed };
  }

  const sid = (session_id || 'default').trim() || 'default';
  const browser = sessions.get(sid);
  if (!browser) {
    return { closed: [], missing: [sid] };
  }

  await browser.close();
  sessions.delete(sid);
  return { closed: [sid] };
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

async function executeTool(name, args = {}) {
  if (name === 'textweb_session_list') {
    const active = await listSessions();
    return JSON.stringify({ count: active.length, sessions: active }, null, 2);
  }

  if (name === 'textweb_session_close') {
    const out = await closeSession({ session_id: args.session_id, all: args.all });
    return JSON.stringify(out, null, 2);
  }

  const { browser: b, sessionId } = await getBrowser(args);

  switch (name) {
    case 'textweb_navigate': {
      const result = await b.navigate(args.url, retryOptions(args));
      return formatResult(result);
    }
    case 'textweb_click': {
      const result = await b.click(args.ref, retryOptions(args));
      return formatResult(result);
    }
    case 'textweb_type': {
      const result = await b.type(args.ref, args.text, retryOptions(args));
      return formatResult(result);
    }
    case 'textweb_select': {
      const result = await b.select(args.ref, args.value, retryOptions(args));
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
      const result = await b.press(args.key, retryOptions(args));
      return formatResult(result);
    }
    case 'textweb_upload': {
      const result = await b.upload(args.ref, args.path, retryOptions(args));
      return formatResult(result);
    }
    case 'textweb_storage_save': {
      const out = await b.saveStorageState(args.path);
      return `Saved storage state for session "${sessionId}" to ${out.path}`;
    }
    case 'textweb_storage_load': {
      const out = await b.loadStorageState(args.path);
      return `Loaded storage state for session "${sessionId}" from ${out.path}`;
    }
    case 'textweb_wait_for': {
      const result = await b.waitFor({
        selector: args.selector,
        text: args.text,
        urlIncludes: args.url_includes,
        timeoutMs: args.timeout_ms,
        pollMs: args.poll_ms,
        state: args.state,
        ...retryOptions(args),
      });
      return formatResult(result);
    }
    case 'textweb_assert_field': {
      const out = await b.assertField(args.ref, args.expected, {
        comparator: args.comparator,
        attribute: args.attribute,
      });
      return `ASSERT ${out.pass ? 'PASS' : 'FAIL'} | ref=${out.ref} | comparator=${out.comparator} | expected="${out.expected}" | actual="${out.actual}" | selector=${out.selector}`;
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
    for (const [, browser] of sessions) {
      await browser.close();
    }
    sessions.clear();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    for (const [, browser] of sessions) {
      await browser.close();
    }
    sessions.clear();
    process.exit(0);
  });
}

main();
