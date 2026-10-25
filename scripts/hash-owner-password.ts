import { hashOwnerPassword } from "../server/discord/owner-auth";

async function readHiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }
  process.stderr.write("Owner password (input hidden): ");
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = "";
    const wasRaw = input.isRaw;
    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
    };
    input.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") { cleanup(); output.write("\n"); reject(new Error("Cancelled.")); return; }
        if (character === "\r" || character === "\n") { cleanup(); output.write("\n"); resolve(value); return; }
        if (character === "\b" || character === "\u007f") { value = [...value].slice(0, -1).join(""); continue; }
        if (character >= " ") value += character;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

try {
  const password = await readHiddenPassword();
  if (password.length < 20 || password.length > 128) throw new Error("Password must be between 20 and 128 characters.");
  process.stdout.write(`${await hashOwnerPassword(password)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Password hashing failed."}\n`);
  process.exitCode = 1;
}
