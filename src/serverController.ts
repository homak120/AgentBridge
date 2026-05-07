import type { Server } from "node:http";
import { EventEmitter } from "vscode";
import { buildApp } from "./server";

export type ServerState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface StateEvent {
  state: ServerState;
  port: number;
  message?: string;
}

export interface ActivityEntry {
  timestamp: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  model?: string;
}

const HOST = "127.0.0.1"; // decision D7 — never bind any other interface.
const STOP_DRAIN_TIMEOUT_MS = 5000;

export interface ServerControllerOptions {
  defaultModel?: () => string | null;
}

export class ServerController {
  private _state: ServerState = "stopped";
  private _port = 3000;
  private _server: Server | undefined;

  private readonly _stateEmitter = new EventEmitter<StateEvent>();
  readonly onState = this._stateEmitter.event;

  private readonly _requestEmitter = new EventEmitter<ActivityEntry>();
  readonly onRequest = this._requestEmitter.event;

  constructor(private readonly options: ServerControllerOptions = {}) {}

  get state(): ServerState {
    return this._state;
  }

  get port(): number {
    return this._port;
  }

  // The actual port the OS bound (matters when port 0 is requested in tests).
  get boundPort(): number | undefined {
    const addr = this._server?.address();
    return addr && typeof addr === "object" ? addr.port : undefined;
  }

  setPort(port: number): void {
    this._port = port;
  }

  async start(): Promise<void> {
    if (this._state === "running" || this._state === "starting") return;
    this._setState("starting");

    const app = buildApp({
      defaultModel: () => this.options.defaultModel?.() ?? null,
      onRequest: (entry) => this._requestEmitter.fire(entry),
    });

    try {
      this._server = await listen(app, this._port);
      this._setState("running");
    } catch (err) {
      this._server = undefined;
      const message = err instanceof Error ? err.message : String(err);
      this._setState("error", message);
    }
  }

  async stop(): Promise<void> {
    if (this._state === "stopped" || this._state === "stopping") return;
    this._setState("stopping");

    const server = this._server;
    this._server = undefined;
    if (!server) {
      this._setState("stopped");
      return;
    }

    await drain(server);
    this._setState("stopped");
  }

  async toggle(): Promise<void> {
    if (this._state === "running") return this.stop();
    if (this._state === "stopped" || this._state === "error") return this.start();
  }

  dispose(): void {
    this._server?.close();
    this._server = undefined;
    this._stateEmitter.dispose();
    this._requestEmitter.dispose();
  }

  private _setState(state: ServerState, message?: string): void {
    this._state = state;
    this._stateEmitter.fire({ state, port: this._port, message });
  }
}

function listen(app: ReturnType<typeof buildApp>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen({ port, host: HOST });
    const onError = (err: Error): void => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });
}

async function drain(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      // Force-close lingering keep-alive connections.
      const closeAll = (server as unknown as { closeAllConnections?: () => void }).closeAllConnections;
      closeAll?.call(server);
      resolve();
    }, STOP_DRAIN_TIMEOUT_MS);
  });
  await Promise.race([closed, timeout]);
}
