import * as vscode from "vscode";
import type { RequestRecord } from "../activity";

// Singleton webview panel reused across activity-row clicks.
export class DetailPanel {
  public static readonly viewType = "agentbridge.requestDetail";

  private static current: DetailPanel | undefined;

  static show(record: RequestRecord, extensionUri: vscode.Uri): void {
    if (DetailPanel.current) {
      DetailPanel.current.update(record);
      DetailPanel.current.panel.reveal(undefined, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DetailPanel.viewType,
      titleFor(record),
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out", "media")],
      },
    );
    DetailPanel.current = new DetailPanel(panel, extensionUri, record);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    initial: RequestRecord,
  ) {
    const mediaRoot = vscode.Uri.joinPath(extensionUri, "out", "media");
    panel.webview.html = renderHtml(panel.webview, mediaRoot);
    panel.webview.onDidReceiveMessage((msg: { kind?: string }) => {
      if (msg.kind === "ready") this.send(initial);
    });
    panel.onDidDispose(() => {
      if (DetailPanel.current === this) DetailPanel.current = undefined;
    });
  }

  update(record: RequestRecord): void {
    this.panel.title = titleFor(record);
    this.send(record);
  }

  private send(record: RequestRecord): void {
    this.panel.webview.postMessage({ kind: "record", record });
  }
}

function titleFor(record: RequestRecord): string {
  return `${record.method} ${record.path} · ${record.status}`;
}

function renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "detailPanel.css"));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "detailPanel.js"));
  const nonce = makeNonce();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>AgentBridge — Request</title>
</head>
<body>
  <header id="summary">
    <span id="summary-method"></span>
    <span id="summary-path"></span>
    <span id="summary-status"></span>
    <span id="summary-duration"></span>
    <span id="summary-model"></span>
    <span id="summary-id"></span>
    <button id="copy-id" class="ghost">copy id</button>
  </header>
  <nav id="tabs">
    <button class="tab active" data-tab="request">Request</button>
    <button class="tab" data-tab="response">Response</button>
    <button class="tab" data-tab="timing">Timing</button>
    <button class="tab" data-tab="raw" id="tab-raw" hidden>Raw SSE</button>
    <button class="tab" data-tab="error" id="tab-error" hidden>Error</button>
  </nav>
  <main>
    <section data-pane="request" class="active">
      <h2>Headers <span id="req-headers-count" class="meta"></span></h2>
      <table id="req-headers" class="kv"></table>
      <h2>Body <span id="req-body-meta" class="meta"></span> <button class="ghost copy" data-copy="req">copy</button></h2>
      <pre id="req-body" class="json"></pre>
    </section>
    <section data-pane="response">
      <h2>Status</h2>
      <div id="res-status"></div>
      <h2>Headers <span id="res-headers-count" class="meta"></span></h2>
      <table id="res-headers" class="kv"></table>
      <h2>Body <span id="res-body-meta" class="meta"></span> <button class="ghost copy" data-copy="res">copy</button></h2>
      <pre id="res-body" class="json"></pre>
    </section>
    <section data-pane="timing">
      <div id="timing-bar"></div>
      <table id="timing-table" class="kv"></table>
    </section>
    <section data-pane="raw">
      <p class="hint">Captured wire-format SSE chunks. Each chunk shown as parsed event + JSON.</p>
      <div id="raw-events"></div>
    </section>
    <section data-pane="error">
      <h2>Error</h2>
      <div id="err-type" class="kv-row"></div>
      <div id="err-message" class="kv-row"></div>
      <h3>Stack</h3>
      <pre id="err-stack"></pre>
    </section>
  </main>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
