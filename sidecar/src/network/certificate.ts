import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generate } from "selfsigned";
import type { AppConfig } from "../config/schema";
import { listNetworkInterfaces } from "./interfaces";
import { ensureCaReady } from "./trustedCa";
import { logger } from "../utils/logger";

export interface CertificateCredentials {
  key: string;
  cert: string;
}

/** Apple's maximum validity for trusted TLS certificates (days). */
const SERVER_CERT_VALIDITY_DAYS = 825;

/**
 * Load an existing server certificate or generate a new CA-signed one.
 *
 * Flow:
 *  1. Ensure the Root CA is on disk and trusted by the OS store.
 *  2. If a server cert exists AND passes validation (domain + issuer), reuse it.
 *  3. Otherwise generate a new server cert signed by the Root CA.
 *
 * The function signature and return type are unchanged so callers (server.ts)
 * require no modifications.
 */
export async function loadOrGenerateCert(
  basePath: string,
  config: AppConfig,
): Promise<CertificateCredentials> {
  const { caCert, caKey } = await ensureCaReady(basePath, config);

  const certFilePath = path.join(basePath, config.certificate.certPath);
  const keyFilePath = path.join(basePath, config.certificate.keyPath);

  if (fs.existsSync(certFilePath) && fs.existsSync(keyFilePath)) {
    const existingCertPem = fs.readFileSync(certFilePath, "utf-8");

    if (serverCertIsValid(existingCertPem, config.network.domain, caCert)) {
      logger.info("Loading existing CA-signed TLS certificate (domain and issuer match)", {
        certPath: certFilePath,
        keyPath: keyFilePath,
      });
      return {
        cert: existingCertPem,
        key: fs.readFileSync(keyFilePath, "utf-8"),
      };
    }

    logger.info(
      "Existing server certificate is stale (domain or issuer mismatch), regenerating",
      { configuredDomain: config.network.domain, certPath: certFilePath },
    );
  }

  logger.info("Generating new CA-signed server certificate");
  const credentials = await generateCaSignedCert(config, caCert, caKey);

  fs.writeFileSync(certFilePath, credentials.cert, "utf-8");
  fs.writeFileSync(keyFilePath, credentials.key, "utf-8");
  logger.info("CA-signed server certificate saved to disk", {
    certPath: certFilePath,
    keyPath: keyFilePath,
  });

  return credentials;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an existing server certificate:
 *  1. Contains the configured domain in its SANs
 *  2. Was signed by the current Root CA (issuer subject matches CA subject)
 *
 * Returns false if the cert cannot be parsed or either check fails.
 */
function serverCertIsValid(
  certPem: string,
  domain: string,
  caCertPem: string,
): boolean {
  try {
    const serverX509 = new crypto.X509Certificate(certPem);
    const caX509 = new crypto.X509Certificate(caCertPem);

    // Check domain is in SANs
    const sanField = serverX509.subjectAltName ?? "";
    const dnsEntries = sanField
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("DNS:"))
      .map((entry) => entry.slice(4));

    if (!dnsEntries.includes(domain)) {
      logger.info("Server cert SAN does not include configured domain", {
        domain,
        sans: dnsEntries,
      });
      return false;
    }

    // Check issuer matches CA subject (ensures cert was signed by current CA)
    if (serverX509.issuer !== caX509.subject) {
      logger.info("Server cert was not issued by current CA", {
        certIssuer: serverX509.issuer,
        caSubject: caX509.subject,
      });
      return false;
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to validate existing server certificate, will regenerate", {
      error: errorMessage,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// CA-Signed Certificate Generation
// ---------------------------------------------------------------------------

/**
 * Generate a server TLS certificate signed by the local Root CA.
 *
 * The certificate includes SANs for the configured domain, localhost,
 * 127.0.0.1, and all detected LAN IP addresses.
 */
async function generateCaSignedCert(
  config: AppConfig,
  caCert: string,
  caKey: string,
): Promise<CertificateCredentials> {
  const domain = config.network.domain;
  const attributes = [{ name: "commonName", value: domain }];

  const localIpAddresses = listNetworkInterfaces().map(
    (iface) => iface.address,
  );

  const subjectAltNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = [
    { type: 2 as const, value: domain },
    { type: 2 as const, value: "localhost" },
    { type: 7 as const, ip: "127.0.0.1" },
    ...localIpAddresses.map((ip) => ({ type: 7 as const, ip })),
  ];

  const notBeforeDate = new Date();
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + SERVER_CERT_VALIDITY_DAYS);

  const pems = await generate(attributes, {
    keySize: 2048,
    notBeforeDate,
    notAfterDate,
    extensions: [
      {
        name: "basicConstraints",
        cA: false,
      },
      {
        name: "subjectAltName",
        altNames: subjectAltNames,
      },
    ],
    ca: { cert: caCert, key: caKey },
  });

  logger.info("CA-signed server certificate generated", {
    commonName: domain,
    sanCount: subjectAltNames.length,
    validDays: SERVER_CERT_VALIDITY_DAYS,
  });

  return { key: pems.private, cert: pems.cert };
}
