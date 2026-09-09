require("dotenv").config();
const createApp = require("./app");
const ensureBucket = require("./utils/ensureBucket");
const readConfig = require("./config/env");

async function start() {
  try {
    const config = readConfig();
    await ensureBucket(config.bucket);
    const app = createApp({ bucket: config.bucket, maxUploadBytes: config.maxUploadBytes });
    const server = app.listen(config.port, () => {
      console.log(`Servidor rodando em http://localhost:${config.port}`);
      console.log(`Bucket em uso: ${config.bucket}`);
    });
    server.on("error", error => {
      console.error("Falha ao abrir a porta HTTP:", error.code);
      process.exitCode = 1;
    });
    return server;
  } catch (error) {
    console.error("Falha ao iniciar a API:", error.message);
    process.exitCode = 1;
  }
}
if (require.main === module) start();
module.exports = start;
