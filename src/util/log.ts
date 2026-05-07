import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("AgentBridge");
  }
  return channel;
}

export function log(line: string): void {
  const stamp = new Date().toISOString();
  getOutputChannel().appendLine(`[${stamp}] ${line}`);
}

export function disposeChannel(): void {
  channel?.dispose();
  channel = undefined;
}
