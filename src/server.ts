import { createPhase1HttpServer } from "./server/app.js";

const port = Number(process.env.PORT ?? "4319");
const host = process.env.HOST ?? "127.0.0.1";

const server = createPhase1HttpServer(process.env);
server.listen(port, host, () => {
  console.log(`Investment OS Phase 1 server listening at http://${host}:${port}`);
});
