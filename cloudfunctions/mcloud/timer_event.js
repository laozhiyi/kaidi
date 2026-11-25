'use strict';

// Event shape recognition only; trusted caller authorization remains in timer_entry.
function normalize(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const type = event.Type === undefined ? event.type : event.Type;
  if (typeof type !== 'string' || type.trim().toLowerCase() !== 'timer') return null;
  const trigger = event.TriggerName === undefined ? event.triggerName : event.TriggerName;
  return { Type: 'Timer', TriggerName: typeof trigger === 'string' ? trigger : '' };
}

module.exports = { normalize };
