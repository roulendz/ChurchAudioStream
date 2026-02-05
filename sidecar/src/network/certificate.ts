import fs from "node:fs";
import path from "node:path";
import { generate } from "selfsigned";
import type { AppConfig } from "../config/schema";
import { listNetworkInterfaces } from "./interfaces";
import { logger } from "../utils/logger";

export interface CertificateCredentials {
  key: string;
  cert: string;
}

export async function loadOrGenerateCert(
  basePath: string,
  config: AppConfig,
): Promise<CertificateCredentials> {
  const certFilePath = path.join(basePath, config.certificate.certPath);
  const keyFilePath = path.join(basePath, config.certificate.keyPath);

  if (fs.existsSync(certFilePath) && fs.existsSync(keyFilePath)) {
    logger.info("Loading existing TLS certificate", {
      certPath: certFilePath,
      keyPath: keyFilePath,
    });
    return {
      cert: fs.readFileSync(certFilePath, "utf-8"),
      key: fs.readFileSync(keyFilePath, "utf-8"),
    };
  }

  logger.info("Generating new self-signed TLS certificate");
  const credentials = await generateCertificate(config);

  fs.writeFileSync(certFilePath, credentials.cert, "utf-8");
  fs.writeFileSync(keyFilePath, credentials.key, "utf-8");
  logger.info("TLS certificate saved to disk", {
    certPath: certFilePath,
    keyPath: keyFilePath,
  });

  return credentials;
}

async function generateCertificate(
  config: AppConfig,
): Promise<CertificateCredentials> {
  const domain = config.network.mdns.domain;
  const attributes = [{ name: "commonName", value: domain }];

  const localIpAddresses = listNetworkInterfaces().map(
    (iface) => iface.address,
  );

  const subjectAltNames = [
    { type: 2 as const, value: domain },
    { type: 2 as const, value: "localhost" },
    { type: 7 as const, ip: "127.0.0.1" },
    ...localIpAddresses.map((ip) => ({ type: 7 as const, ip })),
  ];

  const validityDays = 3650;
  const notBeforeDate = new Date();
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + validityDays);

  const pems = await generate(attributes, {
    keySize: 2048,
    notBeforeDate,
    notAfterDate,
    extensions: [
      {
        name: "subjectAltName",
        altNames: subjectAltNames,
      },
    ],
  });

  logger.info("Self-signed certificate generated", {
    commonName: domain,
    sanCount: subjectAltNames.length,
    validDays: validityDays,
  });

  return { key: pems.private, cert: pems.cert };
}
