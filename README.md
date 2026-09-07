# API de arquivos com Node.js e MinIO (S3)

Backend acadêmico para enviar, listar, baixar e excluir objetos, usando Express e o SDK oficial da AWS contra um MinIO local em Docker. Inclui URLs pré-assinadas válidas por 5 minutos. Não exige frontend nem conta AWS.

## Arquitetura e estrutura

```text
Cliente HTTP -> API Node.js (3000) -> MinIO em Docker (9000)
Cliente HTTP ---------------------> MinIO (URL pré-assinada)
Console do MinIO: http://localhost:9001
```

| Arquivo | Responsabilidade |
|---|---|
| `src/server.js` | Carrega o ambiente, verifica o bucket e inicia o servidor. |
| `src/app.js` | Configura Express, CORS, rotas e respostas de erro; permite testes sem iniciar o MinIO. |
| `src/config/env.js` | Valida configurações obrigatórias, porta e limite de upload. |
| `src/config/s3Client.js` | Configura o SDK da AWS com endpoint local e `forcePathStyle: true`. |
| `src/routes/files.js` | Upload, listagem, download, exclusão e assinatura de URLs. |
| `src/utils/ensureBucket.js` | Verifica e cria o bucket quando necessário. |
| `docker-compose.yml` | Serviço MinIO, credenciais e volume persistente. |
| `test/backend.test.js` | Testes HTTP isolados com armazenamento simulado. |
| `requests.http` | Requisições manuais para a extensão REST Client do VS Code. |

Bibliotecas: Express (HTTP), Multer (multipart e buffer de upload), dotenv (ambiente), cors (requisições entre origens), `@aws-sdk/client-s3` (operações S3) e `@aws-sdk/s3-request-presigner` (links temporários). Os testes usam o executor nativo do Node.js.

## Como executar

Pré-requisitos: **Node.js 20 ou superior**, npm e Docker Desktop com Docker Compose v2. Execute os comandos na pasta que contém `package.json` e `docker-compose.yml`. As dependências AWS registradas no lockfile exigem Node 20 ou superior.

### 1. Configurar o ambiente

No PowerShell, crie o `.env` somente se ainda não existir:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

No Linux/macOS:

```sh
[ -f .env ] || cp .env.example .env
```

| Variável | Padrão/modelo | Uso |
|---|---|---|
| `PORT` | `3000` | Porta HTTP da API. |
| `MAX_UPLOAD_BYTES` | `10485760` | Limite por upload: 10 MiB; inteiro positivo. |
| `S3_ENDPOINT` | `http://localhost:9000` | Endereço do MinIO usado pelo SDK e pelos links. |
| `S3_REGION` | `us-east-1` | Região usada na assinatura. |
| `S3_ACCESS_KEY` | `minioadmin` | Usuário local do MinIO. |
| `S3_SECRET_KEY` | `minioadmin123` | Senha de exemplo para desenvolvimento local. |
| `S3_BUCKET` | `meus-arquivos` | Bucket padrão. |

O Compose lê `S3_ACCESS_KEY` e `S3_SECRET_KEY` para configurar o usuário e a senha do MinIO. Não copie o modelo sobre um `.env` já configurado. As configurações exportadas no terminal têm prioridade sobre o `.env`; evite valores divergentes entre os terminais da API e do Compose.

### 2. Iniciar o MinIO

Com o Docker Desktop em execução:

```powershell
docker compose config --quiet
docker compose up -d
docker compose ps
```

Aguarde o serviço `minio` ficar `healthy`. A API S3 atende em `http://localhost:9000`; o console em `http://localhost:9001`, com as credenciais do `.env`. O volume `minio_data` mantém os objetos após reiniciar ou recriar o container.

### 3. Instalar, testar e iniciar a API

```powershell
npm ci
npm test
npm start
```

`npm ci` instala as versões do `package-lock.json`. `npm test` não precisa de Docker nem do `.env`: usa credenciais fictícias e armazenamento simulado, sem acessar seus objetos reais. Na inicialização normal, a API verifica o bucket com `HeadBucketCommand` e o cria com `CreateBucketCommand` se ele não existir.

