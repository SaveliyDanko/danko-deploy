import type { DeployStatus, WsServerMessage } from "@dankodeploy/shared";
import { describe, expect, it } from "vitest";

import { BackgroundRunner } from "./BackgroundRunner.js";

/** Мини-хаб, накапливающий опубликованные сообщения по каналам. */
function fakeHub() {
  const messages: { channel: string; msg: WsServerMessage }[] = [];
  return {
    hub: { publish: (channel: string, msg: WsServerMessage) => messages.push({ channel, msg }) },
    messages,
  };
}

/** Ждёт, пока фоновая задача (микротаски) завершится. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("BackgroundRunner", () => {
  it("возвращает runId сразу и публикует в канал deploy:<runId>", async () => {
    const { hub, messages } = fakeHub();
    const runner = new BackgroundRunner(hub as never);

    const { runId } = runner.run((publish) => {
      publish("строка лога", "stdout");
      return Promise.resolve<DeployStatus>("success");
    });

    expect(runId).toBeTruthy();
    await flush();
    expect(messages.every((m) => m.channel === `deploy:${runId}`)).toBe(true);
  });

  it("успех: deploy:log + deploy:done со статусом задачи", async () => {
    const { hub, messages } = fakeHub();
    const runner = new BackgroundRunner(hub as never);

    runner.run((publish) => {
      publish("шаг 1", "stdout");
      return Promise.resolve<DeployStatus>("success");
    });
    await flush();

    const logs = messages.filter((m) => m.msg.type === "deploy:log");
    const done = messages.find((m) => m.msg.type === "deploy:done");
    expect(logs).toHaveLength(1);
    expect(done?.msg).toMatchObject({ type: "deploy:done", status: "success" });
  });

  it("задача вернула failed: done с failed (без исключения)", async () => {
    const { hub, messages } = fakeHub();
    const runner = new BackgroundRunner(hub as never);

    runner.run(() => Promise.resolve<DeployStatus>("failed"));
    await flush();

    const done = messages.find((m) => m.msg.type === "deploy:done");
    expect(done?.msg).toMatchObject({ status: "failed" });
  });

  it("брошенное исключение: info-строка с ошибкой + done failed", async () => {
    const { hub, messages } = fakeHub();
    const runner = new BackgroundRunner(hub as never);

    runner.run(() => Promise.reject(new Error("ssh упал")));
    await flush();

    const info = messages.find(
      (m) => m.msg.type === "deploy:log" && m.msg.stream === "info",
    );
    const done = messages.find((m) => m.msg.type === "deploy:done");
    expect(info?.msg).toMatchObject({ type: "deploy:log", stream: "info" });
    expect((info?.msg as { line: string }).line).toContain("ssh упал");
    expect(done?.msg).toMatchObject({ status: "failed" });
  });
});
