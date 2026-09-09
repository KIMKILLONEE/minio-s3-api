const express = require("express");
const cors = require("cors");
const multer = require("multer");
const createFilesRouter = require("./routes/files");

function createApp(options = {}) {
  const app = express();
  const filesRouter = createFilesRouter(options);
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json());
  app.get("/", (_req, res) => res.json({
    message: "API de armazenamento de objetos (MinIO / S3) no ar.",
    endpoints: {
      upload: "POST /upload (form-data, campo 'file')",
      listar: "GET /files", baixar: "GET /files/:key",
      urlTemporaria: "GET /files/:key?presigned=true", remover: "DELETE /files/:key",
    },
  }));
  app.use("/upload", (req, res, next) => {
    if (req.method !== "POST" || req.path !== "/") return next();
    return filesRouter(req, res, next);
  });
  app.use("/files", filesRouter);
  app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada." }));
  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "Arquivo excede o limite de upload." : 'Upload inválido. Envie apenas um arquivo no campo "file".',
      });
    }
    if (err.status === 413) return res.status(413).json({ error: "Corpo da requisição muito grande." });
    if (err.status === 400 || err instanceof URIError || /^(Unexpected end of (form|file)|Multipart:)/.test(err.message)) {
      return res.status(400).json({ error: "Requisição inválida." });
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno no servidor." });
  });
  return app;
}
module.exports = createApp;
