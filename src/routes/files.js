const express = require("express");
const multer = require("multer");
const {
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const s3Client = require("../config/s3Client");

const router = express.Router();
const bucket = process.env.S3_BUCKET;

// Armazena o arquivo em memória (buffer) antes de enviar para o MinIO.
// Para arquivos muito grandes, o ideal seria usar streaming, mas para
// o escopo deste teste a memória é suficiente.
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /files
 * Recebe um arquivo via multipart/form-data (campo "file") e envia
 * para o bucket configurado no MinIO.
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado. Utilize o campo "file".' });
    }

    // Evita sobrescrever arquivos com o mesmo nome, prefixando com timestamp.
    const key = `${Date.now()}-${req.file.originalname}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    return res.status(201).json({
      message: "Arquivo enviado com sucesso.",
      key,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (error) {
    console.error("Erro ao fazer upload:", error);
    return res.status(500).json({ error: "Erro ao enviar arquivo para o armazenamento." });
  }
});

/**
 * GET /files
 * Lista todos os objetos armazenados no bucket.
 */
router.get("/", async (_req, res) => {
  try {
    const data = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket }));

    const files = (data.Contents || []).map((item) => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    }));

    return res.status(200).json({ bucket, total: files.length, files });
  } catch (error) {
    console.error("Erro ao listar arquivos:", error);
    return res.status(500).json({ error: "Erro ao listar arquivos do armazenamento." });
  }
});

/**
 * GET /files/:key
 * Faz o download (stream) de um arquivo específico pelo nome/chave.
 */
router.get("/:key", async (req, res) => {
  try {
    const { key } = req.params;

    const data = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    res.setHeader("Content-Type", data.ContentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${key}"`);

    // data.Body é um stream (Node.js Readable) quando usamos @aws-sdk/client-s3 no Node.
    data.Body.pipe(res);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey") {
      return res.status(404).json({ error: "Arquivo não encontrado." });
    }
    console.error("Erro ao baixar arquivo:", error);
    return res.status(500).json({ error: "Erro ao buscar arquivo no armazenamento." });
  }
});

/**
 * DELETE /files/:key
 * Remove um arquivo do bucket pelo nome/chave.
 */
router.delete("/:key", async (req, res) => {
  try {
    const { key } = req.params;

    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

    return res.status(200).json({ message: "Arquivo removido com sucesso.", key });
  } catch (error) {
    console.error("Erro ao remover arquivo:", error);
    return res.status(500).json({ error: "Erro ao remover arquivo do armazenamento." });
  }
});

module.exports = router;
