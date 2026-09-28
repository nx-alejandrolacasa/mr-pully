// Build the zip from the dist/ directory produced by build.ts.
module.exports = {
  sourceDir: "./dist",
  build: {
    filename: "mr-pully-firefox-v{version}.zip",
    overwriteDest: true,
  },
};
