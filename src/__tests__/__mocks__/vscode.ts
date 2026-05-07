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
