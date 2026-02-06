import { z } from "zod";
import { getDefaultInterface } from "../network/interfaces";

function resolveDefaultHost(): string {
  const defaultInterface = getDefaultInterface();
  return defaultInterface?.address ?? "127.0.0.1";
}

/**
 * Port reserved for the admin loopback HTTP server.
 * Must match ADMIN_LOOPBACK_PORT in server.ts.
 * The HTTPS port cannot be set to this value to avoid a bind collision.
 */
const RESERVED_ADMIN_LOOPBACK_PORT = 7778;

export const ServerSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7777)
    .refine(
      (port) => port !== RESERVED_ADMIN_LOOPBACK_PORT,
      { message: `Port ${RESERVED_ADMIN_LOOPBACK_PORT} is reserved for the admin loopback server` },
    ),
  host: z.string().default(resolveDefaultHost),      // Advertised host (mDNS, cert SANs, display)
  listenHost: z.string().default("0.0.0.0"),          // Actual bind address (all interfaces)
  interface: z.string().optional(),
});

export const MdnsSchema = z.object({
  enabled: z.boolean().default(true),
  domain: z.string().default("church.audio"),
});

export const HostsFileSchema = z.object({
  enabled: z.boolean().default(true),
  domain: z.string().default("church.audio"),
});

export const NetworkSchema = z.object({
  mdns: MdnsSchema.default(() => MdnsSchema.parse({})),
  hostsFile: HostsFileSchema.default(() => HostsFileSchema.parse({})),
});

export const CertificateSchema = z.object({
  certPath: z.string().default("cert.pem"),
  keyPath: z.string().default("key.pem"),
});

export const ConfigSchema = z.object({
  server: ServerSchema.default(() => ServerSchema.parse({})),
  network: NetworkSchema.default(() => NetworkSchema.parse({})),
  certificate: CertificateSchema.default(() => CertificateSchema.parse({})),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
