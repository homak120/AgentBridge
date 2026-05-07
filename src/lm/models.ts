import * as vscode from "vscode";

export interface ModelInfo {
  id: string;
  display_name: string;
  family: string;
  vendor: string;
}

export async function listModels(): Promise<vscode.LanguageModelChat[]> {
  return vscode.lm.selectChatModels({ vendor: "copilot" });
}

export function describe(model: vscode.LanguageModelChat): ModelInfo {
  return {
    id: model.id,
    display_name: model.name ?? model.id,
    family: model.family ?? "",
    vendor: model.vendor ?? "",
  };
}

// Resolution per decision D9:
//   1. exact id match
//   2. case-insensitive prefix match in either direction
//   3. fall back to defaultModel (exact match)
//   4. null → caller returns 404
export async function resolveModel(
  requested: string,
  defaultModel: string | null,
): Promise<vscode.LanguageModelChat | null> {
  const models = await listModels();
  if (models.length === 0) return null;

  const exact = models.find((m) => m.id === requested);
  if (exact) return exact;

  const r = requested.toLowerCase();
  const prefix = models.find((m) => {
    const id = m.id.toLowerCase();
    return id.startsWith(r) || r.startsWith(id);
  });
  if (prefix) return prefix;

  if (defaultModel) {
    const fallback = models.find((m) => m.id === defaultModel);
    if (fallback) return fallback;
  }

  return null;
}
