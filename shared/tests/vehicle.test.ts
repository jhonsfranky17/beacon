import { describe, expect, it } from "vitest";
import { normalizeVehicleNo } from "../src/vehicle";

describe("normalizeVehicleNo", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalizeVehicleNo("tn 09 gj 1234")).toBe("TN09GJ1234");
  });

  it("strips internal and surrounding whitespace, including tabs/newlines", () => {
    expect(normalizeVehicleNo("  tn09\tgj\n1234  ")).toBe("TN09GJ1234");
  });

  it("is idempotent on an already-normalized value", () => {
    expect(normalizeVehicleNo("TN09GJ1234")).toBe("TN09GJ1234");
  });
});
