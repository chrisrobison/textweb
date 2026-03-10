#!/usr/bin/env node

const http = require('http');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createServer } = require('../src/server');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`  ERR ${name}`);
  }
}

function postJSON(port, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data || '{}');
        } catch (error) {
          parsed = { raw: data };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function makeManifest() {
  return {
    schemaVersion: '1',
    app: { id: 'demo-runtime', name: 'Demo Runtime' },
    components: [
      { id: 'welcome-panel', tagName: 'tw-welcome-panel' }
    ],
    navigation: [
      { id: 'home', label: 'Home', componentId: 'welcome-panel' }
    ]
  };
}

async function run() {
  console.log('Runtime Integrations Test');

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'textweb-runtime-'));
  const server = createServer({ appRuntimeDir: tmp });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    console.log('\n[integrations] sync_saved_form');
    const syncRes = await postJSON(port, '/integrations/sync_saved_form', {
      componentId: 'employee-form',
      label: 'Employee Form',
      schema: [{ name: 'employee_name', type: 'text' }]
    });

    assert(syncRes.status === 200, 'sync_saved_form returns 200');
    assert(syncRes.body.success === true, 'sync_saved_form success=true');

    const generatedPath = path.join(tmp, 'generated-components.json');
    const generated = JSON.parse(await fs.readFile(generatedPath, 'utf8'));
    assert(Array.isArray(generated) && generated.length === 1, 'generated components persisted');
    assert(generated[0].id === 'employee-form', 'generated component id persisted');

    console.log('\n[integrations] save_manifest');
    const saveManifestRes = await postJSON(port, '/integrations/save_manifest', {
      manifest: makeManifest()
    });

    assert(saveManifestRes.status === 200, 'save_manifest returns 200');
    assert(saveManifestRes.body.success === true, 'save_manifest success=true');

    const manifestPath = path.join(tmp, 'manifests', 'demo-runtime.json');
    const manifestOnDisk = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert(manifestOnDisk.app.id === 'demo-runtime', 'manifest persisted to disk');

    console.log('\n[integrations] upsert_nav_item');
    const upsertRes = await postJSON(port, '/integrations/upsert_nav_item', {
      manifest: makeManifest(),
      parentId: null,
      navItem: {
        id: 'saved-employee-form',
        label: 'Employee Form',
        componentId: 'employee-form'
      }
    });

    assert(upsertRes.status === 200, 'upsert_nav_item returns 200');
    assert(upsertRes.body.success === true, 'upsert_nav_item success=true');
    assert(upsertRes.body.result.navItemId === 'saved-employee-form', 'upsert_nav_item id returned');

    console.log('\n[integrations] unknown action');
    const unknownRes = await postJSON(port, '/integrations/not_real', {});
    assert(unknownRes.status === 404, 'unknown action returns 404');
    assert(String(unknownRes.body.error || '').includes('Unknown integration action'), 'unknown action error text');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
