// Build the zip from the dist/ directory produced by build.ts.
module.exports = {
  sourceDir: "./dist",
  build: {
    filename: "mr-pully-chrome-v{version}.zip",
    overwriteDest: true,
  },
};
