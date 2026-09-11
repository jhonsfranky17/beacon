import { describe, expect, it } from "vitest";
import type { VisitStatus } from "@beacon/shared";
import { canTransition, nextStatusFor, type VisitAction } from "../src/visits/stateMachine";

const ALL_STATUSES: VisitStatus[] = [
  "NEEDS_TAGGING",
  "ARRIVED",
  "LOADING",
  "UNLOADING",
  "LOADED",
  "UNLOADED",
  "EXITED",
];

const VALID_TRANSITIONS: Record<VisitAction, VisitStatus[]> = {
  GATE_IN: ["NEEDS_TAGGING"],
  LOADING_START: ["ARRIVED"],
  LOADING_COMPLETE: ["LOADING", "UNLOADING"],
  EXIT: ["LOADED", "UNLOADED"],
};

describe("canTransition", () => {
  for (const action of Object.keys(VALID_TRANSITIONS) as VisitAction[]) {
    const valid = new Set(VALID_TRANSITIONS[action]);

    for (const status of ALL_STATUSES) {
      it(`${action} from ${status} is ${valid.has(status) ? "allowed" : "rejected"}`, () => {
        expect(canTransition(status, action)).toBe(valid.has(status));
      });
    }
  }
});

describe("nextStatusFor", () => {
  it("GATE_IN always yields ARRIVED, regardless of operation type", () => {
    expect(nextStatusFor("GATE_IN", "INBOUND")).toBe("ARRIVED");
    expect(nextStatusFor("GATE_IN", "OUTBOUND")).toBe("ARRIVED");
  });

  it("EXIT always yields EXITED, regardless of operation type", () => {
    expect(nextStatusFor("EXIT", "INBOUND")).toBe("EXITED");
    expect(nextStatusFor("EXIT", "OUTBOUND")).toBe("EXITED");
  });

  it("LOADING_START yields LOADING for OUTBOUND and UNLOADING for INBOUND", () => {
    expect(nextStatusFor("LOADING_START", "OUTBOUND")).toBe("LOADING");
    expect(nextStatusFor("LOADING_START", "INBOUND")).toBe("UNLOADING");
  });

  it("LOADING_COMPLETE yields LOADED for OUTBOUND and UNLOADED for INBOUND", () => {
    expect(nextStatusFor("LOADING_COMPLETE", "OUTBOUND")).toBe("LOADED");
    expect(nextStatusFor("LOADING_COMPLETE", "INBOUND")).toBe("UNLOADED");
  });
});
