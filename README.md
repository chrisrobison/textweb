# TextWeb

**A text-grid web renderer for AI agents — see the web without screenshots.**

Instead of taking expensive screenshots and piping them through vision models, TextWeb renders web pages as structured text grids that LLMs can reason about natively. Full JavaScript execution, spatial layout preserved, interactive elements annotated.

## Why?

| Approach | Size | Requires | Speed | Spatial Layout |
|----------|------|----------|-------|----------------|
| Screenshot + Vision | ~1MB | Vision model ($$$) | Slow | Pixel-level |
| Accessibility Tree | ~5KB | Nothing | Fast | ❌ Lost |
| Raw HTML | ~100KB+ | Nothing | Fast | ❌ Lost |
| **TextWeb** | **~2-5KB** | **Nothing** | **Fast** | **✅ Preserved** |

## How It Works

```
┌─────────────────────────────────────────────┐
│  Agent API                                   │
│  navigate(url) → text grid + element map     │
│  click(ref) / type(ref, text) / scroll()     │
├─────────────────────────────────────────────┤
│  Text Grid Renderer                          │
│  Pixel positions → character grid            │
│  Interactive elements get [ref] annotations  │
├─────────────────────────────────────────────┤
│  Headless Chromium (via Playwright)          │
│  Full JS/CSS execution                       │
│  getBoundingClientRect() for all elements    │
└─────────────────────────────────────────────┘
```

The browser renders the page normally. TextWeb extracts every visible element's position, size, text, and interactivity — then maps it all onto a character grid. Interactive elements get reference numbers like `[0]`, `[1]` that agents can use to click, type, or select.

## Example Output

```
═══ HACKER NEWS ══════════════════════════════════════
[0]Hacker News  [1]new  [2]past  [3]comments  [4]ask  [5]show  [6]jobs  [7]submit

 1. [8]Show HN: TextWeb - text-grid browser for AI agents (github.com)
    142 points by chrisrobison 3 hours ago | [9]89 comments
 2. [10]Why LLMs don't need screenshots to browse the web
    87 points by somebody 5 hours ago | [11]34 comments
 3. [12]The future of agent-computer interfaces
    56 points by researcher 8 hours ago | [13]12 comments

[14:______________________] [15 Search]
```

~500 bytes. An LLM can read this, understand the layout, and say "click ref 8" to open the first link. No vision model needed.

## Install

```bash
npm install -g textweb
npx playwright install chromium
```

## CLI Usage

```bash
# Render a page
textweb https://news.ycombinator.com

# Interactive mode
textweb -i https://github.com
textweb> click 3
textweb> type 7 search query
textweb> scroll down
textweb> refs
textweb> quit

# JSON output (for piping to agents)
textweb -j https://example.com

# Custom grid size
textweb --cols 80 --rows 24 https://example.com
```

## HTTP API

```bash
# Start the server
textweb --serve 3000

# Navigate
curl -X POST http://localhost:3000/navigate \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'

# Click an element
curl -X POST http://localhost:3000/click \
  -d '{"ref": 3}'

# Type into an input
curl -X POST http://localhost:3000/type \
  -d '{"ref": 7, "text": "search query"}'

# Scroll
curl -X POST http://localhost:3000/scroll \
  -d '{"direction": "down"}'

# Get current state
curl http://localhost:3000/snapshot
```

## Programmatic Usage

```javascript
const { AgentBrowser } = require('textweb');

const browser = new AgentBrowser({ cols: 120, rows: 40 });

// Navigate and get the text grid
const { view, elements, meta } = await browser.navigate('https://example.com');

console.log(view);        // The text grid
console.log(elements);    // { 0: { selector, tag, text, href }, ... }
console.log(meta);        // { url, title, cols, rows, totalRefs }

// Interact
await browser.click(3);              // Click element [3]
await browser.type(7, 'hello');      // Type into element [7]
await browser.scroll('down');        // Scroll down
const snap = await browser.snapshot(); // Re-render

await browser.close();
```

## Grid Conventions

| Element | Rendering |
|---------|-----------|
| Headings | `═══ HEADING TEXT ═══════` |
| Links | `[ref]link text` |
| Buttons | `[ref button text]` |
| Text inputs | `[ref:placeholder____]` |
| Checkboxes | `[ref:X] Label` or `[ref: ] Label` |
| Radio buttons | `[ref:●] Label` or `[ref:○] Label` |
| Dropdowns | `[ref:▼ Selected]` |
| Separators | `────────────────` |
| List items | `• Item text` |

## Design Principles

1. **Text is native to LLMs** — no vision model middleman
2. **Spatial layout matters** — a flat list of elements loses the "where" that helps agents understand pages
3. **Cheap and fast** — 2-5KB per render vs 1MB+ screenshots
4. **Full web support** — real Chromium runs the JS, we just change how the output is represented
5. **Interactive** — reference numbers map to real DOM elements for clicking, typing, etc.

## License

MIT © Christopher Robison
