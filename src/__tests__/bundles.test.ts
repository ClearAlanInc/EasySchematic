import { describe, it, expect } from "vitest";
import { gcBundles, bundleMembers, newBundleId } from "../bundles";

const edge = (id: string, bundleId?: string) =>
  ({ id, source: "a", target: "b", data: { signalType: "sdi", ...(bundleId ? { bundleId } : {}) } }) as any;

describe("gcBundles", () => {
  it("keeps bundles with >=2 members, dissolves the rest", () => {
    const edges = [edge("e1", "b1"), edge("e2", "b1"), edge("e3", "b2")];
    const { edges: out, bundles } = gcBundles(edges, { b1: { id: "b1" }, b2: { id: "b2" } });
    expect(Object.keys(bundles)).toEqual(["b1"]);
    expect(bundleMembers(out, "b1").length).toBe(2);
    expect(out.find((e) => e.id === "e3")!.data?.bundleId).toBeUndefined();
  });
  it("drops bundleId referencing a bundle with no meta", () => {
    const edges = [edge("e1", "ghost"), edge("e2", "ghost")];
    const { edges: out, bundles } = gcBundles(edges, {});
    expect(bundles).toEqual({});
    expect(out.every((e) => e.data?.bundleId === undefined)).toBe(true);
  });
  it("newBundleId is unique", () => expect(newBundleId()).not.toBe(newBundleId()));
});
