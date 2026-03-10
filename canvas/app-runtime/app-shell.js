const { assertValidAppManifest } = globalThis.TextWebAppManifest;
const { PAN_TOPICS, topicForLifecycleEvent } = globalThis.TextWebPanTopics;

const manifestParam = new URLSearchParams(window.location.search).get('manifest');
const manifestUrl = manifestParam || './sample-app.json';

const state = {
  manifest: null,
  tabs: [],
  activeTabId: null,
  navIndex: new Map(),
  componentRegistry: new Map(),
  pan: null,
  bridge: null
};

globalThis.__TW_RUNTIME_STATE__ = state;

function manifestDraftKey(appId) {
  return `tw.manifest.draft.${appId}`;
}

function getSavedComponents() {
  try {
    return JSON.parse(localStorage.getItem('tw.saved_components') || '[]');
  } catch (error) {
    return [];
  }
}

function setSavedComponents(components) {
  localStorage.setItem('tw.saved_components', JSON.stringify(components));
}

function fallbackPan() {
  const bus = new EventTarget();
  return {
    type: 'fallback',
    subscribe({ topic, handler }) {
      const listener = event => handler(event.detail);
      bus.addEventListener(topic, listener);
      return () => bus.removeEventListener(topic, listener);
    },
    publish({ topic, payload }) {
      bus.dispatchEvent(new CustomEvent(topic, { detail: { topic, payload } }));
    }
  };
}

async function createPan() {
  try {
    const { PanClient, ensurePanBus } = await import('https://esm.sh/@larcjs/core-lite@3.0.1');
    const busName = 'textweb-runtime-bus';
    await ensurePanBus(busName);
    const pan = PanClient.from('textweb-app-shell');
    await pan.ensureBus(busName);
    return {
      type: 'larc',
      subscribe({ topic, handler }) {
        return pan.subscribe({ topic, handler });
      },
      publish({ topic, payload }) {
        return pan.publish({ topic, payload });
      }
    };
  } catch (error) {
    return fallbackPan();
  }
}

class IntegrationBridge {
  constructor({ pan, manifest }) {
    this.pan = pan;
    this.serverBaseUrl = manifest.integrations?.serverBaseUrl || 'http://localhost:3000/integrations';
    this.allowedActions = new Set((manifest.integrations?.allowedActions || []).map(String));
    this.subscribe();
  }

  refreshManifest(manifest) {
    this.serverBaseUrl = manifest.integrations?.serverBaseUrl || 'http://localhost:3000/integrations';
    this.allowedActions = new Set((manifest.integrations?.allowedActions || []).map(String));
  }

