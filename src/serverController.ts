import { EventEmitter } from "vscode";

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

// Phase 1: state machine only. Phase 2 wires this up to a real Express listener.
export class ServerController {
  private _state: ServerState = "stopped";
  private _port = 3000;

  private readonly _stateEmitter = new EventEmitter<StateEvent>();
  readonly onState = this._stateEmitter.event;

  private readonly _requestEmitter = new EventEmitter<ActivityEntry>();
  readonly onRequest = this._requestEmitter.event;

  get state(): ServerState {
    return this._state;
  }

  get port(): number {
    return this._port;
  }

  setPort(port: number): void {
    this._port = port;
  }

  async start(): Promise<void> {
    if (this._state === "running" || this._state === "starting") return;
    this._setState("starting");
    await delay(200);
    this._setState("running");
  }

  async stop(): Promise<void> {
    if (this._state === "stopped" || this._state === "stopping") return;
    this._setState("stopping");
    await delay(100);
    this._setState("stopped");
  }

  async toggle(): Promise<void> {
    if (this._state === "running") return this.stop();
    if (this._state === "stopped" || this._state === "error") return this.start();
  }

  dispose(): void {
    this._stateEmitter.dispose();
    this._requestEmitter.dispose();
  }

  private _setState(state: ServerState, message?: string): void {
    this._state = state;
    this._stateEmitter.fire({ state, port: this._port, message });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
