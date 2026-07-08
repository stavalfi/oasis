import { createInterface } from "node:readline";
import { styleText } from "node:util";

const BADGE_UP = `${styleText(["bgGreen", "black"], " UP ")} `;
const BADGE_DOWN = `${styleText(["bgRed", "white"], " DOWN ")} `;

const LEVEL_NUM = new Map([
  ["trace", 10],
  ["debug", 20],
  ["info", 30],
  ["warn", 40],
  ["error", 50],
  ["fatal", 60],
]);
const LEVELS = new Map([
  [10, "TRACE"],
  [20, "DEBUG"],
  [30, "INFO"],
  [40, "WARN"],
  [50, "ERROR"],
  [60, "FATAL"],
]);
const LEVEL_STYLES = new Map<number, Parameters<typeof styleText>[0]>([
  [10, "gray"],
  [20, "blue"],
  [30, "green"],
  [40, "yellow"],
  [50, "red"],
  [60, "bgRed"],
]);
const SKIP = new Set(["level", "time", "name", "msg", "uptime", "v", "pid", "hostname"]);

class LogFormatter {
  #status: "" | typeof BADGE_UP | typeof BADGE_DOWN = "";
  readonly #ac: AbortController;

  public constructor(ac: AbortController) {
    this.#ac = ac;
    process.on("SIGTERM", () => this.#ac.abort());
  }

  public async run(): Promise<void> {
    const rl = createInterface({ input: process.stdin, signal: this.#ac.signal });

    for await (const line of rl) {
      const obj = LogFormatter.#parseJson(line);
      if (obj) {
        const level = LogFormatter.#resolveLevel(obj["level"]);

        if (obj["name"] === "liveness") {
          if (level >= 50) {
            this.#status = BADGE_DOWN;
          } else if (obj["msg"] === "All services are up and running") {
            this.#status = BADGE_UP;
          }
        }

        const time = LogFormatter.#resolveTime(obj["time"]);
        let timeStr: string;
        if (time) {
          timeStr = `${styleText("gray", `[${time}]`)} `;
        } else {
          timeStr = "";
        }
        let name: string;
        if (typeof obj["name"] === "string") {
          name = ` ${styleText("gray", `(${obj["name"]})`)}`;
        } else {
          name = "";
        }
        let uptime: string;
        if (typeof obj["uptime"] === "string") {
          uptime = ` ${styleText("gray", `[${obj["uptime"]}]`)}`;
        } else {
          uptime = "";
        }
        let msg: string;
        if (typeof obj["msg"] === "string") {
          ({ msg } = obj);
        } else {
          msg = "";
        }
        const extras = Object.entries(obj)
          .filter(([k]) => !SKIP.has(k))
          .map(([k, v]) => {
            let valStr: string;
            if (typeof v === "object") {
              valStr = JSON.stringify(v);
            } else {
              valStr = String(v);
            }
            return `${k}=${valStr}`;
          })
          .join(" ");

        const levelLabel = styleText(
          LEVEL_STYLES.get(level) ?? "green",
          LEVELS.get(level) ?? String(level),
        );
        let extrasStr: string;
        if (extras) {
          extrasStr = ` ${styleText("gray", extras)}`;
        } else {
          extrasStr = "";
        }
        const formatted = `${levelLabel}${name}${uptime}${styleText("gray", ":")} ${styleText("cyan", msg)}${extrasStr}`;
        console.log(`${this.#status}${timeStr}${formatted}\n`);
      } else {
        console.log(`${line}\n`);
      }
    }
  }

  static #resolveLevel(raw: unknown): number {
    if (typeof raw === "number") {
      return raw;
    }
    if (typeof raw === "string") {
      return LEVEL_NUM.get(raw.toLowerCase()) ?? 30;
    }
    return 30;
  }

  static #resolveTime(raw: unknown): string | undefined {
    if (typeof raw !== "number" && typeof raw !== "string") {
      return undefined;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return undefined;
    }
    return d.toLocaleTimeString();
  }

  static #parseJson(line: string): Record<string, unknown> | undefined {
    try {
      const parsed: Record<string, unknown> = JSON.parse(line);
      return parsed;
    } catch {
      return undefined;
    }
  }
}

await new LogFormatter(new AbortController()).run();