  subscribe() {
    this.pan.subscribe({
      topic: PAN_TOPICS.INTEGRATION_SERVER_REQUEST,
      handler: async message => {
        const payload = message.payload || {};
        const action = payload.action;
        if (!action || (this.allowedActions.size > 0 && !this.allowedActions.has(action))) {
          this.pan.publish({
            topic: PAN_TOPICS.INTEGRATION_SERVER_RESPONSE,
            payload: {
              ok: false,
              action,
              error: 'Action is not allowlisted'
            }
          });
          return;
        }

        try {
          const response = await fetch(`${this.serverBaseUrl}/${encodeURIComponent(action)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const body = await response.json().catch(() => ({}));
          this.pan.publish({
            topic: PAN_TOPICS.INTEGRATION_SERVER_RESPONSE,
            payload: {
              ok: response.ok,
              action,
              status: response.status,
              body
            }
          });
        } catch (error) {
          this.pan.publish({
            topic: PAN_TOPICS.INTEGRATION_SERVER_RESPONSE,
            payload: {
              ok: false,
              action,
              error: error.message
            }
          });
        }
      }
    });
  }
}

function sanitizeId(value, fallback) {
  const safe = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || fallback;
}

function persistManifestDraft() {
  if (!state.manifest || !state.manifest.app || !state.manifest.app.id) return;
  localStorage.setItem(manifestDraftKey(state.manifest.app.id), JSON.stringify(state.manifest));
}

function currentNavItem() {
  if (!state.activeTabId) return null;
  const tab = state.tabs.find(entry => entry.id === state.activeTabId);
  return tab ? tab.navItem : null;
}

function requestServerAction(action, payload) {
  state.pan.publish({
    topic: PAN_TOPICS.INTEGRATION_SERVER_REQUEST,
    payload: {
      action,
      appId: state.manifest.app.id,
      correlationId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...payload
    }
  });
}

function registerBuiltInComponents() {
  class WelcomePanel extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <div class="panel">
          <div class="meta">Manifest-driven user runtime</div>
          <h2>Welcome</h2>
          <p>This shell is driven by <code>app.json</code> navigation and component pointers.</p>
          <p class="status">Use Forms to generate/save components and Manifest Editor to tune runtime config.</p>
        </div>
      `;
    }
  }

  class AutoFormBuilder extends HTMLElement {
    connectedCallback() {
      this.render();
      this.bind();
    }

    render() {
      this.innerHTML = `
        <div class="panel">
          <div class="meta">Autogenerated form designer</div>
          <h2>Auto Form Builder</h2>
          <p>Paste a JSON field schema and generate an editable form preview.</p>
          <textarea id="schemaInput">[
  {"name":"company","label":"Company","type":"text"},
  {"name":"contact_email","label":"Contact Email","type":"email"},
  {"name":"employee_count","label":"Employee Count","type":"number"}
]</textarea>
          <div class="row">
            <button class="primary" id="btnGenerate">Generate Form</button>
            <button id="btnSaveComponent">Save as Reusable Component</button>
          </div>
          <div class="generated-form" id="formPreview">No form generated yet.</div>
        </div>
      `;
    }

    bind() {
      const schemaInput = this.querySelector('#schemaInput');
      const formPreview = this.querySelector('#formPreview');

      this.querySelector('#btnGenerate').addEventListener('click', () => {
        try {
          const schema = JSON.parse(schemaInput.value);
          formPreview.innerHTML = renderFormFields(schema);
        } catch (error) {
          formPreview.innerHTML = `<p class="status err">Invalid schema JSON: ${escapeHtml(error.message)}</p>`;
        }
      });

      this.querySelector('#btnSaveComponent').addEventListener('click', () => {
        try {
          const schema = JSON.parse(schemaInput.value);
          const suggestedId = schema[0] && schema[0].name ? `${schema[0].name}-form` : 'custom-form';
          const componentId = sanitizeId(prompt('Component id', suggestedId), 'custom-form');
          if (!componentId) return;

          const label = (prompt('Component label', componentId) || componentId).trim();
          this.dispatchEvent(new CustomEvent('tw:save-generated-component', {
            bubbles: true,
            composed: true,
            detail: { componentId, label, schema }
          }));
        } catch (error) {
          alert(`Invalid schema JSON: ${error.message}`);
        }
      });
    }
  }

  class SavedFormComponent extends HTMLElement {
    connectedCallback() {
      const schemaText = this.getAttribute('schema') || '[]';
      const label = this.getAttribute('label') || 'Saved Form';
      let schema = [];
      try {
        schema = JSON.parse(schemaText);
      } catch (error) {
        schema = [];
      }

      this.innerHTML = `
        <div class="panel">
          <div class="meta">Saved reusable component</div>
          <h2>${escapeHtml(label)}</h2>
          <div class="generated-form">${renderFormFields(schema)}</div>
        </div>
      `;
    }
  }

  class ManifestEditor extends HTMLElement {
    connectedCallback() {
      this.render();
      this.bind();
      this.refresh();
      window.addEventListener('tw:manifest-changed', () => this.refresh());
    }

    render() {
      this.innerHTML = `
        <div class="panel">
          <div class="meta">Runtime manifest editor</div>
          <h2>Manifest Editor</h2>
          <p>Edit, validate, and apply <code>app.json</code> at runtime.</p>
          <textarea id="manifestText"></textarea>
          <div class="row">
            <button id="btnValidate">Validate</button>
            <button class="primary" id="btnApply">Apply Runtime</button>
          </div>
          <div class="row">
            <input id="manifestFileName" placeholder="manifest filename (optional)" />
            <button id="btnSaveServer">Save to Server</button>
            <button id="btnReloadDraft">Reload Draft</button>
          </div>
          <div class="status" id="editorStatus"></div>
        </div>
      `;
    }

    refresh() {
      const el = this.querySelector('#manifestText');
      if (!el || !state.manifest) return;
      el.value = JSON.stringify(state.manifest, null, 2);
    }

    bind() {
      const text = this.querySelector('#manifestText');
      const status = this.querySelector('#editorStatus');
      const fileNameInput = this.querySelector('#manifestFileName');

      const parseManifest = () => {
        const parsed = JSON.parse(text.value);
        assertValidAppManifest(parsed);
        return parsed;
      };

      this.querySelector('#btnValidate').addEventListener('click', () => {
        try {
          parseManifest();
          status.className = 'status';
          status.textContent = 'Manifest is valid.';
        } catch (error) {
          status.className = 'status err';
          status.textContent = error.message;
        }
      });

      this.querySelector('#btnApply').addEventListener('click', () => {
        try {
          const manifest = parseManifest();
          this.dispatchEvent(new CustomEvent('tw:manifest-updated', {
            bubbles: true,
            composed: true,
            detail: { manifest }
          }));
          status.className = 'status';
          status.textContent = 'Manifest applied to runtime.';
        } catch (error) {
          status.className = 'status err';
          status.textContent = error.message;
        }
      });

      this.querySelector('#btnSaveServer').addEventListener('click', () => {
        try {
          const manifest = parseManifest();
          const fileName = fileNameInput.value.trim() || `${manifest.app.id}.json`;
          this.dispatchEvent(new CustomEvent('tw:manifest-save-server', {
            bubbles: true,
            composed: true,
            detail: { manifest, fileName }
          }));
          status.className = 'status';
          status.textContent = `Save requested for ${fileName}.`;
        } catch (error) {
          status.className = 'status err';
          status.textContent = error.message;
        }
      });

      this.querySelector('#btnReloadDraft').addEventListener('click', () => {
        const appId = state.manifest && state.manifest.app ? state.manifest.app.id : null;
        if (!appId) return;
        const raw = localStorage.getItem(manifestDraftKey(appId));
        if (!raw) {
          status.className = 'status warn';
          status.textContent = 'No local draft exists for this app.';
          return;
        }
        text.value = raw;
        status.className = 'status';
        status.textContent = 'Local draft loaded into editor.';
      });
    }
  }

  if (!customElements.get('tw-welcome-panel')) customElements.define('tw-welcome-panel', WelcomePanel);
  if (!customElements.get('tw-auto-form-builder')) customElements.define('tw-auto-form-builder', AutoFormBuilder);
  if (!customElements.get('tw-saved-form-component')) customElements.define('tw-saved-form-component', SavedFormComponent);
  if (!customElements.get('tw-manifest-editor')) customElements.define('tw-manifest-editor', ManifestEditor);
}

function renderFormFields(schema) {
  if (!Array.isArray(schema) || schema.length === 0) {
    return '<p class="status warn">No fields in schema.</p>';
  }

  return schema.map(field => {
    const safeLabel = escapeHtml(field.label || field.name || 'Field');
    const safeName = escapeHtml(field.name || 'field');
    const safeType = escapeHtml(field.type || 'text');
    return `<label>${safeLabel}</label><input name="${safeName}" type="${safeType}" />`;
  }).join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getFlatNavItems(items, parentId = null, depth = 0) {
  const flat = [];
  for (const item of items) {
    flat.push({ ...item, parentId, depth });
    if (Array.isArray(item.children)) {
      flat.push(...getFlatNavItems(item.children, item.id, depth + 1));
    }
  }
  return flat;
}

function registerComponentsFromManifest(manifest) {
  state.componentRegistry.clear();
  const declared = manifest.components || [];
  for (const component of declared) {
    state.componentRegistry.set(component.id, component);
  }

  const saved = getSavedComponents();
  for (const component of saved) {
    state.componentRegistry.set(component.id, {
      id: component.id,
      tagName: 'tw-saved-form-component',
      savedSchema: component.schema,
      savedLabel: component.label
    });
  }
}

function renderNavigation() {
  const navTree = document.getElementById('navTree');
  const items = getFlatNavItems(state.manifest.navigation);

  state.navIndex.clear();
  navTree.innerHTML = '';
  for (const item of items) {
    state.navIndex.set(item.id, item);

    if (!item.componentId && (!item.children || item.children.length === 0)) {
      continue;
    }

    const button = document.createElement('button');
    button.className = `nav-item ${item.depth > 0 ? 'child' : ''}`;
    button.textContent = item.label;
    button.dataset.id = item.id;

    if (!item.componentId) {
      button.disabled = true;
      button.title = 'Folder item';
    } else {
      button.addEventListener('click', () => openNavItem(item.id));
    }

    navTree.appendChild(button);
  }
}

function findTab(tabId) {
  return state.tabs.find(tab => tab.id === tabId) || null;
}

function setActiveTab(tabId) {
  state.activeTabId = tabId;

  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.id === tabId);
  });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === tabId);
  });

  const tab = findTab(tabId);
  if (!tab) return;

  const content = document.getElementById('content');
  content.innerHTML = '';
  content.appendChild(tab.element);

  publishLifecycle('onView', tab.navItem);
}

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';

  for (const tab of state.tabs) {
    const button = document.createElement('button');
    button.className = `tab ${tab.id === state.activeTabId ? 'active' : ''}`;
    button.textContent = tab.label;
    button.dataset.id = tab.id;
    button.addEventListener('click', () => setActiveTab(tab.id));
    tabs.appendChild(button);
  }
}

