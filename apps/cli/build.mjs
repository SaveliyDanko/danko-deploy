import { chmod } from "node:fs/promises";
import { URL } from "node:url";

// npm создаёт shim для bin, но executable bit нужен и при прямом запуске dist/main.js.
await chmod(new URL("./dist/main.js", import.meta.url), 0o755);
