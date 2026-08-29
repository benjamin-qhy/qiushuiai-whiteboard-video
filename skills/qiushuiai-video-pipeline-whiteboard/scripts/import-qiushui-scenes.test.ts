import { describe, expect, test } from "bun:test";
import { locateCueRange } from "./import-qiushui-scenes";
import type { TimedCaption } from "./director";

describe("import qiushui scenes", () => {
  test("locates a copy snippet even when its opening words were split into the previous consumed cue", () => {
    const cues: TimedCaption[] = [
      { index: 1, startMs: 0, endMs: 1000, text: "Skill 主要解决前者。Sub" },
      { index: 2, startMs: 1000, endMs: 2000, text: "Agent 主要解决后者。具" },
      { index: 3, startMs: 2000, endMs: 3000, text: "体来说，可" },
      { index: 4, startMs: 3000, endMs: 4000, text: "以从三个场景判断使用 Skill 还是 Sub Agent。第" },
      { index: 5, startMs: 4000, endMs: 5000, text: "一，凡是要反复遵守的规则，优" },
      { index: 6, startMs: 5000, endMs: 6000, text: "先做成 Skill" },
    ];
    const snippet = "具体来说，可以从三个场景判断使用 Skill 还是 Sub Agent。\n\n第一，凡是要反复遵守的规则，优先做成 Skill。";
    expect(locateCueRange(cues, snippet, 2)).toEqual({ start: 2, end: 5 });
  });

  test("locates a copy snippet after a section heading was split across cue boundary", () => {
    const cues: TimedCaption[] = [
      { index: 1, startMs: 0, endMs: 1000, text: "去。第三，凡是需要并行或者权限边界的任" },
      { index: 2, startMs: 1000, endMs: 2000, text: "务，优先考虑 Sub Agent" },
      { index: 3, startMs: 2000, endMs: 3000, text: "。并行很好理" },
      { index: 4, startMs: 3000, endMs: 4000, text: "解。同一件" },
      { index: 5, startMs: 4000, endMs: 5000, text: "事，如果可以分几条线同时" },
      { index: 6, startMs: 5000, endMs: 6000, text: "看，就适合派 Sub Agent" },
    ];
    const snippet = "第三，凡是需要并行或者权限边界的任务，优先考虑 Sub Agent。\n\n并行很好理解。\n\n同一件事，如果可以分几条线同时看，就适合派 Sub Agent。";
    expect(locateCueRange(cues, snippet, 1)).toEqual({ start: 1, end: 5 });
  });
});
