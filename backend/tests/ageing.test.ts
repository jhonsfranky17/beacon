import { describe, expect, it } from "vitest";
import { isAgeing } from "../src/visits/ageing";

const HOUR_MS = 60 * 60 * 1000;

describe("isAgeing", () => {
  it("is false when gate_in_time is null (not yet arrived)", () => {
    expect(isAgeing(null, "NEEDS_TAGGING", 12)).toBe(false);
  });

  it("is false when the visit has EXITED, no matter how old gate_in_time is", () => {
    const veryOld = new Date(Date.now() - 100 * HOUR_MS);
    expect(isAgeing(veryOld, "EXITED", 12)).toBe(false);
  });

  it("is false just under the threshold", () => {
    const justUnder = new Date(Date.now() - (12 * HOUR_MS - 60_000));
    expect(isAgeing(justUnder, "ARRIVED", 12)).toBe(false);
  });

  it("is true just over the threshold", () => {
    const justOver = new Date(Date.now() - (12 * HOUR_MS + 60_000));
    expect(isAgeing(justOver, "ARRIVED", 12)).toBe(true);
  });

  it("is true for a visit well past the threshold, in any non-EXITED status", () => {
    const wayOver = new Date(Date.now() - 50 * HOUR_MS);
    for (const status of ["ARRIVED", "LOADING", "UNLOADING", "LOADED", "UNLOADED"] as const) {
      expect(isAgeing(wayOver, status, 12)).toBe(true);
    }
  });

  it("respects a per-plant threshold override", () => {
    const fifteenHoursAgo = new Date(Date.now() - 15 * HOUR_MS);
    expect(isAgeing(fifteenHoursAgo, "ARRIVED", 12)).toBe(true);
    expect(isAgeing(fifteenHoursAgo, "ARRIVED", 24)).toBe(false);
  });
});
