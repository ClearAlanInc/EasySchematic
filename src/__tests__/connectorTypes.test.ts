import { describe, it, expect } from "vitest";
import {
  areConnectorsCompatible,
  needsAdapter,
  CONNECTOR_TO_CABLE,
  CONNECTOR_GENDER,
  CONNECTORS_WITH_GENDER_VARIATION,
} from "../connectorTypes";
import { CONNECTOR_LABELS, CONNECTOR_GROUPS } from "../types";

describe("1/4\" TS connector (#208)", () => {
  it("has a dropdown label, cable name, and the 6.35mm naming on TRS", () => {
    expect(CONNECTOR_LABELS["ts-quarter"]).toBe('1/4" TS (6.35mm)');
    expect(CONNECTOR_LABELS["trs-quarter"]).toBe('1/4" TRS (6.35mm)');
    expect(CONNECTOR_TO_CABLE["ts-quarter"]).toBe('1/4" TS');
  });

  it("appears in the Audio connector group next to TRS", () => {
    expect(CONNECTOR_GROUPS["Audio"]).toContain("ts-quarter");
  });

  it("mates with 1/4\" TRS natively — same barrel, no adapter", () => {
    expect(areConnectorsCompatible("ts-quarter", "trs-quarter")).toBe(true);
    expect(needsAdapter("ts-quarter", "trs-quarter")).toBe(false);
  });

  it("plugs into a combo XLR/TRS jack natively", () => {
    expect(areConnectorsCompatible("ts-quarter", "combo-xlr-trs")).toBe(true);
    expect(needsAdapter("ts-quarter", "combo-xlr-trs")).toBe(false);
  });

  it("needs an adapter to reach XLR or 3.5mm", () => {
    expect(areConnectorsCompatible("ts-quarter", "xlr-3")).toBe(true);
    expect(needsAdapter("ts-quarter", "xlr-3")).toBe(true);
    expect(needsAdapter("ts-quarter", "trs-eighth")).toBe(true);
  });

  it("carries a device-side gender and exposes a manual override", () => {
    expect(CONNECTOR_GENDER["ts-quarter"]).toBe("female");
    expect(CONNECTORS_WITH_GENDER_VARIATION.has("ts-quarter")).toBe(true);
  });
});
