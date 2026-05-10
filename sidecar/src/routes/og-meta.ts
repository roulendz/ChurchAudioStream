import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import type { Application } from "express";
import type { AppConfig } from "../config/schema";
import { logger } from "../utils/logger";

const OG_IMAGE_SIZE = 400;
const OG_TITLE = "Church Audio Stream";
const OG_DESCRIPTION = "Listen to live translations on your phone";

function buildListenerUrl(config: AppConfig): string {
  const hostname = config.network.domain || config.server.host;
  return `https://${hostname}:${config.server.port}`;
}

function buildOgTags(listenerUrl: string): string {
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${OG_TITLE}" />`,
    `<meta property="og:description" content="${OG_DESCRIPTION}" />`,
    `<meta property="og:url" content="${listenerUrl}" />`,
    `<meta property="og:image" content="${listenerUrl}/api/og-image.png" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_SIZE}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_SIZE}" />`,
  ].join("\n    ");
}

function injectOgTags(html: string, listenerUrl: string): string {
  return html.replace("</head>", `    ${buildOgTags(listenerUrl)}\n  </head>`);
}

async function generateQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: "png",
    width: OG_IMAGE_SIZE,
    margin: 2,
    color: { dark: "#1a1a2e", light: "#ffffff" },
  });
}

export async function registerOgRoutes(
  app: Application,
  staticDir: string,
  config: AppConfig,
): Promise<void> {
  const indexPath = path.join(staticDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    logger.warn(`No index.html at ${indexPath} — OG meta injection skipped`);
    return;
  }

  const listenerUrl = buildListenerUrl(config);
  const rawHtml = fs.readFileSync(indexPath, "utf-8");
  const ogHtml = injectOgTags(rawHtml, listenerUrl);
  const qrPng = await generateQrPng(listenerUrl);

  logger.info(`OG meta tags injected for ${listenerUrl}`);

  app.get("/api/og-image.png", (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400");
    res.type("image/png").send(qrPng);
  });

  app.get("/", (_req, res) => {
    res.type("html").send(ogHtml);
  });
}
