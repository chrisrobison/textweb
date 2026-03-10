(function initManifestModule(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.TextWebAppManifest = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function manifestFactory() {
  const APP_MANIFEST_VERSION = '1';

  const LIFECYCLE_EVENTS = Object.freeze([
    'onLoad',
    'onView',
    'onSave',
    'onBeforeSave',
    'onAfterSave'
  ]);

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function appendError(errors, path, message) {
    errors.push(`${path}: ${message}`);
  }

  function validateHook(hook, path, errors) {
    if (!isPlainObject(hook)) {
      appendError(errors, path, 'hook must be an object');
      return;
    }

    if (typeof hook.name !== 'string' || hook.name.trim() === '') {
      appendError(errors, `${path}.name`, 'must be a non-empty string');
    }

    if (!['client', 'server'].includes(hook.target)) {
      appendError(errors, `${path}.target`, 'must be "client" or "server"');
    }

    if (hook.target === 'client' && (typeof hook.topic !== 'string' || hook.topic.trim() === '')) {
      appendError(errors, `${path}.topic`, 'is required for client hooks');
    }

    if (hook.target === 'server') {
      const hasAction = typeof hook.action === 'string' && hook.action.trim() !== '';
      const hasEndpoint = typeof hook.endpoint === 'string' && hook.endpoint.trim() !== '';
      if (!hasAction && !hasEndpoint) {
        appendError(errors, path, 'server hooks require either action or endpoint');
      }
    }
  }

  function validateEvents(events, path, errors) {
    if (!isPlainObject(events)) {
      appendError(errors, path, 'must be an object');
      return;
    }

    for (const [eventName, hooks] of Object.entries(events)) {
      if (!LIFECYCLE_EVENTS.includes(eventName)) {
        appendError(errors, `${path}.${eventName}`, `is not supported (allowed: ${LIFECYCLE_EVENTS.join(', ')})`);
        continue;
      }
      if (!Array.isArray(hooks)) {
        appendError(errors, `${path}.${eventName}`, 'must be an array of hooks');
        continue;
      }
      hooks.forEach((hook, index) => validateHook(hook, `${path}.${eventName}[${index}]`, errors));
    }
  }

  function validateNavItem(item, path, errors) {
    if (!isPlainObject(item)) {
      appendError(errors, path, 'must be an object');
      return;
    }

    if (typeof item.id !== 'string' || item.id.trim() === '') {
      appendError(errors, `${path}.id`, 'must be a non-empty string');
    }

    if (typeof item.label !== 'string' || item.label.trim() === '') {
      appendError(errors, `${path}.label`, 'must be a non-empty string');
    }

    if (item.componentId != null && (typeof item.componentId !== 'string' || item.componentId.trim() === '')) {
      appendError(errors, `${path}.componentId`, 'must be a non-empty string when provided');
    }

    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    if (!item.componentId && !hasChildren) {
      appendError(errors, path, 'must define componentId or non-empty children');
    }

    if (item.children != null) {
      if (!Array.isArray(item.children)) {
        appendError(errors, `${path}.children`, 'must be an array');
      } else {
        item.children.forEach((child, index) => validateNavItem(child, `${path}.children[${index}]`, errors));
      }
    }

    if (item.events != null) {
      validateEvents(item.events, `${path}.events`, errors);
    }
  }

  function validateComponent(component, path, errors) {
    if (!isPlainObject(component)) {
      appendError(errors, path, 'must be an object');
      return;
    }

    if (typeof component.id !== 'string' || component.id.trim() === '') {
      appendError(errors, `${path}.id`, 'must be a non-empty string');
    }

    if (typeof component.tagName !== 'string' || component.tagName.trim() === '') {
      appendError(errors, `${path}.tagName`, 'must be a non-empty string');
    }

    if (component.moduleUrl != null && typeof component.moduleUrl !== 'string') {
      appendError(errors, `${path}.moduleUrl`, 'must be a string when provided');
    }
  }

  function validateAppManifest(manifest) {
    const errors = [];

    if (!isPlainObject(manifest)) {
      return {
        valid: false,
        errors: ['root: manifest must be an object']
      };
    }

    if (String(manifest.schemaVersion || '') !== APP_MANIFEST_VERSION) {
      appendError(errors, 'schemaVersion', `must equal "${APP_MANIFEST_VERSION}"`);
    }

    if (!isPlainObject(manifest.app)) {
      appendError(errors, 'app', 'must be an object');
    } else {
      if (typeof manifest.app.id !== 'string' || manifest.app.id.trim() === '') {
        appendError(errors, 'app.id', 'must be a non-empty string');
      }
      if (typeof manifest.app.name !== 'string' || manifest.app.name.trim() === '') {
        appendError(errors, 'app.name', 'must be a non-empty string');
      }
    }

    if (!Array.isArray(manifest.navigation) || manifest.navigation.length === 0) {
      appendError(errors, 'navigation', 'must be a non-empty array');
    } else {
      manifest.navigation.forEach((item, index) => validateNavItem(item, `navigation[${index}]`, errors));
    }

    if (manifest.components != null) {
      if (!Array.isArray(manifest.components)) {
        appendError(errors, 'components', 'must be an array when provided');
      } else {
        manifest.components.forEach((component, index) => validateComponent(component, `components[${index}]`, errors));
        const seenComponentIds = new Set();
        manifest.components.forEach((component, index) => {
          if (!component || typeof component.id !== 'string') return;
          if (seenComponentIds.has(component.id)) {
            appendError(errors, `components[${index}].id`, `duplicate id "${component.id}"`);
            return;
          }
          seenComponentIds.add(component.id);
        });
      }
    }

    if (manifest.events != null) {
      validateEvents(manifest.events, 'events', errors);
    }

    if (manifest.integrations != null) {
      if (!isPlainObject(manifest.integrations)) {
        appendError(errors, 'integrations', 'must be an object');
      } else {
        if (manifest.integrations.serverBaseUrl != null && typeof manifest.integrations.serverBaseUrl !== 'string') {
          appendError(errors, 'integrations.serverBaseUrl', 'must be a string when provided');
        }
        if (manifest.integrations.allowedActions != null) {
          if (!Array.isArray(manifest.integrations.allowedActions)) {
            appendError(errors, 'integrations.allowedActions', 'must be an array when provided');
          } else {
            manifest.integrations.allowedActions.forEach((action, index) => {
              if (typeof action !== 'string' || action.trim() === '') {
                appendError(errors, `integrations.allowedActions[${index}]`, 'must be a non-empty string');
              }
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  function assertValidAppManifest(manifest) {
    const result = validateAppManifest(manifest);
    if (!result.valid) {
      throw new Error(`Invalid app manifest:\n- ${result.errors.join('\n- ')}`);
    }
    return manifest;
  }

  return {
    APP_MANIFEST_VERSION,
    LIFECYCLE_EVENTS,
    validateAppManifest,
    assertValidAppManifest
  };
});
