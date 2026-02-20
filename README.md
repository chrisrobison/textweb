# TextWeb

**A text-grid web renderer for AI agents — see the web without screenshots.**

Instead of taking expensive screenshots and piping them through vision models, TextWeb renders web pages as structured text grids that LLMs can reason about natively. Full JavaScript execution, spatial layout preserved, interactive elements annotated.

📄 [Documentation](https://chrisrobison.github.io/textweb) · 📦 [npm](https://www.npmjs.com/package/textweb) · 🐙 [GitHub](https://github.com/chrisrobison/textweb)

## Why?

| Approach | Size | Requires | Speed | Spatial Layout |
|----------|------|----------|-------|----------------|
| Screenshot + Vision | ~1MB | Vision model ($$$) | Slow | Pixel-level |
| Accessibility Tree | ~5KB | Nothing | Fast | ❌ Lost |
| Raw HTML | ~100KB+ | Nothing | Fast | ❌ Lost |
| **TextWeb** | **~2-5KB** | **Nothing** | **Fast** | **✅ Preserved** |

## Quick Start

```bash
npm install -g textweb
npx playwright install chromium
```

```bash
# Render any page
textweb https://news.ycombinator.com

# Interactive mode
textweb --interactive https://github.com

# JSON output for agents
textweb --json https://example.com
```

## Example Output

```
[0]Hacker News [1]new | [2]past | [3]comments | [4]ask | [5]show | [6]jobs | [7]submit      [8]login

 1. [9]Show HN: TextWeb – text-grid browser for AI agents (github.com)
    142 points by chrisrobison 3 hours ago | [10]89 comments
 2. [11]Why LLMs don't need screenshots to browse the web
    87 points by somebody 5 hours ago | [12]34 comments

[13:______________________] [14 Search]
```

~500 bytes. An LLM can read this, understand the layout, and say "click ref 9" to open the first link. No vision model needed.

## Integration Options

TextWeb works with any AI agent framework. Pick your integration:

### 🔌 MCP Server (Claude Desktop, Cursor, Windsurf, Cline, OpenClaw)

The fastest way to add web browsing to any MCP-compatible client.

```bash
# Install globally
npm install -g textweb

# Or run directly
npx textweb-mcp
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "textweb": {
      "command": "textweb-mcp"
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "textweb": {
      "command": "textweb-mcp"
    }
  }
}
```

**OpenClaw** — add to `openclaw.json` skills or MCP config.

Then just ask: *"Go to hacker news and find posts about AI"* — the agent uses text grids instead of screenshots.

### 🛠️ OpenAI / Anthropic Function Calling

Drop-in tool definitions for any function-calling model. See [`tools/tool_definitions.json`](tools/tool_definitions.json).

Pair with the [system prompt](tools/system_prompt.md) to teach the model how to read the grid:

```python
import json

# Load tool definitions
with open("tools/tool_definitions.json") as f:
    textweb_tools = json.load(f)["tools"]

# Load system prompt
with open("tools/system_prompt.md") as f:
    system_prompt = f.read()

# Use with OpenAI
response = openai.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "Go to example.com and click the first link"},
    ],
    tools=textweb_tools,
)
```

### 🦜 LangChain

```python
from tools.langchain import get_textweb_tools

# Start the server first: textweb --serve 3000
tools = get_textweb_tools(base_url="http://localhost:3000")

# Use with any LangChain agent
from langchain.agents import initialize_agent
agent = initialize_agent(tools, llm, agent="zero-shot-react-description")
agent.run("Find the top story on Hacker News")
```

### 🚢 CrewAI

```python
from tools.crewai import TextWebBrowseTool, TextWebClickTool, TextWebTypeTool

# Start the server first: textweb --serve 3000
researcher = Agent(
    role="Web Researcher",
    tools=[TextWebBrowseTool(), TextWebClickTool(), TextWebTypeTool()],
    llm=llm,
)
```

### 🌐 HTTP API

```bash
# Start the server
textweb --serve 3000

# Navigate
curl -X POST http://localhost:3000/navigate \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'

# Click, type, scroll
curl -X POST http://localhost:3000/click -d '{"ref": 3}'
curl -X POST http://localhost:3000/type -d '{"ref": 7, "text": "hello"}'
curl -X POST http://localhost:3000/scroll -d '{"direction": "down"}'
```

### 📦 Node.js Library

```javascript
const { AgentBrowser } = require('textweb');

const browser = new AgentBrowser({ cols: 120 });
const { view, elements, meta } = await browser.navigate('https://example.com');

console.log(view);        // The text grid
console.log(elements);    // { 0: { selector, tag, text, href }, ... }
console.log(meta.stats);  // { totalElements, interactiveElements, renderMs }

await browser.click(3);              // Click element [3]
await browser.type(7, 'hello');      // Type into element [7]
await browser.scroll('down');        // Scroll down
await browser.query('nav a');        // Find elements by CSS selector
await browser.screenshot();          // PNG buffer (for debugging)
console.log(browser.getCurrentUrl());// Current page URL
await browser.close();
```

## Grid Conventions

| Element | Rendering | Interaction |
|---------|-----------|-------------|
| Links | `[ref]link text` | `click(ref)` |
| Buttons | `[ref button text]` | `click(ref)` |
| Text inputs | `[ref:placeholder____]` | `type(ref, "text")` |
| Checkboxes | `[ref:X]` / `[ref: ]` | `click(ref)` to toggle |
| Radio buttons | `[ref:●]` / `[ref:○]` | `click(ref)` |
| Dropdowns | `[ref:▼ Selected]` | `select(ref, "value")` |
| File inputs | `[ref:📎 Choose file]` | `upload(ref, "/path")` |
| Headings | `═══ HEADING ═══` | — |
| Separators | `────────────────` | — |
| List items | `• Item text` | — |

## How It Works

```
┌─────────────────────────────────────────────┐
│  Your Agent (any LLM)                        │
│  "click 3" / "type 7 hello" / "scroll down"  │
├─────────────────────────────────────────────┤
│  TextWeb                                     │
│  Pixel positions → character grid            │
│  Interactive elements get [ref] annotations  │
├─────────────────────────────────────────────┤
│  Headless Chromium (Playwright)              │
│  Full JS/CSS execution                       │
│  getBoundingClientRect() for all elements    │
└─────────────────────────────────────────────┘
```

1. **Real browser** renders the page (full JS, CSS, dynamic content)
2. **Extract** every visible element's position, size, text, and interactivity
3. **Map** pixel coordinates to character grid positions (spatial layout preserved)
4. **Annotate** interactive elements with `[ref]` numbers for agent interaction

## Selector Strategy

TextWeb builds stable CSS selectors for each interactive element, preferring resilient strategies over brittle positional ones:

| Priority | Strategy | Example |
|----------|----------|---------|
| 1 | `#id` | `#email` |
| 2 | `[data-testid]` | `[data-testid="submit-btn"]` |
| 3 | `[aria-label]` | `input[aria-label="Search"]` |
| 4 | `[role]` (if unique) | `[role="navigation"]` |
| 5 | `[name]` | `input[name="email"]` |
| 6 | `a[href]` (if unique) | `a[href="/about"]` |
| 7 | `nth-child` (fallback) | `div > a:nth-child(3)` |

This means selectors survive DOM changes between snapshots — critical for multi-step agent workflows.

## Testing

```bash
# Run all tests (81 total)
npm test

# Form fixture tests only (60 tests)
npm run test:form

# Live site tests — example.com, HN, Wikipedia (21 tests)
npm run test:live
```

Test fixtures are in `test/fixtures/` — includes a comprehensive HTML form with all input types, tables, navigation, and dynamic content.

## Design Principles

1. **Text is native to LLMs** — no vision model middleman
2. **Spatial layout matters** — flat element lists lose the "where"
3. **Cheap and fast** — 2-5KB per render vs 1MB+ screenshots
4. **Full web support** — real Chromium runs the JS
5. **Interactive** — reference numbers map to real DOM elements

## License

MIT © [Christopher Robison](https://cdr2.com)
