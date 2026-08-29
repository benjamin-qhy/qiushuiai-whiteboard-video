import type { Scene } from "./director";

export type SemanticAudit = {
  ok: boolean;
  reasons: string[];
  matched_elements: string[];
  missing_elements: string[];
  distracting_elements: string[];
  score: number;
};

export async function auditSceneSemantics(_imagePath: string, _scene: Scene): Promise<SemanticAudit> {
  throw new Error(
    "视觉语义审核已迁移为运行时能力：请由运行时代理使用当前运行时模型读取场景图片并写入 scene/scene-NN/画面语义审核.json，本地脚本不再内置视觉 API 调用。",
  );
}