function instantiateComponent(navItem) {
  const componentDef = state.componentRegistry.get(navItem.componentId);
  if (!componentDef) {
    const fallback = document.createElement('div');
    fallback.className = 'panel';
    fallback.innerHTML = `<h2>Missing component</h2><p>No component registered for <code>${escapeHtml(navItem.componentId)}</code>.</p>`;
    return fallback;
  }

  const element = document.createElement(componentDef.tagName);
  if (componentDef.savedSchema) element.setAttribute('schema', JSON.stringify(componentDef.savedSchema));
  if (componentDef.savedLabel) element.setAttribute('label', componentDef.savedLabel);
  return element;
}

function publishLifecycle(eventName, navItem, extraPayload = {}) {
  const payload = {
    appId: state.manifest.app.id,
    navId: navItem.id,
    componentId: navItem.componentId,
    eventName,
    correlationId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...extraPayload
  };

  const defaultTopic = topicForLifecycleEvent(eventName);
  if (defaultTopic) state.pan.publish({ topic: defaultTopic, payload });

  const hooks = (navItem.events && navItem.events[eventName]) || [];
  hooks.forEach(hook => {
    if (hook.target === 'client' && hook.topic) {
      state.pan.publish({ topic: hook.topic, payload: { ...payload, hook: hook.name } });
      return;
    }

    if (hook.target === 'server') {
      requestServerAction(hook.action || 'runtime_state', {
        hook: hook.name,
        endpoint: hook.endpoint,
        manifest: state.manifest,
        navItem
      });
    }
  });
}

