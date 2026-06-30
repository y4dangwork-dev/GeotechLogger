// Load real tslib directly (avoid circular resolution)
const tslib = require('../node_modules/tslib/tslib.js');
module.exports = Object.assign({}, tslib, { default: tslib });
