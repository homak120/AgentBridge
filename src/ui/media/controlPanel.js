(function () {
  const vscode = acquireVsCodeApi();

  const pill = document.getElementById("pill");
  const statusText = document.getElementById("status-text");
  const toggleBtn = document.getElementById("toggle");
  const endpointSection = document.getElementById("endpoint-section");
  const endpoint = document.getElementById("endpoint");
  const copyBtn = document.getElementById("copy");
  const portInput = document.getElementById("port");
  const applyPortBtn = document.getElementById("apply-port");
  const portHint = document.getElementById("port-hint");
  const activityList = document.getElementById("activity");
  const clearLogBtn = document.getElementById("clear-log");

  const STATE_LABEL = {
    stopped: "Stopped",
    starting: "Starting…",
    running: "Running",
    stopping: "Stopping…",
    error: "Error",
  };

  function applyState(payload) {
    const state = payload.state;

    pill.className = "pill " + state;
    statusText.textContent =
      state === "error" && payload.message
        ? "Error: " + payload.message
        : STATE_LABEL[state] || state;

    toggleBtn.textContent = state === "running" ? "Stop server" : "Start server";
    toggleBtn.disabled = state === "starting" || state === "stopping";

    const port = typeof payload.port === "number" ? payload.port : 3000;
    if (state === "running" || state === "stopping") {
      endpointSection.hidden = false;
      endpoint.textContent = "http://127.0.0.1:" + port;
      endpointSection.style.opacity = state === "stopping" ? "0.5" : "1";
    } else {
      endpointSection.hidden = true;
    }

    portHint.hidden = state !== "running";
    if (document.activeElement !== portInput) {
      portInput.value = String(port);
    }
  }

  function appendActivity(entry) {
    const li = document.createElement("li");
    if (entry.status >= 400) li.classList.add("error");
    li.dataset.id = entry.id;
    li.tabIndex = 0;
    li.title = "Click to open request detail";
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const meta =
      entry.status +
      " · " +
      entry.durationMs +
      "ms" +
      (entry.model ? " · " + entry.model : "");
    li.append(
      span(time),
      span(entry.method),
      span(entry.path),
      span(meta, "meta"),
    );
    li.addEventListener("click", () => {
      vscode.postMessage({ kind: "openDetail", id: entry.id });
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        vscode.postMessage({ kind: "openDetail", id: entry.id });
      }
    });
    activityList.insertBefore(li, activityList.firstChild);
    while (activityList.children.length > 50) {
      activityList.removeChild(activityList.lastChild);
    }
  }

  function span(text, className) {
    const el = document.createElement("span");
    el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  toggleBtn.addEventListener("click", () => vscode.postMessage({ kind: "toggle" }));
  copyBtn.addEventListener("click", () => vscode.postMessage({ kind: "copyEndpoint" }));
  applyPortBtn.addEventListener("click", () => {
    const v = Number(portInput.value);
    if (Number.isFinite(v) && v >= 1024 && v <= 65535) {
      vscode.postMessage({ kind: "setPort", port: v });
    }
  });
  clearLogBtn.addEventListener("click", () => {
    activityList.innerHTML = "";
    vscode.postMessage({ kind: "clearLog" });
  });

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || typeof msg.kind !== "string") return;
    if (msg.kind === "state") applyState(msg);
    else if (msg.kind === "request") appendActivity(msg.entry);
    else if (msg.kind === "logCleared") activityList.innerHTML = "";
  });

  vscode.postMessage({ kind: "ready" });
})();
