import * as vscode from "vscode";
import { ServerController } from "../serverController";
import { DetailPanel } from "./detailPanel";

type FromWebview =
  | { kind: "ready" }
  | { kind: "toggle" }
  | { kind: "setPort"; port: number }
  | { kind: "copyEndpoint" }
  | { kind: "clearLog" }
  | { kind: "openDetail"; id: string };

export class ControlPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agentbridge.controlPanel";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ServerController,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "out", "media");
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };
    view.webview.html = this.renderHtml(view.webview, mediaRoot);

    const stateSub = this.controller.onState((e) => {
      view.webview.postMessage({
        kind: "state",
        state: e.state,
        port: e.port,
        message: e.message,
      });
    });
    const requestSub = this.controller.onRequest((entry) => {
      view.webview.postMessage({ kind: "request", entry });
    });
    view.onDidDispose(() => {
      stateSub.dispose();
      requestSub.dispose();
    });

    view.webview.onDidReceiveMessage(async (raw: FromWebview) => {
      switch (raw.kind) {
        case "ready":
          view.webview.postMessage({
            kind: "state",
            state: this.controller.state,
            port: this.controller.port,
          });
          return;
        case "toggle":
          await this.controller.toggle();
          return;
        case "setPort":
          await vscode.workspace
            .getConfiguration("agentbridge")
            .update("port", raw.port, vscode.ConfigurationTarget.Global);
          return;
        case "copyEndpoint":
          await vscode.env.clipboard.writeText(`http://127.0.0.1:${this.controller.port}`);
          return;
        case "clearLog":
          this.controller.recorder.clear();
          view.webview.postMessage({ kind: "logCleared" });
          return;
        case "openDetail": {
          const record = this.controller.recorder.get(raw.id);
          if (record) {
            DetailPanel.show(record, this.extensionUri);
          } else {
            vscode.window.showInformationMessage(
              "This request is no longer in memory (oldest 50 are kept).",
            );
          }
          return;
        }
      }
    });
  }

  private renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "controlPanel.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "controlPanel.js"));
    const nonce = makeNonce();

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>AgentBridge</title>
</head>
<body>
  <main>
    <div class="status">
      <span id="pill" class="pill stopped" aria-hidden="true"></span>
      <span id="status-text">Stopped</span>
    </div>

    <button id="toggle" class="primary">Start server</button>

    <section id="endpoint-section" hidden>
      <h2>Endpoint</h2>
      <div class="row">
        <code id="endpoint">http://127.0.0.1:5173</code>
        <button id="copy">copy</button>
      </div>
    </section>

    <section>
      <h2>Port</h2>
      <div class="row">
        <input id="port" type="number" min="1024" max="65535" value="5173">
        <button id="apply-port">apply</button>
      </div>
      <p id="port-hint" class="hint" hidden>Restart server to apply.</p>
    </section>

    <section>
      <h2>Recent activity</h2>
      <ul id="activity"></ul>
      <button id="clear-log">Clear log</button>
    </section>
  </main>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
