import { PassThrough } from "node:stream";
import { runInteractive } from "./tui.ts";

const input = new PassThrough();
const output = new PassThrough();
let transcript = "";
output.on("data", (chunk) => {
  transcript += chunk.toString();
});

const completion = runInteractive({ input, output });
setTimeout(() => input.write("q"), 10);
setTimeout(() => input.write("\r"), 30);

await Promise.race([
  completion,
  new Promise((_, reject) => setTimeout(() => reject(new Error("CLI did not resolve after quitting and declining the commit prompt.")), 1_000)),
]);

if (!transcript.includes("Commit all staged changes now?")) {
  throw new Error("Regression harness never reached the final commit prompt.");
}

console.log("PASS: quitting the status tree reaches and resolves the final Clack prompt.");
