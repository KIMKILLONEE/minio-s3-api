require("dotenv").config();

const express = require("express");
const cors = require("cors");

const ensureBucket = require("./utils/ensureBucket");
const filesRouter = require("./routes/files");

const app = express();
const PORT = process.env.PORT || 3000;
const BUCKET = process.env.S3_BUCKET;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    message: "API de armazenamento de objetos (MinIO / S3) no ar.",
    endpoints: {
      upload: "POST /files (form-data, campo 'file')",
      listar: "GET /files",
      baixar: "GET /files/:key",
      remover: "DELETE /files/:key",
    },
  });
});

app.use("/files", filesRouter);

// Middleware simples de tratamento de erros não capturados.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno no servidor." });
});

async function start() {
  try {
    await ensureBucket(BUCKET);

    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
      console.log(`Bucket em uso: ${BUCKET}`);
    });
  } catch (error) {
    console.error("Falha ao iniciar a aplicação:", error);
    process.exit(1);
  }
}

start();
