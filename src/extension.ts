import * as vscode from "vscode";
import { ServerController } from "./serverController";
import { ControlPanelProvider } from "./ui/controlPanel";

// Lazy activation only — see decision D5.
// Triggered by onView:agentbridge.controlPanel; never starts the server itself.
export function activate(context: vscode.ExtensionContext): void {
  const controller = new ServerController({
    defaultModel: () =>
      vscode.workspace.getConfiguration("agentbridge").get<string | null>("defaultModel", null),
  });
  controller.setPort(readPortFromConfig());

  const provider = new ControlPanelProvider(context.extensionUri, controller);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ControlPanelProvider.viewType, provider),
    vscode.commands.registerCommand("agentbridge.start", () => controller.start()),
    vscode.commands.registerCommand("agentbridge.stop", () => controller.stop()),
    vscode.commands.registerCommand("agentbridge.toggle", () => controller.toggle()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("agentbridge.port")) {
        controller.setPort(readPortFromConfig());
      }
    }),
    controller,
  );
}

export async function deactivate(): Promise<void> {
  // ServerController is in subscriptions, so dispose() runs and closes the
  // socket. Nothing extra to do.
}

function readPortFromConfig(): number {
  return vscode.workspace.getConfiguration("agentbridge").get<number>("port", 3000);
}
