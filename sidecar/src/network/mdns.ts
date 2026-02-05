import { Bonjour } from "bonjour-service";
import { logger } from "../utils/logger";

let bonjourInstance: InstanceType<typeof Bonjour> | null = null;

export function publishService(port: number, domain: string): void {
  unpublishService();

  bonjourInstance = new Bonjour();
  const serviceName = domain.replace(".local", "");

  bonjourInstance.publish({
    name: serviceName,
    type: "http",
    port,
    txt: {
      path: "/",
      protocol: "https",
    },
  });

  logger.info("mDNS service published", {
    name: serviceName,
    type: "_http._tcp",
    port,
    domain,
  });
}

export function unpublishService(): void {
  if (bonjourInstance) {
    bonjourInstance.unpublishAll();
    bonjourInstance.destroy();
    bonjourInstance = null;
    logger.info("mDNS service unpublished");
  }
}