A mensagem esperada é `Servidor rodando em http://localhost:3000`. Para reinício automático durante o desenvolvimento, use `npm run dev`. Se usar `npm start`, reinicie a API com `Ctrl+C` e `npm start` após alterar código ou ambiente.

## Endpoints

| Método | Rota | Resultado esperado |
|---|---|---|
| GET | `/` | `200`: informações e mapa de endpoints. |
| POST | `/upload` | `201`: upload de um arquivo no campo `file`. |
| POST | `/files` | Alias de upload mantido por compatibilidade. |
| GET | `/files` | `200`: metadados e `presignedUrl` de cada objeto. |
| GET | `/files/:key` | `200`: download por stream. |
| GET | `/files/:key?presigned=true` | `200`: JSON `{ "url": "..." }`. |
| DELETE | `/files/:key` | `200`: exclusão idempotente da chave. |

Copie a **key completa** retornada pela API, não apenas o timestamp ou o nome original. Para montar uma URL por código, use `encodeURIComponent(key)`, especialmente para espaços, acentos, `#`, `?` e `/`. Para abrir diretamente um objeto, também pode copiar o `presignedUrl` pronto da listagem.

### Upload

No Postman/Insomnia, use `POST http://localhost:3000/upload`, Body do tipo multipart/form-data, campo `file` do tipo File. Deixe o cliente definir o cabeçalho Content-Type com o boundary. Em `requests.http`, o boundary já está definido e o arquivo de exemplo está incluído.

O arquivo passa por `multer.memoryStorage()` e é enviado com `PutObjectCommand`. O limite padrão é 10 MiB por arquivo, ajustável por `MAX_UPLOAD_BYTES`. Uploads simultâneos ainda somam consumo de memória; esta implementação é voltada ao escopo local do trabalho.

Exemplo de resposta (valores ilustrativos):

```json
{
  "message": "Arquivo enviado com sucesso.",
  "key": "1788796466097-550e8400-e29b-41d4-a716-446655440000-exemplo.txt",
  "originalName": "exemplo.txt",
  "size": 64,
  "mimeType": "text/plain"
}
```

As novas chaves combinam timestamp, UUID e nome para evitar colisões entre envios simultâneos. O nome original é salvo em metadados com codificação de URL, incluindo suporte a acentos e emoji. As chaves antigas continuam aceitas; não é necessário reenviar os objetos.

### Listagem e links temporários

A listagem retorna `{ "bucket": "meus-arquivos", "total": 1, "files": [...] }`. Cada objeto inclui:

- `key`: identificador completo utilizado para download e exclusão.
- `originalName`: nome salvo no upload; em arquivos antigos, recuperado da chave sem o prefixo.
- `size`: tamanho em bytes.
- `lastModified`: última modificação no armazenamento, não uma data de criação independente.
- `contentType`: tipo MIME informado no upload; `application/octet-stream` quando ausente. Não representa inspeção do conteúdo do arquivo.
- `presignedUrl`: link completo de acesso direto ao MinIO, válido por 300 segundos a partir da geração.

A API percorre todas as páginas de `ListObjectsV2Command` e consulta `HeadObjectCommand` em lotes de até dez objetos. Um arquivo excluído durante a consulta é omitido, sem impedir a listagem dos demais. A resposta completa continua sendo montada em memória; não há paginação pública da API.

Para renovar os links, consulte `GET /files` novamente. A rota individual com `?presigned=true` também continua disponível e verifica a existência do arquivo antes de gerar o link. As respostas com URLs usam `Cache-Control: no-store`.

Quem possui o link pode utilizá-lo durante sua validade; ele não é de uso único. A expiração não remove o objeto. No ambiente local, links com `localhost:9000` devem ser abertos no computador onde o MinIO está rodando. Não altere o endereço assinado.

### Download, exclusão e erros

