import { describe, expect, test } from "bun:test";
import { correctCueTextFromScript, parseSrt, retimeCues, sceneSrt, segmentRenderCues, spokenScript } from "./subtitles";

const sample = `1
00:00:00,200 --> 00:00:02,560
第一句

2
00:00:02,560 --> 00:00:05,080
第二句
`;

describe("subtitles", () => {
  test("parses and shifts scene timestamps", () => {
    const cues = parseSrt(sample);
    expect(cues).toHaveLength(2);
    expect(sceneSrt(cues, 1000, 5080)).toContain("00:00:00,000 --> 00:00:01,560");
    expect(sceneSrt(cues, 1000, 5080)).toContain("00:00:01,560 --> 00:00:04,080");
  });

  test("removes frontmatter and headings without rewriting narration", () => {
    expect(spokenScript("---\ntitle: x\n---\n# 标题\n第一句\n\n第二句")).toBe("第一句\n\n第二句");
  });

  test("retimes reviewed text with immutable word timestamps", () => {
    const words = JSON.stringify([
      { text: "第一句", start_time: 100, end_time: 1100, words: [
        { text: "第", start_time: 100, end_time: 300 },
        { text: "一", start_time: 300, end_time: 500 },
        { text: "句", start_time: 500, end_time: 1100 },
      ] },
      { text: "第二句", start_time: 2100, end_time: 4000, words: [
        { text: "第", start_time: 2100, end_time: 2300 },
        { text: "二", start_time: 2300, end_time: 2500 },
        { text: "句", start_time: 2500, end_time: 4000 },
      ] },
    ]);
    const cues = retimeCues(parseSrt(sample), words);
    expect(cues[0]).toMatchObject({ text: "第一句", startMs: 100, endMs: 1100 });
    expect(cues[1]).toMatchObject({ text: "第二句", startMs: 2100, endMs: 4000 });
    expect(sceneSrt(cues, 2100, 4000)).toContain("00:00:00,000 --> 00:00:01,900");
  });

  test("corrects subtitle text from script while preserving cue timing", () => {
    const cues = parseSrt(`1
00:00:00,120 --> 00:00:03,040
什么时候应该先用提示词上下文origin或者skills

2
00:00:03,040 --> 00:00:05,040
如果要针对公司内部数据写skill查询
`);
    const script = "什么时候应该先用提示词、上下文、RAG 或者 Skills。\n\n如果要针对公司内部数据写 SQL 查询。";
    const result = correctCueTextFromScript(cues, script);
    expect(result.changed).toBe(2);
    expect(result.cues.map((cue) => cue.text).join("")).toBe("什么时候应该先用提示词、上下文、RAG 或者 Skills。如果要针对公司内部数据写 SQL 查询。");
    expect(result.cues[0].startMs).toBe(120);
    expect(result.cues[0].endMs).toBe(3040);
    expect(result.cues[1].startMs).toBe(3040);
    expect(result.cues[1].endMs).toBe(5040);
  });

  test("segments social captions on immutable character timestamps", () => {
    const text = "很多人做AI智能体，一上来就在想怎么让它更强。真的可靠吗？";
    const timed = Array.from(text.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index) => ({ text: char, start_time: 100 + index * 200, end_time: 300 + index * 200 }));
    const words = JSON.stringify([{ text, start_time: 100, end_time: 100 + timed.length * 200, words: timed }]);
    const result = segmentRenderCues([{ index: 1, startMs: 0, endMs: 5000, text }], words);
    expect(result.length).toBeGreaterThan(1);
    expect(result.map((cue) => cue.text).join("")).toBe("很多人做AI智能体一上来就在想怎么让它更强真的可靠吗");
    expect(result.every((cue) => cue.endMs > cue.startMs)).toBe(true);
    expect(result.every((cue, index) => index === 0 || cue.startMs >= result[index - 1].endMs)).toBe(true);
    expect(result.every((cue) => !/[\p{P}\p{S}]/u.test(cue.text))).toBe(true);
    expect(result.map((cue) => cue.text)).toEqual(["很多人做AI智能体", "一上来就在想怎么让它更强", "真的可靠吗"]);
    expect(result[0].startMs).toBe(100);
    expect(result.at(-1)?.endMs).toBe(100 + timed.length * 200);
  });

  test("always breaks on comma-like punctuation including dunhao", () => {
    const text = "第一段，第二段、第三段。第四段！第五段？";
    const timed = Array.from(text.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index) => ({ text: char, start_time: 100 + index * 100, end_time: 200 + index * 100 }));
    const words = JSON.stringify([{ text, start_time: 100, end_time: 100 + timed.length * 100, words: timed }]);
    const result = segmentRenderCues([{ index: 1, startMs: 100, endMs: 100 + timed.length * 100, text }], words);
    expect(result.map((cue) => cue.text)).toEqual(["第一段", "第二段", "第三段", "第四段", "第五段"]);
  });

  test("removes all display punctuation inside rendered captions", () => {
    const text = "这不是A/B测试，而是“先小跑”：别急。";
    const timed = Array.from(text.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index) => ({ text: char, start_time: 100 + index * 100, end_time: 200 + index * 100 }));
    const words = JSON.stringify([{ text, start_time: 100, end_time: 100 + timed.length * 100, words: timed }]);
    const result = segmentRenderCues([{ index: 1, startMs: 100, endMs: 100 + timed.length * 100, text }], words);
    expect(result.map((cue) => cue.text)).toEqual(["这不是AB测试", "而是先小跑别急"]);
    expect(result.every((cue) => !/[\p{P}\p{S}]/u.test(cue.text))).toBe(true);
  });

  test("uses script punctuation when subtitle text has already lost punctuation", () => {
    const script = "这期视频我们完整的介绍一下。\n\n先看一个简单的任务。\n\n假设我们让AI帮忙做一份客户跟进报告。";
    const subtitleText = "这期视频我们完整的介绍一下先看一个简单的任务假设我们让AI帮忙做一份客户跟进报告";
    const timed = Array.from(subtitleText).map((char, index) => ({ text: char, start_time: 100 + index * 120, end_time: 220 + index * 120 }));
    const words = JSON.stringify([{ text: subtitleText, start_time: 100, end_time: 100 + timed.length * 120, words: timed }]);
    const result = segmentRenderCues([{ index: 1, startMs: 100, endMs: 100 + timed.length * 120, text: subtitleText }], words, script);
    expect(result.map((cue) => cue.text)).toEqual([
      "这期视频我们完整的介绍一下",
      "先看一个简单的任务",
      "假设我们让AI帮忙做一份客户跟进报告",
    ]);
    expect(result.every((cue) => !/[\p{P}\p{S}]/u.test(cue.text))).toBe(true);
    expect(result.every((cue) => cue.endMs > cue.startMs)).toBe(true);
  });

  test("can merge neighboring cues into one rendered caption when the phrase is continuous", () => {
    const text1 = "第一句";
    const text2 = "第二句开始";
    const words = JSON.stringify([
      { text: text1, start_time: 100, end_time: 1100, words: Array.from(text1.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index, arr) => ({ text: char, start_time: 100 + index * 250, end_time: 100 + (index + 1) * 250 + (index === arr.length - 1 ? 250 : 0) })) },
      { text: text2, start_time: 2100, end_time: 3600, words: Array.from(text2.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index) => ({ text: char, start_time: 2100 + index * 250, end_time: 2350 + index * 250 })) },
    ]);
    const cues = segmentRenderCues([
      { index: 1, startMs: 100, endMs: 1100, text: text1 },
      { index: 2, startMs: 2100, endMs: 3600, text: text2 },
    ], words);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("第一句第二句开始");
    expect(cues[0].startMs).toBe(100);
    expect(cues[0].endMs).toBe(3350);
  });

  test("still breaks on forced punctuation across neighboring cues", () => {
    const text1 = "第一句。";
    const text2 = "第二句开始";
    const words = JSON.stringify([
      { text: text1, start_time: 100, end_time: 1100, words: Array.from(text1.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index, arr) => ({ text: char, start_time: 100 + index * 250, end_time: 100 + (index + 1) * 250 + (index === arr.length - 1 ? 250 : 0) })) },
      { text: text2, start_time: 2100, end_time: 3600, words: Array.from(text2.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index) => ({ text: char, start_time: 2100 + index * 250, end_time: 2350 + index * 250 })) },
    ]);
    const cues = segmentRenderCues([
      { index: 1, startMs: 100, endMs: 1100, text: text1 },
      { index: 2, startMs: 2100, endMs: 3600, text: text2 },
    ], words);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("第一句");
    expect(cues[1].text).toBe("第二句开始");
  });

  test("keeps ascii words intact when splitting rendered captions", () => {
    const text = "先给自己做一个小型的每日简报agent然后再确认";
    const timed = Array.from(text.replace(/[^\p{L}\p{N}]+/gu, "")).map((char, index) => ({ text: char, start_time: 100 + index * 120, end_time: 220 + index * 120 }));
    const words = JSON.stringify([{ text, start_time: 100, end_time: 100 + timed.length * 120, words: timed }]);
    const result = segmentRenderCues([{ index: 1, startMs: 100, endMs: 100 + timed.length * 120, text }], words);
    expect(result.map((cue) => cue.text).join("")).toBe("先给自己做一个小型的每日简报agent然后再确认");
    expect(result.every((cue) => !/agen$|^t/.test(cue.text))).toBe(true);
  });
});
