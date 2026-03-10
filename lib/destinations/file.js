"use strict";

async function deliverExportToFile(result) {
  return {
    ok: true,
    destination: "file",
    outputPath: result.outputPath,
    count: result.count,
  };
}

module.exports = {
  deliverExportToFile,
};
