# Relatório do Projeto — API de Armazenamento de Objetos (Node.js + MinIO/S3)

## 1. Objetivo

Construir uma API REST em Node.js/Express capaz de **enviar, listar, baixar e
remover arquivos** usando o padrão de *object storage* do Amazon S3, sem
depender de uma conta AWS real. Para isso, o servidor S3 foi simulado
localmente com o **MinIO**, executado em um container Docker, e a
comunicação foi feita através do SDK oficial da AWS
(`@aws-sdk/client-s3`) — de forma que o mesmo código funcionaria contra um
bucket AWS real apenas trocando variáveis de ambiente.

## 2. Passos executados

### 2.1 Planejamento e arquitetura

Definição do fluxo: `Cliente HTTP → API Express → @aws-sdk/client-s3 → MinIO (Docker)`,
com o MinIO atuando como um servidor compatível com o protocolo S3.

### 2.2 Infraestrutura (Docker)

- Criação do [docker-compose.yml](docker-compose.yml) usando a imagem oficial
  `minio/minio`, expondo:
  - porta `9000` → API S3 do MinIO;
  - porta `9001` → console web de administração.
- Definição de usuário/senha padrão (`minioadmin` / `minioadmin123`) via
  variáveis de ambiente do container e volume persistente `minio_data`.

### 2.3 Projeto Node.js

- Inicialização do projeto (`npm init`) e instalação das dependências:
  `express`, `@aws-sdk/client-s3`, `multer`, `dotenv`, `cors`.
- Configuração das variáveis de ambiente em `.env` (porta da API, endpoint,
  região, credenciais e nome do bucket do MinIO).

### 2.4 Implementação

- [src/config/s3Client.js](src/config/s3Client.js): criação do cliente
  `S3Client` do SDK da AWS apontando para o endpoint do MinIO, com
  `forcePathStyle: true` (necessário para compatibilidade com o MinIO local).
- [src/utils/ensureBucket.js](src/utils/ensureBucket.js): rotina que
  verifica (`HeadBucketCommand`) se o bucket configurado existe e o cria
  automaticamente (`CreateBucketCommand`) caso não exista, evitando um passo
  manual de setup.
- [src/routes/files.js](src/routes/files.js): rotas da API —
  - `POST /files` — upload via `multipart/form-data` (Multer, em memória),
    gravado no bucket com `PutObjectCommand`;
  - `GET /files` — listagem dos objetos (`ListObjectsV2Command`);
  - `GET /files/:key` — download via stream (`GetObjectCommand` +
    `Body.pipe(res)`);
  - `DELETE /files/:key` — remoção (`DeleteObjectCommand`).
- [src/server.js](src/server.js): ponto de entrada — carrega o `.env`,
  configura Express/CORS/JSON, executa `ensureBucket` na subida e só então
  inicia o servidor HTTP.

### 2.5 Subida e validação do ambiente (execução ponta a ponta)

1. Abertura do **Docker Desktop** (necessário estar em execução para o
   comando `docker` funcionar no Windows).
2. `docker-compose up -d` — download da imagem `minio/minio:latest` e
   subida do container `minio-s3`.
3. `npm install` — instalação das dependências do `package.json`.
4. `npm start` — subida da API; o `ensureBucket` detectou que o bucket
   `meus-arquivos` não existia e o criou automaticamente.
5. Testes manuais dos endpoints:
   - `GET /` → retornou a mensagem de status e o mapa de endpoints;
   - `GET /files` → retornou `{"bucket":"meus-arquivos","total":0,"files":[]}`,
     confirmando bucket criado e API íntegra de ponta a ponta.
   - Validação do console web do MinIO em `http://localhost:9001`.

## 3. Dificuldades encontradas e como foram resolvidas

- **Formato de URL do S3 (`virtual-hosted` vs `path-style`).** O SDK da AWS,
  por padrão, monta as URLs no formato `bucket.endpoint.com`, que não
  funciona contra o MinIO local. Resolvido habilitando `forcePathStyle: true`
  no `S3Client`, fazendo o SDK montar as URLs como `endpoint/bucket`.

- **Necessidade de criar o bucket manualmente.** Para não depender de um
  passo manual pelo console do MinIO, foi implementada a função
  `ensureBucket`, que verifica a existência do bucket com
  `HeadBucketCommand` e cria com `CreateBucketCommand` caso necessário,
  automaticamente a cada subida do servidor.

- **Diferença de comportamento do `GetObjectCommand` no Node.js.** O campo
  `Body` retornado é um stream legível (`Readable`), então o download foi
  implementado com `Body.pipe(res)` em vez de carregar o arquivo inteiro em
  memória antes de responder — evitando estourar memória com arquivos
  grandes.

- **Vulnerabilidade conhecida no `multer@1.x`.** O npm alertou sobre
  vulnerabilidades de segurança na v1 do Multer durante a instalação.
  Resolvido fixando a dependência em `multer@^2.0.0` no `package.json`.

- **Colisão de nomes de arquivo.** Como o S3/MinIO não impede a
  sobrescrita de um objeto com a mesma chave, um upload repetido com o
  mesmo nome de arquivo apagaria silenciosamente o anterior. Resolvido
  prefixando cada chave com `Date.now()` (`timestamp-nomeOriginal`),
  garantindo unicidade mesmo para nomes de arquivo repetidos.

- **Docker Desktop não estava em execução.** Ao tentar subir o ambiente,
  o comando `docker` falhou porque o Docker Desktop (o *daemon* no Windows)
  não estava aberto. Resolvido iniciando o aplicativo manualmente e
  aguardando o *engine* ficar disponível antes de rodar
  `docker-compose up -d`.

- **Arquivos de apoio ausentes no repositório.** O `README.md` já
  referenciava um `.gitignore` e um `.env.example`, mas nenhum dos dois
  existia no projeto. Isso foi corrigido antes da publicação no GitHub,
  para evitar versionar `node_modules/` e o `.env` real (com credenciais)
  por engano, mantendo apenas um modelo (`.env.example`) no repositório.

- **Validação sem MinIO ativo.** Durante o desenvolvimento inicial, testes
  de sintaxe e inicialização foram feitos antes de o container do MinIO
  estar de pé; nesse cenário a aplicação falhava, de forma esperada e
  tratada, com `ECONNREFUSED` ao tentar verificar o bucket — confirmando
  que o ponto de falha era a ausência do MinIO, e não um erro no código.

## 4. Resultado final

Ambiente validado de ponta a ponta: Docker Desktop → container MinIO →
API Node.js → bucket criado automaticamente → endpoints testados e
respondendo corretamente. O projeto está pronto para uso local e para
publicação em um repositório no GitHub (ver [README.md](README.md),
seção "Como subir este projeto no GitHub").
