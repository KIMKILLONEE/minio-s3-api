const { S3Client } = require("@aws-sdk/client-s3");

/**
 * Cliente S3 (biblioteca oficial da AWS: @aws-sdk/client-s3).
 *
 * Para usar as operações S3 deste projeto com o MinIO local:
 *  - apontar o "endpoint" para o servidor MinIO local;
 *  - usar "forcePathStyle: true", pois o MinIO usa o formato de URL
 *    http://endpoint/bucket/chave, enquanto a AWS usa por padrão o
 *    formato http://bucket.endpoint/chave (virtual-hosted style).
 *    Sem essa opção o SDK tenta montar uma URL no estilo AWS e a
 *    requisição falha contra o MinIO.
 */
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

module.exports = s3Client;
