/**
 * TextWeb Text Grid Renderer
 * 
 * Converts a rendered web page into a structured text grid with
 * interactive element references. No screenshots, no vision models.
 * 
 * Key design decisions:
 * - Overflow > truncation (never lose information)
 * - Measure actual font metrics from the page
 * - Row-grouping layout (elements grouped by Y position)
 * - Dynamic height (grows to fit all content)
 */

/**
 * Measure actual character dimensions from the page's fonts
 */
async function measureCharSize(page) {
  return await page.evaluate(() => {
    // Create a test element using the page's default font
    const el = document.createElement('span');
    const bodyStyle = getComputedStyle(document.body);
    el.style.fontFamily = bodyStyle.fontFamily;
    el.style.fontSize = bodyStyle.fontSize;
    el.style.fontWeight = 'normal';
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    el.style.whiteSpace = 'nowrap';
    
    // Use a representative sample of characters for average width
    // (proportional fonts vary per char — average is the best we can do)
    el.textContent = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    document.body.appendChild(el);
    const avgW = el.getBoundingClientRect().width / el.textContent.length;
    const charH = el.getBoundingClientRect().height;
    
    // Also get line height (more accurate for vertical spacing)
    el.textContent = 'X';
    el.style.lineHeight = bodyStyle.lineHeight;
    const lineH = el.getBoundingClientRect().height;
    
    document.body.removeChild(el);
    
    return {
      charW: avgW,
      charH: Math.max(charH, lineH),
      lineH: lineH,
      font: bodyStyle.fontFamily,
      fontSize: bodyStyle.fontSize,
    };
  });
}

/**
 * Extract visible elements from a Playwright page with positions and metadata
 */
