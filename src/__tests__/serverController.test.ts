import { describe, it, expect } from "vitest";
import { ServerController, type ServerState } from "../serverController";

describe("ServerController", () => {
  it("starts in the stopped state with the default port", () => {
    const c = new ServerController();
    expect(c.state).toBe("stopped");
    expect(c.port).toBe(3000);
    c.dispose();
  });

  it("emits starting → running on start()", async () => {
    const c = new ServerController();
    const states: ServerState[] = [];
    c.onState((e) => states.push(e.state));
    await c.start();
    expect(states).toEqual(["starting", "running"]);
    c.dispose();
  });

  it("emits stopping → stopped on stop()", async () => {
    const c = new ServerController();
    await c.start();
    const states: ServerState[] = [];
    c.onState((e) => states.push(e.state));
    await c.stop();
    expect(states).toEqual(["stopping", "stopped"]);
    c.dispose();
  });

  it("toggle() flips between stopped and running", async () => {
    const c = new ServerController();
    expect(c.state).toBe("stopped");
    await c.toggle();
    expect(c.state).toBe("running");
    await c.toggle();
    expect(c.state).toBe("stopped");
    c.dispose();
  });

  it("setPort() updates the port reported on subsequent state events", async () => {
    const c = new ServerController();
    c.setPort(4242);
    let observedPort = 0;
    c.onState((e) => {
      observedPort = e.port;
    });
    await c.start();
    expect(observedPort).toBe(4242);
    c.dispose();
  });
});
