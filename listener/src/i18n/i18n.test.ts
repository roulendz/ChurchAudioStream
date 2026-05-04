import { describe, it, expect, beforeEach } from "vitest";
import i18n from "./init";

describe("i18n", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("resolves English keys correctly", () => {
    expect(i18n.t("player.startListening")).toBe("Start Listening");
    expect(i18n.t("channelList.title")).toBe("Channels");
    expect(i18n.t("offline.retry")).toBe("Try Again");
  });

  it("resolves Spanish keys after language switch", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.t("player.startListening")).toBe("Comenzar a Escuchar");
    expect(i18n.t("channelList.title")).toBe("Canales");
  });

  it("resolves Latvian keys after language switch", async () => {
    await i18n.changeLanguage("lv");
    expect(i18n.t("player.startListening")).toBe("Sakt klausities");
    expect(i18n.t("channelList.title")).toBe("Kanali");
  });

  it("falls back to English for unknown language", async () => {
    await i18n.changeLanguage("xx");
    expect(i18n.t("player.startListening")).toBe("Start Listening");
  });

  it("interpolates count variable", () => {
    expect(i18n.t("channel.listeningCount", { count: 5 })).toBe("5 listening");
  });

  it("all English keys are present (no undefined returns)", () => {
    const enKeys = Object.keys(
      i18n.getResourceBundle("en", "translation"),
    );
    for (const key of enKeys) {
      const value = i18n.t(key);
      expect(value).not.toBe(key);
    }
  });

  it("Spanish and Latvian have same key count as English", () => {
    const enKeys = Object.keys(i18n.getResourceBundle("en", "translation"));
    const esKeys = Object.keys(i18n.getResourceBundle("es", "translation"));
    const lvKeys = Object.keys(i18n.getResourceBundle("lv", "translation"));
    expect(esKeys.length).toBe(enKeys.length);
    expect(lvKeys.length).toBe(enKeys.length);
  });
});
