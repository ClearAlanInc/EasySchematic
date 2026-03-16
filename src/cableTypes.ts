import type { SignalType } from "./types";

/** Maps each signal type to a physical cable type label for pack lists */
export const SIGNAL_TO_CABLE: Record<SignalType, string> = {
  sdi: "SDI",
  genlock: "SDI",
  composite: "Composite",
  ndi: "Ethernet",
  dante: "Ethernet",
  ethernet: "Ethernet",
  srt: "Ethernet",
  hdbaset: "Ethernet",
  "analog-audio": "Analog Audio",
  aes: "AES",
  rs422: "DB9",
  serial: "DB9",
  hdmi: "HDMI",
  displayport: "DisplayPort",
  usb: "USB",
  fiber: "Fiber",
  thunderbolt: "Thunderbolt",
  vga: "VGA",
  power: "Power",
  gpio: "GPIO",
  custom: "Other",
};