function openNavItem(navId) {
  const navItem = state.navIndex.get(navId);
  if (!navItem || !navItem.componentId) return;

  const existing = findTab(navId);
  if (existing) {
    setActiveTab(existing.id);
    return;
  }

  const tab = {
    id: navItem.id,
    label: navItem.label,
    navItem,
    element: instantiateComponent(navItem)
  };

  state.tabs.push(tab);
  renderTabs();
  setActiveTab(tab.id);

  state.pan.publish({
    topic: PAN_TOPICS.APP_NAV_OPEN,
    payload: { appId: state.manifest.app.id, navId: navItem.id }
  });

  state.pan.publish({
    topic: PAN_TOPICS.APP_TAB_OPEN,
    payload: { appId: state.manifest.app.id, tabId: tab.id }
  });

  publishLifecycle('onLoad', navItem);
}

function ensureSavedFormsNavigation(manifest) {
  let bucket = manifest.navigation.find(item => item.id === 'saved-forms');
  if (!bucket) {
    bucket = { id: 'saved-forms', label: 'Saved Forms', children: [] };
    manifest.navigation.push(bucket);
  }
  if (!Array.isArray(bucket.children)) bucket.children = [];
  return bucket;
}

function upsertManifestFromSavedComponent(componentId, label, schema) {
  if (!Array.isArray(state.manifest.components)) {
    state.manifest.components = [];
  }

  const componentDef = { id: componentId, tagName: 'tw-saved-form-component' };
  const compIndex = state.manifest.components.findIndex(entry => entry.id === componentId);
  if (compIndex >= 0) state.manifest.components[compIndex] = componentDef;
  else state.manifest.components.push(componentDef);

  const bucket = ensureSavedFormsNavigation(state.manifest);
  const navId = sanitizeId(`saved-${componentId}`, `saved-${Date.now()}`);
  const navEntry = { id: navId, label, componentId };

  const navIndex = bucket.children.findIndex(entry => entry.componentId === componentId);
  if (navIndex >= 0) {
    bucket.children[navIndex] = { ...bucket.children[navIndex], ...navEntry };
  } else {
    bucket.children.push(navEntry);
  }

  persistManifestDraft();
  registerComponentsFromManifest(state.manifest);
  renderNavigation();
  window.dispatchEvent(new Event('tw:manifest-changed'));
  return navEntry;
}

