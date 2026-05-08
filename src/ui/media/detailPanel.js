(function () {
  const vscode = acquireVsCodeApi();

  const $ = (id) => document.getElementById(id);

  const tabs = document.querySelectorAll(".tab");
  const panes = document.querySelectorAll("section[data-pane]");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panes.forEach((p) => p.classList.toggle("active", p.getAttribute("data-pane") === target));
    });
  });

  document.querySelectorAll("button.copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.getAttribute("data-copy");
      const pre = which === "req" ? $("req-body") : $("res-body");
      navigator.clipboard?.writeText(pre.textContent || "");
    });
  });

  $("copy-id").addEventListener("click", () => {
    navigator.clipboard?.writeText($("summary-id").textContent || "");
  });

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function fmtMs(n) {
    if (n < 1000) return n + " ms";
    return (n / 1000).toFixed(2) + " s";
  }

  function jsonHighlight(text) {
    if (!text) return "";
    // Minimal tokeniser. Order matters: strings first, then numbers, then booleans.
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(
        /"((?:\\.|[^"\\])*)"(\s*:)?/g,
        (_, body, colon) => colon ? `<span class="k">"${body}"</span>${colon}` : `<span class="s">"${body}"</span>`,
      )
      .replace(/\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, '<span class="n">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="b">$1</span>');
  }

  function renderKv(table, headers) {
    table.innerHTML = "";
    const entries = Object.entries(headers);
    if (entries.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.style.color = "var(--vscode-descriptionForeground)";
      td.style.fontStyle = "italic";
      td.textContent = "(none)";
      tr.appendChild(td);
      table.appendChild(tr);
      return entries.length;
    }
    for (const [k, v] of entries) {
      const tr = document.createElement("tr");
      const tdK = document.createElement("td");
      const tdV = document.createElement("td");
      tdK.textContent = k;
      tdV.textContent = v;
      tr.appendChild(tdK);
      tr.appendChild(tdV);
      table.appendChild(tr);
    }
    return entries.length;
  }

  function setBody(preEl, metaEl, body) {
    if (!body || body.bodyText === undefined) {
      preEl.innerHTML = '<span class="nl">(empty)</span>';
      metaEl.textContent = "";
      return;
    }
    preEl.innerHTML = jsonHighlight(body.bodyText);
    metaEl.textContent =
      fmtBytes(body.bodyBytes) + (body.truncated ? " · truncated" : "");
  }

  function renderTiming(rec) {
    const t = rec.timing;
    const total = t.totalMs || 1;
    const stages = [
      { key: "parse", label: "parse", from: t.receivedAt, to: t.bodyParsedAt },
      { key: "resolve", label: "resolve", from: t.bodyParsedAt, to: t.modelResolvedAt },
      { key: "upstream", label: "upstream", from: t.modelResolvedAt, to: t.upstreamSentAt },
      { key: "firstbyte", label: "first byte", from: t.upstreamSentAt, to: t.firstByteAt },
      { key: "body", label: "body", from: t.firstByteAt, to: t.lastByteAt },
    ];

    const bar = $("timing-bar");
    bar.innerHTML = "";
    let x = 0;
    for (const s of stages) {
      if (s.from === undefined || s.to === undefined) continue;
      const ms = Math.max(0, s.to - s.from);
      const pct = (ms / total) * 100;
      if (pct <= 0) continue;
      const seg = document.createElement("div");
      seg.className = "seg " + s.key;
      seg.style.left = x + "%";
      seg.style.width = pct + "%";
      seg.title = s.label + " — " + fmtMs(ms);
      bar.appendChild(seg);
      x += pct;
    }

    const table = $("timing-table");
    table.innerHTML = "";
    const rows = [
      ["Total", fmtMs(t.totalMs)],
      ["Received", new Date(t.receivedAt).toISOString()],
    ];
    for (const s of stages) {
      if (s.from === undefined || s.to === undefined) continue;
      rows.push([s.label, fmtMs(s.to - s.from)]);
    }
    for (const [k, v] of rows) {
      const tr = document.createElement("tr");
      const tdK = document.createElement("td");
      const tdV = document.createElement("td");
      tdK.textContent = k;
      tdV.textContent = v;
      tr.appendChild(tdK);
      tr.appendChild(tdV);
      table.appendChild(tr);
    }
  }

  // Parse a captured SSE chunk into one or more {event, data} pairs.
  function parseSseChunks(chunks) {
    const events = [];
    for (const chunk of chunks) {
      const blocks = chunk.split("\n\n").filter((b) => b.length > 0);
      for (const block of blocks) {
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += (data ? "\n" : "") + line.slice(6);
        }
        events.push({ event, data });
      }
    }
    return events;
  }

  function renderRawSse(chunks) {
    const events = parseSseChunks(chunks);
    const root = $("raw-events");
    root.innerHTML = "";
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      sum.innerHTML = `<span class="ev">${ev.event}</span> <span class="meta">#${i}</span>`;
      det.appendChild(sum);
      const pre = document.createElement("pre");
      try {
        pre.innerHTML = jsonHighlight(JSON.stringify(JSON.parse(ev.data), null, 2));
      } catch {
        pre.textContent = ev.data;
      }
      det.appendChild(pre);
      root.appendChild(det);
    }
    return events;
  }

  // Reconstruct the assembled Anthropic message from SSE chunks.
  function assembleMessage(chunks) {
    const events = parseSseChunks(chunks);
    let msg = null;
    for (const ev of events) {
      let payload;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (ev.event === "message_start" && payload.message) {
        msg = JSON.parse(JSON.stringify(payload.message));
        msg.content = [];
      } else if (ev.event === "content_block_start" && msg) {
        msg.content[payload.index] = JSON.parse(JSON.stringify(payload.content_block));
        if (msg.content[payload.index].type === "tool_use") {
          msg.content[payload.index]._inputJson = "";
        }
      } else if (ev.event === "content_block_delta" && msg) {
        const block = msg.content[payload.index];
        if (!block) continue;
        if (payload.delta?.type === "text_delta") {
          block.text = (block.text || "") + payload.delta.text;
        } else if (payload.delta?.type === "input_json_delta") {
          block._inputJson = (block._inputJson || "") + payload.delta.partial_json;
        }
      } else if (ev.event === "content_block_stop" && msg) {
        const block = msg.content[payload.index];
        if (block?.type === "tool_use" && block._inputJson) {
          try {
            block.input = JSON.parse(block._inputJson);
          } catch {
            // leave block.input as the empty {} from start
          }
          delete block._inputJson;
        }
      } else if (ev.event === "message_delta" && msg) {
        if (payload.delta?.stop_reason !== undefined) msg.stop_reason = payload.delta.stop_reason;
        if (payload.delta?.stop_sequence !== undefined) msg.stop_sequence = payload.delta.stop_sequence;
        if (payload.usage) msg.usage = payload.usage;
      }
    }
    return msg;
  }

  function applyRecord(rec) {
    $("summary-method").textContent = rec.method;
    $("summary-path").textContent = rec.path;
    const status = $("summary-status");
    status.textContent = String(rec.status);
    status.className = rec.status >= 400 ? "bad" : "ok";
    $("summary-duration").textContent = fmtMs(rec.timing.totalMs);
    $("summary-model").textContent = rec.model || "";
    $("summary-id").textContent = rec.id;

    // Request
    const reqHeadersCount = renderKv($("req-headers"), rec.request.headers);
    $("req-headers-count").textContent = reqHeadersCount + " " + (reqHeadersCount === 1 ? "header" : "headers");
    setBody($("req-body"), $("req-body-meta"), rec.request);

    // Response
    const resHeadersCount = renderKv($("res-headers"), rec.response.headers);
    $("res-headers-count").textContent = resHeadersCount + " " + (resHeadersCount === 1 ? "header" : "headers");
    $("res-status").textContent = "HTTP " + rec.response.statusCode;

    // Streaming responses build their body on the fly from sseChunks.
    let resBody = rec.response.bodyText !== undefined
      ? { bodyText: rec.response.bodyText, bodyBytes: rec.response.bodyBytes, truncated: rec.response.truncated }
      : null;

    if (rec.response.sseChunks && rec.response.sseChunks.length > 0) {
      const assembled = assembleMessage(rec.response.sseChunks);
      if (assembled) {
        const text = JSON.stringify(assembled, null, 2);
        resBody = { bodyText: text, bodyBytes: text.length, truncated: false };
      }
      $("tab-raw").hidden = false;
      renderRawSse(rec.response.sseChunks);
    } else {
      $("tab-raw").hidden = true;
    }

    setBody($("res-body"), $("res-body-meta"), resBody);

    // Timing
    renderTiming(rec);

    // Error
    if (rec.error) {
      $("tab-error").hidden = false;
      $("err-type").textContent = "type: " + rec.error.type;
      $("err-message").textContent = "message: " + rec.error.message;
      $("err-stack").textContent = rec.error.stack || "(no stack)";
    } else {
      $("tab-error").hidden = true;
    }
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg && msg.kind === "record") applyRecord(msg.record);
  });

  vscode.postMessage({ kind: "ready" });
})();
