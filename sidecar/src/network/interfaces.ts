import os from "node:os";

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
  mac: string;
  internal: boolean;
}

export function listNetworkInterfaces(): NetworkInterfaceInfo[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkInterfaceInfo[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;
    for (const addr of addresses) {
      if (addr.family === "IPv4" && !addr.internal) {
        results.push({
          name,
          address: addr.address,
          family: addr.family as "IPv4",
          mac: addr.mac,
          internal: addr.internal,
        });
      }
    }
  }

  return results;
}

export function getDefaultInterface(): NetworkInterfaceInfo | undefined {
  const interfaces = listNetworkInterfaces();
  return interfaces[0];
}
