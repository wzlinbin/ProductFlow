import { describe, expect, it } from "vitest";

import {
  buildConnectionDragPath,
  getFinalNodeDragPosition,
  getNodeDragPositions,
  getNodePositionForViewportCenter,
  getWheelZoom,
  normalizeWorkflowZoom,
} from "./useWorkflowCanvas";

const baseConnectionDrag = {
  sourceNodeId: "source",
  pointerId: 1,
  from: { x: 10, y: 20 },
  to: { x: 250, y: 80 },
};

describe("workflow canvas pure helpers", () => {
  it("normalizes zoom precision and clamps to configured bounds", () => {
    expect(normalizeWorkflowZoom(0.1)).toBe(0.5);
    expect(normalizeWorkflowZoom(2)).toBe(1.6);
    expect(normalizeWorkflowZoom(1.234567)).toBe(1.2346);
  });

  it("calculates anchored wheel zoom direction without exceeding bounds", () => {
    expect(getWheelZoom(1, 120)).toBeLessThan(1);
    expect(getWheelZoom(1, -120)).toBeGreaterThan(1);
    expect(getWheelZoom(0.5, 10_000)).toBe(0.5);
    expect(getWheelZoom(1.6, -10_000)).toBe(1.6);
  });

  it("rounds final drag positions and keeps nodes inside the canvas minimum", () => {
    expect(getFinalNodeDragPosition({ x: 54.6, y: 75.4 }, { offsetX: 10.2, offsetY: 20.8 })).toEqual({
      x: 44,
      y: 55,
    });
    expect(getFinalNodeDragPosition({ x: 12, y: 12 }, { offsetX: 30, offsetY: 40 })).toEqual({
      x: 24,
      y: 24,
    });
  });

  it("moves selected node groups by a shared rounded delta", () => {
    expect(
      getNodeDragPositions(
        { x: 177.4, y: 230.8 },
        {
          nodeId: "a",
          offsetX: 7.4,
          offsetY: 10.8,
          originPositions: {
            a: { x: 100, y: 120 },
            b: { x: 360, y: 240 },
          },
        },
      ),
    ).toEqual({
      a: { x: 170, y: 220 },
      b: { x: 430, y: 340 },
    });
  });

  it("clamps selected node groups without changing their relative spacing", () => {
    expect(
      getNodeDragPositions(
        { x: -100, y: -80 },
        {
          nodeId: "a",
          offsetX: 10,
          offsetY: 10,
          originPositions: {
            a: { x: 100, y: 120 },
            b: { x: 40, y: 70 },
          },
        },
      ),
    ).toEqual({
      a: { x: 84, y: 74 },
      b: { x: 24, y: 24 },
    });
  });

  it("positions new nodes around the current viewport center", () => {
    expect(getNodePositionForViewportCenter({ x: 640, y: 360 })).toEqual({ x: 516, y: 280 });
    expect(getNodePositionForViewportCenter({ x: 60, y: 70 })).toEqual({ x: 24, y: 24 });
  });

  it("builds the temporary connection drag path with the wider midpoint rule", () => {
    expect(buildConnectionDragPath(baseConnectionDrag)).toBe("M 10 20 C 130 20, 130 80, 250 80");
    expect(buildConnectionDragPath({ ...baseConnectionDrag, to: { x: 50, y: 90 } })).toBe(
      "M 10 20 C 90 20, -30 90, 50 90",
    );
  });
});
