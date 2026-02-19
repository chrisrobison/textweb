# TextWeb Browser

You have access to a text-based web browser via the `textweb_*` tools. Pages are rendered as structured character grids instead of screenshots.

## How It Works

- `textweb_navigate(url)` — Opens a page and returns a text grid
- `textweb_click(ref)` — Clicks element `[ref]`  
- `textweb_type(ref, text)` — Types into input `[ref]`
- `textweb_select(ref, value)` — Selects dropdown option
- `textweb_scroll(direction)` — Scrolls up/down/top
- `textweb_snapshot()` — Re-renders current page
- `textweb_press(key)` — Presses a key (Enter, Tab, etc.)
- `textweb_upload(ref, path)` — Uploads a file to input

## Reading the Grid

Interactive elements have reference numbers in brackets:

| Element | Appears as | Action |
|---------|-----------|--------|
| Link | `[3]Click me` | `click(3)` |
| Button | `[5 Submit]` | `click(5)` |
| Text input | `[7:placeholder___]` | `type(7, "text")` |
| Checkbox | `[9:X] Label` / `[9: ] Label` | `click(9)` to toggle |
| Radio | `[11:●] Option` / `[11:○] Option` | `click(11)` |
| Dropdown | `[13:▼ Selected]` | `select(13, "value")` |
| File input | `[15:📎 Choose file]` | `upload(15, "/path/to/file")` |
| Heading | `═══ TITLE ═══` | (not interactive) |

## Tips

- The grid preserves spatial layout — elements near each other on screen are near each other in text
- After clicking a link or submitting a form, you get the new page's grid automatically
- Use `snapshot()` if you need to re-read the page after waiting for dynamic content
- For multi-step forms, fill fields then click the Next/Submit button
- Scroll down if you don't see what you're looking for — the initial view shows only the viewport
