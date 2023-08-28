import { config } from "./config";
import { Server } from "./server";

async function main() {
  const rendertron = new Server(config);
  await rendertron.initialize();

  process.on("SIGTERM", rendertron.shutdown).on("SIGINT", rendertron.shutdown)
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});