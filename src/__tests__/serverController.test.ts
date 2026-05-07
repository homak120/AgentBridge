import { afterEach, describe, expect, it } from "vitest";
import { ServerController, type ServerState } from "../serverController";

const controllers: ServerController[] = [];

function make(): ServerController {
  const c = new ServerController();
  c.setPort(0); // OS-assigned port — avoids collisions in tests.
  controllers.push(c);
  return c;
}

afterEach(async () => {
  for (const c of controllers.splice(0)) {
    await c.stop().catch(() => {});
    c.dispose();
  }
});

describe("ServerController", () => {
  it("starts in the stopped state", () => {
    const c = make();
    expect(c.state).toBe("stopped");
  });

  it("emits starting → running on start()", async () => {
    const c = make();
    const states: ServerState[] = [];
    c.onState((e) => states.push(e.state));
    await c.start();
    expect(states).toEqual(["starting", "running"]);
    expect(c.state).toBe("running");
    expect(c.boundPort).toBeGreaterThan(0);
  });

  it("emits stopping → stopped on stop()", async () => {
    const c = make();
    await c.start();
    const states: ServerState[] = [];
    c.onState((e) => states.push(e.state));
    await c.stop();
    expect(states).toEqual(["stopping", "stopped"]);
  });

  it("toggle() flips between stopped and running", async () => {
    const c = make();
    expect(c.state).toBe("stopped");
    await c.toggle();
    expect(c.state).toBe("running");
    await c.toggle();
    expect(c.state).toBe("stopped");
  });

  it("transitions to error state when port is already in use", async () => {
    const a = make();
    await a.start();
    const port = a.boundPort!;

    const b = new ServerController();
    controllers.push(b);
    b.setPort(port);

    let lastState: ServerState | undefined;
    let lastMessage: string | undefined;
    b.onState((e) => {
      lastState = e.state;
      lastMessage = e.message;
    });
    await b.start();

    expect(b.state).toBe("error");
    expect(lastState).toBe("error");
    expect(lastMessage).toBeDefined();
  });
});
