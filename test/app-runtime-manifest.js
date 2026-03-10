#!/usr/bin/env node

const { validateAppManifest, APP_MANIFEST_VERSION } = require('../src/app-runtime/manifest');
const { PAN_TOPICS, topicForLifecycleEvent, isKnownTopic } = require('../src/app-runtime/topics');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  OK  ${name}`);
  } else {
    failed++;
    console.error(`  ERR ${name}`);
  }
}

function validManifest() {
  return {
    schemaVersion: APP_MANIFEST_VERSION,
    app: { id: 'demo', name: 'Demo App' },
    components: [{ id: 'home-panel', tagName: 'tw-welcome-panel' }],
    integrations: {
      serverBaseUrl: 'http://localhost:3000/integrations',
      allowedActions: ['save_manifest']
    },
    navigation: [{ id: 'home', label: 'Home', componentId: 'home-panel' }]
  };
}

function testValidManifestPasses() {
  console.log('\n[manifest] valid payload');
  const result = validateAppManifest(validManifest());
  assert(result.valid === true, 'valid manifest returns valid=true');
  assert(result.errors.length === 0, 'valid manifest returns no errors');
}

function testInvalidManifestFails() {
  console.log('\n[manifest] invalid payload');
  const payload = validManifest();
  payload.schemaVersion = '2';
  payload.navigation = [{ id: 'broken', label: 'Broken' }];

  const result = validateAppManifest(payload);
  assert(result.valid === false, 'invalid manifest returns valid=false');
  assert(result.errors.some(error => error.includes('schemaVersion')), 'invalid schemaVersion is reported');
  assert(result.errors.some(error => error.includes('componentId or non-empty children')), 'missing component and children is reported');
}

function testTopicMapping() {
  console.log('\n[topics] lifecycle mapping');
  assert(topicForLifecycleEvent('onSave') === PAN_TOPICS.FORM_SAVE_REQUEST, 'onSave maps to form.save.request');
  assert(topicForLifecycleEvent('onAfterSave') === PAN_TOPICS.FORM_SAVE_SUCCESS, 'onAfterSave maps to form.save.success');
  assert(isKnownTopic(PAN_TOPICS.APP_NAV_OPEN) === true, 'known topic returns true');
  assert(isKnownTopic('unknown.topic') === false, 'unknown topic returns false');
}

function testIntegrationValidation() {
  console.log('\n[manifest] integrations validation');
  const payload = validManifest();
  payload.integrations.allowedActions = ['ok-action', ''];
  const result = validateAppManifest(payload);
  assert(result.valid === false, 'invalid integrations fail validation');
  assert(result.errors.some(error => error.includes('integrations.allowedActions')), 'invalid action string is reported');
}

function run() {
  console.log('App Runtime Contract Tests');
  testValidManifestPasses();
  testInvalidManifestFails();
  testTopicMapping();
  testIntegrationValidation();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
