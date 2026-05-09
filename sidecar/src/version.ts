import crypto from "node:crypto";

export const SIDECAR_VERSION = "0.1.3";

export const SERVER_INSTANCE_ID = crypto.randomBytes(4).toString("hex");