async function extractElements(page) {
  return await page.evaluate(() => {
    const results = [];
    const interactiveSelector = 'a[href], button, input, select, textarea, [onclick], [role="button"], [role="link"], [tabindex]:not([tabindex="-1"]), summary';

    function isVisible(el) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    }

    function getZIndex(el) {
      let z = 0;
      let current = el;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        const zi = parseInt(style.zIndex);
        if (!isNaN(zi) && zi > z) z = zi;
        if (style.position === 'fixed' || style.position === 'sticky') z = Math.max(z, 1000);
        current = current.parentElement;
      }
      return z;
    }

    function buildSelector(el) {
      // Build a robust CSS selector for clicking
      // Priority: id > data-testid > aria > role+name > name > positional
      if (el.id) return '#' + CSS.escape(el.id);
      
      const tag = el.tagName.toLowerCase();
      
      // Stable test attributes (used by many frameworks)
      for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-test-id']) {
        const val = el.getAttribute(attr);
        if (val) return `[${attr}="${val}"]`;
      }
      
      // Aria-label (very stable, set by developers intentionally)
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) {
        const sel = `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }

      // Role + name combination
      const role = el.getAttribute('role');
      if (role) {
        const name = ariaLabel || el.textContent.trim().substring(0, 50);
        if (name) {
          const sel = `[role="${role}"]`;
          // Only use if unique enough
          if (document.querySelectorAll(sel).length === 1) return sel;
        }
      }

      // Name attribute (forms)
      if (el.getAttribute('name')) return `${tag}[name="${el.getAttribute('name')}"]`;
      
      // href for links (use partial match for stability)
      if (tag === 'a' && el.href) {
        const href = el.getAttribute('href');
        if (href && !href.startsWith('javascript:') && href !== '#') {
          const sel = `a[href="${CSS.escape(href)}"]`;
          if (document.querySelectorAll(sel).length === 1) return sel;
        }
      }

      // Fallback: positional selector (least stable)
      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(el) + 1;
      const parentSel = parent.id ? '#' + CSS.escape(parent.id) : buildSelector(parent);
      return parentSel + ' > ' + tag + ':nth-child(' + idx + ')';
    }

    function isInteractive(el) {
      return el.matches(interactiveSelector);
    }

    function domPath(el) {
      const parts = [];
      let current = el;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        let idx = 1;
        let sib = current;
        while ((sib = sib.previousElementSibling)) {
          if (sib.tagName.toLowerCase() === tag) idx++;
        }
        parts.push(`${tag}:${idx}`);
        current = current.parentElement;
      }
      parts.push('body:1');
      return parts.reverse().join('/');
    }

    // Detect tables and extract their structure
    const tableData = new Map();
    document.querySelectorAll('table').forEach(table => {
      const rect = table.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      
      const rows = [];
      table.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('td, th').forEach(cell => {
          const cellRect = cell.getBoundingClientRect();
          cells.push({
            x: cellRect.x,
            y: cellRect.y,
            w: cellRect.width,
            h: cellRect.height,
            text: cell.textContent.trim().slice(0, 200),
            isHeader: cell.tagName === 'TH',
            colspan: cell.colSpan || 1,
          });
        });
        if (cells.length > 0) rows.push(cells);
      });
      
      tableData.set(table, {
        rect,
        rows,
        colCount: Math.max(...rows.map(r => r.length), 0),
      });
    });

    // Walk the DOM tree
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
          const el = node;
          if (!isVisible(el)) return NodeFilter.FILTER_REJECT;
          // Accept specific non-text elements
          if (el.matches('input, select, textarea, img, hr, br')) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const isText = node.nodeType === Node.TEXT_NODE;
      const el = isText ? node.parentElement : node;
      if (!el) continue;

      let rect;
      if (isText) {
        const range = document.createRange();
        range.selectNodeContents(node);
        rect = range.getBoundingClientRect();
      } else {
        rect = el.getBoundingClientRect();
      }
      if (rect.width === 0 && rect.height === 0) continue;

      const tag = el.tagName.toLowerCase();
      const interactive = isInteractive(el);
      const role = el.getAttribute('role') || null;

      let text = '';
      let value = null;
      if (isText) {
        text = node.textContent.trim();
      } else if (tag === 'input') {
        const type = (el.type || 'text').toLowerCase();
        text = el.value || el.placeholder || '';
        value = el.value || '';
      } else if (tag === 'select') {
        const opt = el.options && el.options[el.selectedIndex];
        text = opt ? opt.text : '';
        value = el.value || '';
      } else if (tag === 'textarea') {
        text = el.value || el.placeholder || '';
        value = el.value || '';
      } else if (tag === 'img') {
        text = el.alt || '[img]';
      } else if (tag === 'hr') {
        text = '---';
      }

      // Resolve label for form elements
      let label = '';
      if (!isText && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
        // Strategy 1: <label for="id">
        if (el.id) {
          const labelEl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (labelEl) label = labelEl.textContent.trim().replace(/\s*\*\s*$/, '').trim();
        }
        // Strategy 2: aria-label
        if (!label && el.getAttribute('aria-label')) {
          label = el.getAttribute('aria-label');
        }
        // Strategy 3: wrapping <label>
        if (!label) {
          const parentLabel = el.closest('label');
          if (parentLabel) label = parentLabel.textContent.trim().replace(/\s*\*\s*$/, '').trim();
        }
        // Strategy 4: name attribute as fallback
        if (!label && el.name) {
          label = el.name.replace(/[_\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }

      // Determine semantic type
      let semantic = 'text';
      const headingMatch = tag.match(/^h(\d)$/);
      if (headingMatch) semantic = 'heading';
      else if (tag === 'a' && el.href) semantic = 'link';
      else if (tag === 'button' || el.getAttribute('role') === 'button') semantic = 'button';
      else if (tag === 'input') {
        const type = (el.type || 'text').toLowerCase();
        if (type === 'checkbox') semantic = 'checkbox';
        else if (type === 'radio') semantic = 'radio';
        else if (type === 'submit' || type === 'button') semantic = 'button';
        else if (type === 'file') semantic = 'file';
        else semantic = 'input';
      }
      else if (tag === 'select') semantic = 'select';
      else if (tag === 'textarea') semantic = 'textarea';
      else if (tag === 'hr') semantic = 'separator';

      // Check for list context
      if (el.closest('li') && semantic === 'text') {
        const li = el.closest('li');
        const liRect = li.getBoundingClientRect();
        if (Math.abs(rect.y - liRect.y) < 5) {
          semantic = 'listitem';
        }
      }

      // Check if inside a table cell
      const closestTd = el.closest('td, th');
      let tableCell = null;
      if (closestTd) {
        const tr = closestTd.closest('tr');
        const table = closestTd.closest('table');
        if (tr && table) {
          tableCell = {
            cellIndex: Array.from(tr.children).indexOf(closestTd),
            rowIndex: Array.from(table.querySelectorAll('tr')).indexOf(tr),
            isHeader: closestTd.tagName === 'TH',
          };
        }
      }

      const parentElement = el.parentElement;
      const parentInteractive = !!(parentElement && parentElement.matches(interactiveSelector));
      const parentPath = parentElement ? domPath(parentElement) : null;

      results.push({
        text,
        label: label || '',
        role,
        tag,
        semantic,
        headingLevel: headingMatch ? parseInt(headingMatch[1]) : 0,
        interactive,
        isTextNode: isText,
        checked: !!el.checked,
        selected: !!el.selected,
        disabled: !!el.disabled,
        required: !!el.required,
        expanded: el.getAttribute('aria-expanded') === 'true',
        placeholder: el.getAttribute('placeholder') || null,
        name: el.getAttribute('name') || '',
        alt: el.getAttribute('alt') || '',
        value,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        z: getZIndex(el),
        href: el.href || null,
        selector: buildSelector(el),
        domPath: domPath(el),
        parentPath,
        parentInteractive,
        tableCell,
      });
    }

    // Sort by z-index (back to front), then by document position (y, x)
    results.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    return results;
  });
}

function stableHash(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

function buildSemanticModel(rawElements, layoutEntries, pageMeta) {
  const layoutByDomPath = new Map();
  for (const item of layoutEntries || []) {
    const key = item.domPath || `${item.selector}|${item.x}|${item.y}`;
    layoutByDomPath.set(key, item);
  }

  const elements = [];
  const byPath = new Map();
  const rawByPath = new Map();
  const identityCounts = new Map();

  for (let i = 0; i < rawElements.length; i++) {
    const el = rawElements[i];
    rawByPath.set(el.domPath, el);
    const name = (el.label || el.text || el.alt || el.name || '').trim();
    const baseSeed = [
      el.semantic || 'unknown',
      el.role || '',
      name.toLowerCase(),
      el.parentPath || '',
      el.domPath || '',
    ].join('|');
    const ordinal = identityCounts.get(baseSeed) || 0;
    identityCounts.set(baseSeed, ordinal + 1);
    const id = `e_${stableHash(`${baseSeed}|${ordinal}`).slice(0, 8)}`;

    const layoutKey = el.domPath || `${el.selector}|${el.x}|${el.y}`;
    const layout = layoutByDomPath.get(layoutKey);
    const semanticEl = {
      id,
      type: el.semantic || 'text',
      role: el.role || null,
      name: name || null,
      text: el.text || null,
      value: el.value ?? null,
      href: el.href || null,
      placeholder: el.placeholder || null,
      checked: typeof el.checked === 'boolean' ? el.checked : null,
      selected: typeof el.selected === 'boolean' ? el.selected : null,
      disabled: !!el.disabled,
      required: !!el.required,
      expanded: !!el.expanded,
      visible: true,
      parent_id: null,
      children: [],
      grid_ref: layout && layout.ref !== null ? layout.ref : null,
      grid_bounds: layout ? {
        row: layout.row,
        col_start: layout.colStart,
        col_end: layout.colEnd,
      } : null,
      selector: el.selector,
      path: el.domPath,
      // Future hooks: action routing and structural diff matching.
      actions: el.interactive ? ['click'] : [],
    };

    if (semanticEl.type === 'input' || semanticEl.type === 'textarea' || semanticEl.type === 'select') {
      semanticEl.actions.push('type');
    }
    if (semanticEl.type === 'select') {
      semanticEl.actions.push('select');
    }

    byPath.set(el.domPath, semanticEl);
    elements.push(semanticEl);
  }

  for (const el of elements) {
    const raw = rawByPath.get(el.path);
    const parentPath = raw ? raw.parentPath : null;
    if (!parentPath) continue;
    const parent = byPath.get(parentPath);
    if (parent) {
      el.parent_id = parent.id;
      parent.children.push(el.id);
    }
  }

  return {
    mode: 'semantic',
    url: pageMeta.url || null,
    title: pageMeta.title || null,
    elements,
  };
}

/**
 * Detect row boundaries — groups of elements that share the same Y position
 * This prevents text from different elements on the same visual line from overlapping
 */
function groupByRows(elements, charH) {
  const rows = [];
  let currentRow = [];
  let currentY = -Infinity;
  const threshold = charH * 0.4; // elements within 40% of line height are on the same row

  for (const el of elements) {
    if (Math.abs(el.y - currentY) > threshold && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [];
    }
    currentRow.push(el);
    currentY = el.y;
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

/**
 * Build the display string for an element, assigning refs for interactive ones
 */
function formatElement(el, ref, cols, startCol, charW) {
  switch (el.semantic) {
    case 'heading': {
      const bar = el.headingLevel <= 2 ? '═' : '─';
      const prefix = ref !== null ? `[${ref}]` : '';
      const title = el.text.toUpperCase();
      return `${prefix}${bar.repeat(2)} ${title} ${bar.repeat(Math.max(2, cols - startCol - title.length - 6))}`;
    }
    case 'link':
      return `[${ref}]${el.text}`;
    case 'button':
      return `[${ref} ${el.text}]`;
    case 'input': {
      const w = Math.min(25, Math.max(5, Math.round(el.w / charW) - 6));
      return `[${ref}:${el.text || '_'.repeat(w)}]`;
    }
    case 'textarea': {
      const w = Math.min(40, Math.max(5, Math.round(el.w / charW) - 6));
      return `[${ref}:${el.text || '_'.repeat(w)}]`;
    }
    case 'checkbox':
      return `[${ref}:${el.checked ? 'X' : ' '}] ${el.text}`;
    case 'radio':
      return `[${ref}:${el.checked ? '●' : '○'}] ${el.text}`;
    case 'select':
      return `[${ref}:▼ ${el.text}]`;
    case 'file':
      return `[${ref}:📎 ${el.text || 'Choose file'}]`;
    case 'separator': {
      const width = Math.min(cols - startCol, Math.round(el.w / charW));
      return '─'.repeat(Math.max(3, width));
    }
    case 'listitem':
      return (ref !== null ? `[${ref}]` : '') + `• ${el.text}`;
    default:
      return (ref !== null ? `[${ref}]` : '') + el.text;
  }
}

/**
 * Render extracted elements into a text grid.
 * 
 * Strategy:
 * 1. Group elements into visual rows (same Y position ± threshold)
 * 2. Within each visual row, sort by X and lay out left-to-right with spacing
 * 3. Each visual row maps to one or more grid lines
 * 4. Grid grows as needed (overflow — never lose data)
 */
function renderGrid(elements, cols, charW, charH, scrollY = 0, options = {}) {
  const { includeLayout = false } = options;
  const elementMap = {};
  let refId = 0;
  const lines = []; // output lines as strings
  const layout = [];

  // Filter to viewport (vertically — allow overflow below)
  const visible = elements.filter(el => {
    const adjY = el.y - scrollY;
    return adjY + el.h >= 0; // don't filter bottom — allow overflow
  });

  // Group into visual rows
  const visualRows = groupByRows(visible, charH);

  for (const rowElements of visualRows) {
    const rowIndex = lines.length;
    // Sort elements in this row by X position (left to right)
    rowElements.sort((a, b) => a.x - b.x);

    // Build this row's text by placing each element at its column position
    let line = '';
    let cursor = 0; // current character position in the line

    for (const el of rowElements) {
      const targetCol = Math.max(0, Math.round(el.x / charW));

      // Assign ref for interactive elements
      let ref = null;
      if (el.interactive) {
        ref = refId++;
        elementMap[ref] = {
          selector: el.selector,
          tag: el.tag,
          semantic: el.semantic,
          href: el.href,
          text: el.text,
          label: el.label || '',
          x: el.x,
          y: el.y,
        };
      }

      const display = formatElement(el, ref, cols, targetCol, charW);
      if (!display) continue;

      let startCol = cursor;
      if (targetCol > cursor) {
        // Pad with spaces to reach the target column
        line += ' '.repeat(targetCol - cursor);
        cursor = targetCol;
        startCol = cursor;
      } else if (cursor > 0 && targetCol <= cursor) {
        // Elements overlap — add a single space separator
        line += ' ';
        cursor += 1;
        startCol = cursor;
      }

      line += display;
      cursor += display.length;

      if (includeLayout) {
        layout.push({
          ref,
          row: rowIndex,
          colStart: startCol,
          colEnd: cursor - 1,
          selector: el.selector,
          domPath: el.domPath,
          semantic: el.semantic,
          x: el.x,
          y: el.y,
        });
      }
    }

    lines.push(line.trimEnd());
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const result = {
    view: lines.join('\n'),
    elements: elementMap,
    meta: { cols, rows: lines.length, scrollY, totalRefs: refId, charW, charH }
  };
  if (includeLayout) result.layout = layout;
  return result;
}

/**
 * Main render function: page → text grid
 */
async function render(page, options = {}) {
  const { cols = 120, scrollY = 0 } = options;
  const startMs = Date.now();
  
  // Measure actual font metrics from the page
  const metrics = await measureCharSize(page);
  const charW = metrics.charW;
  const charH = metrics.charH;
  
  const elements = await extractElements(page);
  const gridResult = renderGrid(elements, cols, charW, charH, scrollY, { includeLayout: true });
  const result = {
    view: gridResult.view,
    elements: gridResult.elements,
    meta: gridResult.meta,
  };
  
  // Add stats to meta
  result.meta.stats = {
    totalElements: elements.length,
    interactiveElements: result.meta.totalRefs,
    renderMs: Date.now() - startMs,
  };

  result.semantic = buildSemanticModel(elements, gridResult.layout || [], result.meta);
  
  return result;
}

module.exports = { render, extractElements, renderGrid, measureCharSize, buildSemanticModel };
