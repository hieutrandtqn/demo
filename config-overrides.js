// config-overrides.js
const {
  override,
  addBabelPlugin,
  babelInclude,
  addBabelPreset,
} = require("customize-cra");
const path = require("path");

module.exports = override(
  addBabelPlugin("@babel/plugin-proposal-class-properties"),
  addBabelPlugin("@babel/plugin-transform-private-methods"),
  addBabelPlugin("babel-plugin-transform-bigint"),
  addBabelPlugin("@babel/plugin-syntax-jsx"),
  addBabelPreset("@babel/preset-react"),
  babelInclude([
    path.resolve("src"),
    path.resolve("node_modules/@yume-chan/"), // Include the specific package
    path.resolve("node_modules/@yume-chan/adb-daemon-webusb"),
  ])
);
