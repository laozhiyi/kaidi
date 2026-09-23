'use strict';
// Request-local identity/session metadata; never sourced from form parameters.
const { AsyncLocalStorage } = require('async_hooks');
module.exports = new AsyncLocalStorage();
