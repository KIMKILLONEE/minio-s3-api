const { HeadBucketCommand, CreateBucketCommand } = require("@aws-sdk/client-s3");
const s3Client = require("../config/s3Client");

/**
 * Verifica se o bucket configurado já existe no MinIO.
 * Caso não exista, cria automaticamente.
 *
 * Isso evita ter que criar o bucket manualmente pelo console web do
 * MinIO (http://localhost:9001) antes de usar a API.
 */
async function ensureBucket(bucketName, client = s3Client) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`Bucket "${bucketName}" já existe.`);
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;

    if (statusCode === 404) {
      console.log(`Bucket "${bucketName}" não encontrado. Criando...`);
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucketName }));
      } catch (createError) {
        if (createError.name !== "BucketAlreadyOwnedByYou") throw createError;
      }
      console.log(`Bucket "${bucketName}" criado com sucesso.`);
    } else {
      throw error;
    }
  }
}

module.exports = ensureBucket;
