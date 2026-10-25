import { describe, expect, it } from "vitest";
import { isIosSafari, isStandalone } from "./install";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadOldSafari:
    "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ asks for the desktop site by default and reports a Mac.
  ipadDesktopSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.0.2592.56 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

describe("isIosSafari", () => {
  it("is true for Safari on iPhone and iPad", () => {
    expect(isIosSafari(UA.iphoneSafari, 5)).toBe(true);
    expect(isIosSafari(UA.ipadOldSafari, 5)).toBe(true);
  });

  it("treats a Mac user agent with a touch screen as iPadOS Safari", () => {
    expect(isIosSafari(UA.ipadDesktopSafari, 5)).toBe(true);
  });

  it("is false for Safari on a real Mac (no touch points)", () => {
    expect(isIosSafari(UA.ipadDesktopSafari, 0)).toBe(false);
  });

  it("is false for other iOS browsers and in-app web views", () => {
    expect(isIosSafari(UA.iphoneChrome, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneFirefox, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneEdge, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneInstagram, 5)).toBe(false);
  });

  it("is false on Android", () => {
    expect(isIosSafari(UA.androidChrome, 5)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is true when iOS says standalone or the display mode is standalone", () => {
    expect(isStandalone(true, false)).toBe(true);
    expect(isStandalone(undefined, true)).toBe(true);
  });

  it("is false in a browser tab", () => {
    expect(isStandalone(undefined, false)).toBe(false);
    expect(isStandalone(false, false)).toBe(false);
  });
});