O download usa `GetObjectCommand` e `pipeline` para transferir o stream e encerrar os recursos em caso de erro ou cancelamento. O cabeçalho de download é montado pelo Express para suportar nomes com caracteres especiais. Se o stream falhar após iniciar a resposta, a transferência será interrompida; a API não consegue substituir bytes já enviados por um JSON de erro.

A exclusão usa `DeleteObjectCommand`. Excluir uma chave já inexistente também retorna sucesso, seguindo a semântica idempotente do S3.

| Status | Situação |
|---|---|
| `400` | Arquivo ausente, campo incorreto, vários arquivos, multipart inválido ou chave excessivamente longa no upload. |
| `404` | Rota inexistente ou objeto ausente no download/geração individual de URL. |
| `413` | Arquivo acima do limite ou corpo JSON muito grande. |
| `500` | Falha de armazenamento ou outro erro interno. |

## Testes e validação

```powershell
npm test
npm audit --omit=dev
```

Os testes automatizados cobrem operações HTTP, integridade binária, nomes Unicode, uploads simultâneos, limites, multipart inválido, paginação, exclusão durante listagem, assinatura real do SDK, download, falha de stream, configuração e criação do bucket. O armazenamento é simulado: esses testes não comprovam a aceitação da assinatura pelo MinIO, a expiração real ou a persistência do volume.

Roteiro manual com o ambiente real, usando `requests.http`, Postman ou Insomnia:

1. Envie `test/fixtures/exemplo.txt` por `POST /upload` e guarde a key.
2. Consulte `GET /files` e confira nome, tamanho, tipo e link temporário.
3. Baixe pela key completa e compare o conteúdo com o arquivo original.
4. Abra o `presignedUrl` no navegador. Após 5 minutos, tente um novo acesso à mesma URL em janela anônima; o MinIO deve negar o acesso.
5. Consulte novamente a listagem e confirme que o novo link funciona.
6. Confira o objeto no console do MinIO. Exclua apenas os arquivos usados no teste.

Se o cliente HTTP exigir versão paga para respostas binárias, abra o download ou o link assinado no navegador. Se aparecer `ECONNREFUSED`, confira `docker compose ps` e `S3_ENDPOINT`; se houver `EADDRINUSE`, encerre a outra API ou ajuste `PORT`. Para examinar o MinIO, use `docker compose logs --tail 50 minio`.

## Repositório e escopo

O `.gitignore` exclui `.env`, `node_modules/` e logs. Versione o código, `.env.example`, `package.json`, `package-lock.json`, Compose, README e testes. Execute `git status` e revise o diff antes do commit. O `RELATORIO.md` registra o desenvolvimento anterior; este README descreve o funcionamento atual.

A seção de metodologia atualizada está em [docs/SECAO_4.md](docs/SECAO_4.md), para integração ao artigo do grupo. Ela incorpora as correções da revisão e substitui a descrição técnica do PDF anterior.

Referências de implementação: [Multer e limites de upload](https://expressjs.com/en/resources/middleware/multer/), [paginação de ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html) e [streams do Node.js](https://nodejs.org/api/stream.html).

Este backend não implementa autenticação nem autorização e mantém CORS aberto para os testes locais. Publicar o código no GitHub não equivale a expor a API na internet; controles de acesso precisam ser definidos antes de uma implantação pública.

O `package.json` usa um override de `qs` para a versão corrigida 6.16 ou superior dentro da versão principal 6, pois dependências do Express restringiam a instalação a versões apontadas pela auditoria. Mantenha o lockfile e reavalie com `npm audit` ao atualizar dependências. A imagem `minio/minio:latest` acompanha o projeto original; não é uma versão imutável, portanto atualizações da imagem exigem nova validação local.

## Encerrar ou reaplicar a configuração

Para aplicar mudanças no Compose preservando o volume:

```powershell
docker compose up -d
```

Para parar e remover o container, mantendo os dados:

```powershell
docker compose down
```

Não acrescente `-v` a esse comando se quiser manter os arquivos: essa opção remove o volume persistente. Para parar somente a API, use `Ctrl+C` no terminal dela.
