import { describe, expect, it } from "vitest";
import { searchGuide } from "./search";
import { guideCategories, guideTopics } from "./topics";

describe("tutorial search", () => {
  it.each([
    ["几箱一托", "auto-pallet"],
    ["托脚", "feet"],
    ["为什么只装一层", "stack-pallets"],
    ["孤立整托", "isolate"],
    ["箱标图片", "marks"],
    ["唛头教程", "marks"],
    ["整体打托预览", "whole-preview"],
    ["装柜前移动", "whole-preview"],
    ["搜索箱位", "export"],
    ["折叠整托清单", "edit-pallet"],
    ["ＴＯＰ ＬＯＡＤ；一层", "stack-pallets"],
    ["扫码 离线交接", "scan"],
    ["MULTI-CONTAINER", "fleet"],
    ["shipping mark", "marks"],
    ["换柜", "fleet-replace"],
    ["原柜整托补入", "fleet-fill"],
    ["逐件核重", "fleet-handoff"],
  ])("ranks the relevant tutorial first for %s", (query, id) => {
    expect(searchGuide(query)[0]?.id).toBe(id);
  });

  it("browses the entire catalog and filters results by category", () => {
    expect(searchGuide("")).toEqual(guideTopics);
    expect(searchGuide(" !# ")).toHaveLength(guideTopics.length);
    for (const category of Object.keys(guideCategories) as (keyof typeof guideCategories)[]) {
      const topics = searchGuide("", category);
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.every(topic=>topic.category===category)).toBe(true);
    }
    expect(searchGuide("唛头","project")).toEqual([]);
    expect(searchGuide("xznothingxzyz")).toEqual([]);
  });

  it("contains a unique entry with a route and bilingual steps for each topic", () => {
    expect(new Set(guideTopics.map(topic=>topic.id)).size).toBe(guideTopics.length);
    for (const topic of guideTopics) {
      expect(topic.path.every(Boolean)).toBe(true);
      expect(topic.steps.length).toBeGreaterThanOrEqual(3);
      expect(topic.steps.every(step=>step.every(Boolean))).toBe(true);
    }
  });
});
