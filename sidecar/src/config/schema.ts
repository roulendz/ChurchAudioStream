import { z } from "zod";
import { getDefaultInterface } from "../network/interfaces";

function resolveDefaultHost(): string {
  const defaultInterface = getDefaultInterface();
  return defaultInterface?.address ?? "127.0.0.1";
}

export const ServerSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7777),
  host: z.string().default(resolveDefaultHost),
  interface: z.string().optional(),
});

export const MdnsSchema = z.object({
  enabled: z.boolean().default(true),
  domain: z.string().default("churchaudio.local"),
});

export const HostsFileSchema = z.object({
  enabled: z.boolean().default(false),
  domain: z.string().default("churchaudio.local"),
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
