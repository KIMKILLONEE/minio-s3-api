const express = require("express");
const multer = require("multer");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  PutObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const defaultClient = require("../config/s3Client");

function createFilesRouter({ s3Client = defaultClient, bucket = process.env.S3_BUCKET,
  maxUploadBytes = 10 * 1024 * 1024 } = {}) {
  const router = express.Router();

  function originalName(key, metadata = {}) {
    if (metadata.originalname) {
      try { return decodeURIComponent(metadata.originalname); } catch { /* Usa a chave. */ }
    }
    const prefix = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i;
    return prefix.test(key) ? key.replace(prefix, "") : key.replace(/^\d+-/, "");
  }

  function isMissing(error) {
    return error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey";
  }

  function createPresignedUrl(key) {
    return getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 300 }
    );
  }

  // Armazena o arquivo em memória (buffer) antes de enviar para o MinIO.
  // Para arquivos muito grandes, o ideal seria usar streaming, mas para
  // o escopo deste teste a memória é suficiente.
  const upload = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: maxUploadBytes, files: 1, fields: 10, parts: 11,
  } });

  /**
   * POST /upload (também disponível em POST /files por compatibilidade)
   * Recebe um arquivo via multipart/form-data (campo "file") e envia
   * para o bucket configurado no MinIO.
   */
  router.post("/", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado. Utilize o campo "file".' });
      }

      // Recupera nomes UTF-8 enviados por navegadores e clientes HTTP.
      let name = req.file.originalname;
      if ([...name].every(char => char.charCodeAt(0) <= 255)) {
        try { name = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(name, "latin1")); }
        catch { /* Preserva nomes enviados em Latin-1. */ }
      }
      name = name.replace(/[\x00-\x1f\x7f]/g, "_");
      const key = `${Date.now()}-${randomUUID()}-${name}`;
      const encodedName = encodeURIComponent(name);
      if (Buffer.byteLength(key, "utf8") > 1024 || Buffer.byteLength(encodedName, "ascii") > 2000) {
        return res.status(400).json({ error: "Nome de arquivo muito longo." });
      }

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
          Metadata: { originalname: encodedName },
        })
      );

      return res.status(201).json({
        message: "Arquivo enviado com sucesso.",
        key,
        originalName: name,
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
   * Lista os objetos com metadados e URLs de acesso válidas por 5 minutos.
   */
  router.get("/", async (_req, res) => {
    try {
      const files = [];
      let continuationToken;
      do {
        const data = await s3Client.send(new ListObjectsV2Command({
          Bucket: bucket, ContinuationToken: continuationToken,
        }));
        const items = data.Contents || [];
        // Limita a dez consultas simultâneas, inclusive em buckets com várias páginas.
        for (let offset = 0; offset < items.length; offset += 10) {
          const batch = await Promise.all(items.slice(offset, offset + 10).map(async (item) => {
            try {
              const head = await s3Client.send(
                new HeadObjectCommand({ Bucket: bucket, Key: item.Key })
              );
              return {
                key: item.Key,
                originalName: originalName(item.Key, head.Metadata),
                size: item.Size,
                lastModified: item.LastModified,
                contentType: head.ContentType || "application/octet-stream",
                presignedUrl: await createPresignedUrl(item.Key),
              };
            } catch (error) {
              if (isMissing(error)) return null; // Removido durante a consulta.
              throw error;
            }
          }));
          files.push(...batch.filter(Boolean));
        }
        const nextToken = data.IsTruncated ? data.NextContinuationToken : undefined;
        if (data.IsTruncated && (!nextToken || nextToken === continuationToken)) {
          throw new Error("Token de paginação inválido no armazenamento.");
        }
        continuationToken = nextToken;
      } while (continuationToken);

      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ bucket, total: files.length, files });
    } catch (error) {
      console.error("Erro ao listar arquivos:", error);
      return res.status(500).json({ error: "Erro ao listar arquivos do armazenamento." });
    }
  });

  /**
   * GET /files/:key
   * Faz o download (stream) de um arquivo específico pelo nome/chave.
   * Com ?presigned=true, retorna uma URL de acesso direto válida por 5 minutos.
   */
  router.get("/:key", async (req, res) => {
    try {
      const { key } = req.params;

      if (req.query.presigned === "true") {
        // Confirma a existência do arquivo antes de emitir o link temporário.
        await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const url = await createPresignedUrl(key);

        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ url });
      }

      const data = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );

      res.attachment(originalName(key, data.Metadata));
      res.setHeader("Content-Type", data.ContentType || "application/octet-stream");

      // data.Body é um stream (Node.js Readable) quando usamos @aws-sdk/client-s3 no Node.
      await pipeline(data.Body, res);
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      if (isMissing(error)) {
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

  return router;
}

module.exports = createFilesRouter;
