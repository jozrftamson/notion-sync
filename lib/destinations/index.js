"use strict";

const { deliverExportToFile } = require("./file");

function resolveExportDestination(options) {
  if (options.destination) {
    return options.destination;
  }
  if (options.sendToNotion) {
    return "notion";
  }
  if (options.sendRemote) {
    return "remote";
  }
  return "file";
}

async function deliverCodexExport(result, handlers) {
  const destination = result.destination || "file";

  if (destination === "file") {
    return deliverExportToFile(result);
  }
  if (destination === "notion") {
    const pageId = await handlers.toNotion(result);
    return {
      ok: true,
      destination,
      pageId,
      url: handlers.getNotionPageUrl(pageId),
      outputPath: result.outputPath,
      count: result.count,
    };
  }
  if (destination === "remote") {
    const remoteResult = await handlers.toRemote(result);
    return {
      ok: true,
      destination,
      ...remoteResult,
      outputPath: result.outputPath,
      count: result.count,
    };
  }

  throw new Error(`Unsupported destination: ${destination}`);
}

module.exports = {
  resolveExportDestination,
  deliverCodexExport,
};