function applyManifest(manifest, preferredTabId = null) {
  assertValidAppManifest(manifest);
  state.manifest = manifest;
  persistManifestDraft();

  if (state.bridge) state.bridge.refreshManifest(state.manifest);

  document.getElementById('appTitle').textContent = state.manifest.app.name;
  document.getElementById('appId').textContent = `${state.manifest.app.id} · ${state.pan.type.toUpperCase()} bus`;

  registerComponentsFromManifest(state.manifest);
  renderNavigation();

  state.tabs = [];
  state.activeTabId = null;
  renderTabs();

  const desired = preferredTabId && state.navIndex.has(preferredTabId) ? preferredTabId : null;
  const firstLeaf = desired || getFlatNavItems(state.manifest.navigation).find(item => item.componentId)?.id;
  if (firstLeaf) openNavItem(firstLeaf);

  window.dispatchEvent(new Event('tw:manifest-changed'));
}

function attachGlobalListeners() {
  document.body.addEventListener('tw:save-generated-component', event => {
    const detail = event.detail || {};
    const { componentId, label, schema } = detail;
    if (!componentId || !Array.isArray(schema)) return;

    const existing = getSavedComponents();
    const merged = existing.filter(component => component.id !== componentId);
    merged.push({ id: componentId, label, schema });
    setSavedComponents(merged);

    state.componentRegistry.set(componentId, {
      id: componentId,
      tagName: 'tw-saved-form-component',
      savedSchema: schema,
      savedLabel: label
    });

    const navEntry = upsertManifestFromSavedComponent(componentId, label, schema);

    const active = currentNavItem();
    if (active) {
      publishLifecycle('onSave', active, { savedComponentId: componentId });
    }

    requestServerAction('sync_saved_form', { componentId, label, schema });
    requestServerAction('upsert_nav_item', { manifest: state.manifest, navItem: navEntry, parentId: 'saved-forms' });
    requestServerAction('save_manifest', { manifest: state.manifest, fileName: `${state.manifest.app.id}.json` });

    openNavItem(navEntry.id);
  });

  document.body.addEventListener('tw:manifest-updated', event => {
    try {
      const manifest = structuredClone(event.detail.manifest);
      applyManifest(manifest, state.activeTabId);
    } catch (error) {
      const status = document.getElementById('bridgeStatus');
      status.className = 'status err';
      status.textContent = `Manifest update failed: ${error.message}`;
    }
  });

  document.body.addEventListener('tw:manifest-save-server', event => {
    const detail = event.detail || {};
    requestServerAction('save_manifest', {
      manifest: detail.manifest || state.manifest,
      fileName: detail.fileName || `${state.manifest.app.id}.json`
    });
  });

  state.pan.subscribe({
    topic: PAN_TOPICS.INTEGRATION_SERVER_RESPONSE,
    handler: message => {
      const status = document.getElementById('bridgeStatus');
      const payload = message.payload || {};
      if (payload.ok) {
        status.className = 'status';
        status.textContent = `Integration "${payload.action}" finished (HTTP ${payload.status || 200}).`;
      } else {
        status.className = 'status err';
        status.textContent = `Integration "${payload.action || 'unknown'}" failed: ${payload.error || 'unknown error'}`;
      }
    }
  });
}

async function loadManifestWithDraft() {
  const base = await fetch(manifestUrl).then(response => {
    if (!response.ok) {
      throw new Error(`Unable to load manifest ${manifestUrl} (HTTP ${response.status})`);
    }
    return response.json();
  });
  assertValidAppManifest(base);

  const draftRaw = localStorage.getItem(manifestDraftKey(base.app.id));
  if (!draftRaw) return base;

  try {
    const draft = JSON.parse(draftRaw);
    assertValidAppManifest(draft);
    return draft;
  } catch (_error) {
    return base;
  }
}

async function bootstrap() {
  registerBuiltInComponents();
  state.pan = await createPan();

  const manifest = await loadManifestWithDraft();
  state.bridge = new IntegrationBridge({ pan: state.pan, manifest });

  attachGlobalListeners();
  applyManifest(manifest);
}

bootstrap().catch(error => {
  document.getElementById('content').innerHTML = `
    <div class="panel">
      <h2>Runtime bootstrap failed</h2>
      <p class="status err">${escapeHtml(error.message)}</p>
      <p class="status">Manifest URL: <code>${escapeHtml(manifestUrl)}</code></p>
    </div>
  `;
});
