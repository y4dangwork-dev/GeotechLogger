const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // tslib: add .default for ESM interop on web
  if (moduleName === 'tslib') {
    return { filePath: path.resolve(__dirname, 'shims/tslib.js'), type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
