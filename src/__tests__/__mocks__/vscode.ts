// Hand-rolled vscode mock for unit tests. Only what the source under test imports.
// Keep this file dependency-free.

type Listener<T> = (e: T) => void;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];

  event = (listener: Listener<T>): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const i = this.listeners.indexOf(listener);
        if (i >= 0) this.listeners.splice(i, 1);
      },
    };
  };

  fire(value: T): void {
    for (const l of [...this.listeners]) l(value);
  }

  dispose(): void {
    this.listeners = [];
  }
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

export const workspace = {
  getConfiguration: () => ({
    get: <T>(_key: string, def?: T): T | undefined => def,
    update: (): Promise<void> => Promise.resolve(),
  }),
  onDidChangeConfiguration: (): { dispose(): void } => ({ dispose: () => {} }),
};

export const window = {
  registerWebviewViewProvider: (): { dispose(): void } => ({ dispose: () => {} }),
  createOutputChannel: () => ({
    appendLine: (): void => {},
    show: (): void => {},
    dispose: (): void => {},
  }),
};

export const commands = {
  registerCommand: (): { dispose(): void } => ({ dispose: () => {} }),
  executeCommand: (): Promise<void> => Promise.resolve(),
};

export const env = {
  clipboard: {
    writeText: (_t: string): Promise<void> => Promise.resolve(),
  },
};

export const Uri = {
  joinPath: (..._args: unknown[]): { path: string; toString(): string } => ({
    path: "",
    toString: () => "",
  }),
  file: (p: string): { path: string; toString(): string } => ({
    path: p,
    toString: () => p,
  }),
};

// --- Language model surface --------------------------------------------------

export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: unknown,
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(public readonly callId: string, public readonly content: unknown[]) {}
}

interface FakeChatMessage {
  role: "user" | "assistant";
  content: unknown;
}

export const LanguageModelChatMessage = {
  User(content: unknown): FakeChatMessage {
    return { role: "user", content };
  },
  Assistant(content: unknown): FakeChatMessage {
    return { role: "assistant", content };
  },
};

export const LanguageModelChatToolMode = {
  Auto: 1,
  Required: 2,
} as const;

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export class CancellationTokenSource {
  private _cancelled = false;
  private readonly _listeners: Array<() => void> = [];
  public readonly token: CancellationToken;

  constructor() {
    const self = this;
    this.token = {
      get isCancellationRequested(): boolean {
        return self._cancelled;
      },
      onCancellationRequested(listener: () => void): { dispose(): void } {
        self._listeners.push(listener);
        return {
          dispose: () => {
            const i = self._listeners.indexOf(listener);
            if (i >= 0) self._listeners.splice(i, 1);
          },
        };
      },
    };
  }

  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    for (const l of [...this._listeners]) l();
  }

  dispose(): void {
    this._listeners.length = 0;
  }
}

// Mutable test hook: tests can replace this to control selectChatModels output.
export interface FakeLanguageModelChat {
  id: string;
  name?: string;
  family?: string;
  vendor?: string;
  sendRequest(
    messages: FakeChatMessage[],
    options: unknown,
    token: unknown,
  ): Promise<{ stream: AsyncIterable<unknown> }>;
}

let _models: FakeLanguageModelChat[] = [];
export function __setModels(models: FakeLanguageModelChat[]): void {
  _models = models;
}
export function __getModels(): FakeLanguageModelChat[] {
  return _models;
}

export const lm = {
  selectChatModels: async (_selector?: { vendor?: string; family?: string }): Promise<FakeLanguageModelChat[]> => {
    return _models;
  },
};
