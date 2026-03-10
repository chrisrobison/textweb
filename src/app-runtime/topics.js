(function initTopicsModule(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.TextWebPanTopics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function topicsFactory() {
  const PAN_TOPICS = Object.freeze({
    APP_NAV_OPEN: 'app.nav.open',
    APP_TAB_OPEN: 'app.tab.open',
    APP_VIEW_LOAD: 'app.view.load',
    FORM_SAVE_REQUEST: 'form.save.request',
    FORM_SAVE_SUCCESS: 'form.save.success',
    FORM_SAVE_ERROR: 'form.save.error',
    INTEGRATION_SERVER_REQUEST: 'integration.server.request',
    INTEGRATION_SERVER_RESPONSE: 'integration.server.response'
  });

  const EVENT_TO_TOPIC = Object.freeze({
    onLoad: PAN_TOPICS.APP_VIEW_LOAD,
    onView: PAN_TOPICS.APP_VIEW_LOAD,
    onSave: PAN_TOPICS.FORM_SAVE_REQUEST,
    onBeforeSave: PAN_TOPICS.FORM_SAVE_REQUEST,
    onAfterSave: PAN_TOPICS.FORM_SAVE_SUCCESS
  });

  function allTopics() {
    return Object.values(PAN_TOPICS);
  }

  function isKnownTopic(topic) {
    return allTopics().includes(topic);
  }

  function topicForLifecycleEvent(eventName) {
    return EVENT_TO_TOPIC[eventName] || null;
  }

  return {
    PAN_TOPICS,
    EVENT_TO_TOPIC,
    allTopics,
    isKnownTopic,
    topicForLifecycleEvent
  };
});
