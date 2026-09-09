function readConfig(env = process.env) {
  for (const key of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]) {
    if (!env[key]?.trim()) throw new Error(`Defina ${key} no .env.`);
  }
  let endpoint;
  try { endpoint = new URL(env.S3_ENDPOINT); } catch { throw new Error("S3_ENDPOINT deve ser uma URL HTTP ou HTTPS válida."); }
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("S3_ENDPOINT deve usar HTTP ou HTTPS.");
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT deve estar entre 1 e 65535.");
  const maxUploadBytes = Number(env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) throw new Error("MAX_UPLOAD_BYTES deve ser um inteiro positivo.");
  return { port, bucket: env.S3_BUCKET, maxUploadBytes };
}
module.exports = readConfig;
