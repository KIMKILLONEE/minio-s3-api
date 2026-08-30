# API de Armazenamento de Objetos — Node.js + MinIO (S3)

API REST em Node.js/Express para **armazenar, listar, baixar e remover arquivos**
usando o conceito de *object storage*, seguindo o protocolo do **Amazon S3**.

Em vez de usar a AWS de fato (evitando custos e complexidade nesta fase do
projeto), o servidor S3 é simulado localmente com o **MinIO**, rodando em
um container Docker. A comunicação com o MinIO é feita através do **SDK
oficial da AWS** (`@aws-sdk/client-s3`), e não de uma biblioteca própria do
MinIO — ou seja, o mesmo código funcionaria contra um bucket real da AWS
apenas trocando as variáveis de ambiente (endpoint e credenciais).

---

## 1. Arquitetura da solução

```
Cliente (Postman/Insomnia/REST Client)
        │
        ▼
  API Node.js (Express)
        │  @aws-sdk/client-s3
        ▼
   MinIO (Docker) ── compatível com o protocolo S3
```

- **Express**: expõe os endpoints HTTP.
- **Multer**: intercepta o upload `multipart/form-data` e entrega o arquivo
  em memória (buffer) para a API.
- **@aws-sdk/client-s3**: biblioteca oficial da AWS, usada para falar com
  o MinIO como se fosse o S3 (`PutObjectCommand`, `ListObjectsV2Command`,
  `GetObjectCommand`, `DeleteObjectCommand`).
- **MinIO**: servidor de objetos compatível com S3, rodando via Docker.

## 2. Estrutura de pastas

```
minio-s3-api/
├── docker-compose.yml       # Sobe o MinIO
├── .env.example             # Modelo de variáveis de ambiente
├── package.json
└── src/
    ├── server.js             # Ponto de entrada da API
    ├── config/
    │   └── s3Client.js       # Configuração do cliente S3 apontando pro MinIO
    ├── routes/
    │   └── files.js          # Rotas de upload, listagem, download e remoção
    └── utils/
        └── ensureBucket.js   # Garante que o bucket exista ao iniciar
```

## 3. Pré-requisitos

- Node.js 18+
- Docker e Docker Compose

## 4. Passo a passo para rodar o projeto

### 4.1 Subir o MinIO

```bash
docker-compose up -d
```

Isso sobe dois serviços na mesma porta do container `minio`:

- **API S3 do MinIO**: `http://localhost:9000`
- **Console Web do MinIO**: `http://localhost:9001`
  (login: `minioadmin` / senha: `minioadmin123`, definidos no
  `docker-compose.yml`)

O console web é opcional — serve apenas para visualizar, pelo navegador,
os arquivos que a API for enviando ao bucket.

### 4.2 Configurar as variáveis de ambiente

```bash
cp .env.example .env
```

O arquivo `.env` já vem com valores padrão compatíveis com o
`docker-compose.yml` (mesmo usuário/senha do MinIO). Não é necessário
criar o bucket manualmente: a própria API verifica, na inicialização, se
o bucket configurado (`S3_BUCKET`) existe e o cria automaticamente caso
não exista (ver `src/utils/ensureBucket.js`).

### 4.3 Instalar dependências e iniciar a API

```bash
npm install
npm start
```

Saída esperada no terminal:

```
Bucket "meus-arquivos" não encontrado. Criando...
Bucket "meus-arquivos" criado com sucesso.
Servidor rodando em http://localhost:3000
Bucket em uso: meus-arquivos
```

## 5. Endpoints disponíveis

| Método | Rota          | Descrição                                   |
|--------|---------------|----------------------------------------------|
| GET    | `/`           | Informações básicas da API                    |
| POST   | `/files`      | Faz upload de um arquivo (campo `file`)       |
| GET    | `/files`      | Lista todos os arquivos armazenados no bucket |
| GET    | `/files/:key` | Baixa um arquivo específico pela sua chave    |
| DELETE | `/files/:key` | Remove um arquivo específico pela sua chave   |

### 5.1 Testando com Postman / Insomnia / REST Client

**Upload de arquivo**

```
POST http://localhost:3000/files
Content-Type: multipart/form-data

Body (form-data):
  key:  file
  type: File
  valor: (selecionar um arquivo do computador)
```

Resposta esperada:

```json
{
  "message": "Arquivo enviado com sucesso.",
  "key": "1717000000000-exemplo.pdf",
  "originalName": "exemplo.pdf",
  "size": 10240,
  "mimeType": "application/pdf"
}
```

