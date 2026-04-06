import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeSharedGuideStatus,
  inspectSharedGuideOwnership,
  renderSharedGuide,
  resolveSharedGuideTargetPath
} from "../src/shared-guide.js";

describe("shared SIFT guide", () => {
  it("resolves repo and global guide paths", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "sift-guide-cwd-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "sift-guide-home-"));

    expect(resolveSharedGuideTargetPath({ scope: "repo", cwd })).toBe(path.join(cwd, "SIFT.md"));
    expect(resolveSharedGuideTargetPath({ scope: "global", homeDir: home })).toBe(
      path.join(home, ".config", "sift", "SIFT.md")
    );
  });

  it("detects managed and custom guide ownership", () => {
    expect(inspectSharedGuideOwnership(undefined)).toBe("missing");
    expect(inspectSharedGuideOwnership(renderSharedGuide())).toBe("managed");
    expect(inspectSharedGuideOwnership("# custom\n")).toBe("custom");
    expect(describeSharedGuideStatus(renderSharedGuide(), "/tmp/SIFT.md")).toContain("installed");
  });

  it("renders a mode-neutral detailed guide", () => {
    const guide = renderSharedGuide();

    expect(guide).toContain("<!-- sift:generated shared-guide -->");
    expect(guide).toContain("# Sift Guide");
    expect(guide).toContain("This guide is mode-neutral.");
    expect(guide).toContain("sift rerun --remaining --detail focused");
    expect(guide).toContain("read_targets.anchor_kind=traceback");
  });
});