**Listar arquivos**

```
GET http://localhost:3000/files
```

```json
{
  "bucket": "meus-arquivos",
  "total": 1,
  "files": [
    {
      "key": "1717000000000-exemplo.pdf",
      "size": 10240,
      "lastModified": "2026-08-30T12:00:00.000Z"
    }
  ]
}
```

**Baixar arquivo**

```
GET http://localhost:3000/files/1717000000000-exemplo.pdf
```

**Remover arquivo**

```
DELETE http://localhost:3000/files/1717000000000-exemplo.pdf
```

Se estiver usando a extensão **REST Client** do VS Code, um arquivo
`requests.http` com esses mesmos exemplos pode ser criado a partir do
modelo acima (não incluído aqui por depender de um arquivo local real
para o upload).

## 6. Passos executados durante o desenvolvimento

1. Definição do `docker-compose.yml` com a imagem oficial `minio/minio`,
   expondo a porta `9000` (API) e `9001` (console).
2. Criação do projeto Node.js (`npm init`) e instalação das dependências:
   `express`, `@aws-sdk/client-s3`, `multer`, `dotenv`, `cors`.
3. Configuração do `S3Client` apontando para o endpoint do MinIO.
4. Implementação da rotina de verificação/criação automática do bucket
   na subida da aplicação.
5. Implementação das rotas de upload, listagem, download e remoção de
   arquivos.
6. Testes manuais dos endpoints via cliente HTTP.

## 7. Dificuldades encontradas e como foram resolvidas

- **O SDK da AWS, por padrão, monta as URLs no formato
  "virtual-hosted" (`bucket.endpoint.com`)**, que não funciona contra o
  MinIO rodando localmente. A solução foi habilitar a opção
  `forcePathStyle: true` no `S3Client`, que faz o SDK montar as URLs no
  formato `endpoint/bucket` — o formato que o MinIO local espera.

- **Necessidade de criar o bucket manualmente antes de qualquer
  upload.** Para não depender de um passo manual pelo console do MinIO,
  foi criada a função `ensureBucket`, que verifica com `HeadBucketCommand`
  se o bucket existe e, caso não exista, cria com `CreateBucketCommand`
  automaticamente ao iniciar o servidor.

- **Diferença entre o retorno de `GetObjectCommand` no navegador e no
  Node.js.** No Node.js, o campo `Body` retornado é um stream legível
  (`Readable`), então o arquivo é entregue ao cliente com `Body.pipe(res)`
  em vez de ser convertido inteiramente para buffer antes de responder —
  isso evita carregar arquivos grandes inteiramente na memória apenas
  para o download.

- **Aviso de vulnerabilidade do `multer@1.x`.** Durante a instalação, o
  npm alertou que a versão 1.x do Multer possui vulnerabilidades
  conhecidas, já corrigidas na versão 2.x. O `package.json` foi ajustado
  para usar `multer@^2.0.0`.

- **Nomes de arquivo duplicados.** Como o S3 (e o MinIO) não têm uma
  restrição própria contra sobrescrita de objetos com a mesma chave, um
  upload de um arquivo com nome repetido substituiria silenciosamente o
  anterior. Para evitar isso, cada chave gravada no bucket recebe um
  prefixo com timestamp (`Date.now()-nomeOriginal`), garantindo chaves
  únicas mesmo para arquivos com o mesmo nome original.

- **Validação sem um MinIO ativo.** Durante o desenvolvimento, os testes
  de sintaxe e inicialização foram feitos antes de subir o container do
  MinIO; nesse cenário a aplicação falha, de forma esperada e tratada,
  com `ECONNREFUSED` ao tentar verificar o bucket — confirmando que o
  ponto de falha é a ausência do MinIO, e não um erro de código.

## 8. Como subir este projeto no GitHub

```bash
git init
git add .
git commit -m "API Node.js de armazenamento de objetos com MinIO (S3)"
git branch -M main
git remote add origin https://github.com/<seu-usuario>/minio-s3-api.git
git push -u origin main
```

> O arquivo `.env` **não** deve ser versionado (já está listado no
> `.gitignore`) — apenas o `.env.example`, que serve de modelo para quem
> for clonar o repositório.

## 9. Encerrando o ambiente

```bash
docker-compose down       # para o MinIO
docker-compose down -v    # para o MinIO e apaga os dados armazenados
```
