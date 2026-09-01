# Node.js Microservices Platform
A production-oriented social platform backend built with **Node.js, Express, MongoDB, Redis, RabbitMQ, BullMQ, and Cloudinary**, with distributed tracing, metrics, centralized logging, automated alerting, containerization, and Kubernetes-based GitOps deployment.

The system is designed around independently deployable services and asynchronous event-driven communication, while maintaining reliability through transactional outbox processing, idempotent consumers, retries, dead-letter queues, background jobs, and graceful shutdown.

## Architecture
The application is composed of five Node.js services:

* **API Gateway** — public entry point for client requests, authentication, rate limiting, request correlation, routing, and metrics.

* **Identity Service** — user registration, authentication, JWT issuance, refresh-token rotation, logout, and authentication rate limiting.

* **Post Service** — post creation, retrieval, deletion, Redis caching, transactional outbox processing, and event publication.

* **Media Service** — media upload, Cloudinary integration, media association, and asynchronous media cleanup.

* **Search Service** — asynchronous indexing and full-text search of posts.

Supporting infrastructure includes:

* **MongoDB** — service-specific persistence.

* **Redis** — caching, rate limiting, and BullMQ infrastructure.

* **RabbitMQ** — asynchronous service-to-service event communication.

* **BullMQ** — background job processing.

* **Cloudinary** — media storage.

* **Prometheus** — metrics collection and alert evaluation.

* **Grafana** — metrics visualization.

* **Loki** — centralized log aggregation.

* **Promtail** — log collection.

* **Jaeger** — distributed trace visualization.

* **OpenTelemetry Collector** — trace collection and export.

* **Alertmanager** — alert routing.

* **Discord** — operational alert notifications.

* **Docker** — containerization and local orchestration.

* **Kubernetes + Helm** — production orchestration and deployment packaging.

* **Argo CD** — GitOps continuous delivery.

* **GitHub Actions** — CI/CD automation.

* **GitHub Container Registry** — container image registry.

## High-Level Architecture
```text

                              ┌─────────────────────┐

                              │       Client        │

                              └──────────┬──────────┘

                                         │

                                         ▼

                              ┌─────────────────────┐

                              │    API Gateway      │

                              │                     │

                              │ • Authentication    │

                              │ • Rate limiting     │

                              │ • Routing           │

                              │ • Correlation IDs   │

                              │ • Metrics            │

                              └───────┬─────────────┘

                                      │

                 ┌────────────────────┼────────────────────┐

                 │                    │                    │

                 ▼                    ▼                    ▼

        ┌────────────────┐   ┌────────────────┐   ┌────────────────┐

        │ Identity       │   │ Post           │   │ Media          │

        │ Service        │   │ Service        │   │ Service        │

        └───────┬────────┘   └───────┬────────┘   └───────┬────────┘

                │                    │                    │

                ▼                    ▼                    ▼

           MongoDB              MongoDB               MongoDB

                                     │

                                     │ Outbox

                                     ▼

                              ┌──────────────┐

                              │  RabbitMQ    │

                              └──────┬───────┘

                                     │

                         ┌───────────┴───────────┐

                         ▼                       ▼

                ┌────────────────┐      ┌────────────────┐

                │ Search Service │      │ Media Service  │

                └───────┬────────┘      └───────┬────────┘

                        │                       │

                        ▼                       ▼

                    MongoDB                BullMQ / Redis

                                                │

                                                ▼

                                           Cloudinary

```

## Service Responsibilities
### API Gateway
The API Gateway provides the public HTTP entry point to the backend.

Responsibilities include:

* Routing requests to downstream services.

* JWT validation for protected routes.

* Request correlation IDs.

* HTTP request metrics.

* Structured request/response logging.

* Security headers through Helmet.

* CORS configuration.

* Distributed rate limiting using Redis.

* Downstream correlation propagation.

* HTTP server timeout configuration.

* Graceful shutdown.

* Health and readiness endpoints.

The gateway exposes the services through a unified API rather than requiring clients to communicate directly with internal services.

### Identity Service
The Identity Service owns authentication and user identity.

It provides:

* User registration.

* User login.

* JWT access tokens.

* Refresh tokens.

* Refresh-token rotation.

* Logout/revocation through refresh-token deletion.

* Argon2 password hashing.

* MongoDB persistence.

* Redis-backed authentication rate limiting.

* TTL-based refresh-token expiration.

* Health and readiness checks.

* Graceful shutdown.

Registration and login attempts are rate limited using Redis-backed `rate-limiter-flexible`.

### Post Service
The Post Service owns post creation, retrieval, deletion, caching, and event publication.

It provides:

* Create post.

* Retrieve posts.

* Retrieve an individual post.

* Delete post.

* Redis caching.

* Cache invalidation.

* MongoDB transactions.

* Transactional Outbox.

* Outbox worker.

* Outbox retry and failure handling.

* Outbox administrative inspection/retry operations.

Post creation and deletion use MongoDB transactions to atomically persist the database change together with the corresponding outbox event.

### Media Service
The Media Service manages uploaded media.

The upload flow is:

```text

Client

  │

  ▼

API Gateway

  │

  ▼

Media Service

  │

  ├──► Cloudinary

  │

  └──► MongoDB

```

Media uploads are protected by a 5 MB upload limit and use memory-backed Multer storage before being uploaded to Cloudinary.

Cloudinary operations include explicit timeouts and OpenTelemetry spans.

If a Cloudinary upload succeeds but the subsequent database operation fails, the service performs a compensating Cloudinary deletion. If that cleanup also fails, the cleanup can be delegated to a BullMQ background job.

When a post is deleted, the Media Service receives the `post.deleted` event and queues media deletion jobs through BullMQ.

### Search Service
The Search Service maintains a search-oriented representation of posts.

It consumes:

* `post.created`

* `post.deleted`

Events are processed asynchronously through RabbitMQ.

The service maintains a dedicated search collection with a MongoDB text index:

```text

Post Service

     │

     │ post.created

     ▼

 RabbitMQ

     │

     ▼

Search Service

     │

     ▼

Search MongoDB

```

Search queries use MongoDB's text search and text relevance scores.

Event consumers use a `ProcessedEvent` collection with a unique `eventId` to provide idempotent event processing.

## Event-Driven Architecture
RabbitMQ uses a durable topic exchange for application events.

```text

                         facebook_events

                              │

                    ┌─────────┴─────────┐

                    │                   │

              post.created        post.deleted

                    │                   │

              ┌─────┴─────┐       ┌────┴─────┐

              ▼           ▼       ▼          ▼

          Search       Media   Search      Media

          Service      Service Service     Service

```

Consumers use routing keys to select events and dispatch them to the appropriate handler.

The consumer architecture intentionally uses **one queue per service instance** with routing-key dispatch inside the consumer. This avoids assuming that RabbitMQ will route different event types to different consumers merely because they are consuming from the same queue.

### RabbitMQ Reliability
The messaging layer includes:

* Durable exchanges.

* Durable queues.

* Persistent messages.

* Publisher confirms.

* Consumer acknowledgements.

* Consumer prefetch.

* Dead-letter exchange.

* Dead-letter queue.

* Consumer failure metrics.

* Event processing duration metrics.

* Correlation ID propagation.

* OpenTelemetry trace propagation.

* Graceful RabbitMQ shutdown.

Failed messages are rejected without immediate requeue and can therefore reach the configured dead-letter infrastructure.

## Transactional Outbox
The Post Service uses the transactional outbox pattern to avoid the dual-write problem.

Instead of:

```text

Database transaction

       │

       ├── save post

       │

       └── publish RabbitMQ event

```

the service performs:

```text

MongoDB Transaction

       │

       ├── Save Post

       │

       └── Save Outbox Event

                 │

                 ▼

          Transaction commits

                 │

                 ▼

          Outbox Worker

                 │

                 ▼

             RabbitMQ

```

This means the post and its corresponding event are persisted atomically.

The outbox worker:

1. Finds a pending event.

2. Atomically changes it to `PROCESSING`.

3. Publishes it to RabbitMQ.

4. Marks it `PUBLISHED` after successful publication.

5. Records failures.

6. Retries failed events.

7. Permanently marks events as `FAILED` after the configured maximum number of attempts.

8. Recovers stale `PROCESSING` events.

9. Periodically removes old published events.

The outbox has indexes supporting pending-event processing, published-event cleanup, and stale-processing recovery.

An administrative API also allows failed events to be inspected and retried.

## Idempotent Event Processing
Asynchronous messaging can result in duplicate delivery.

Consumers therefore maintain a `ProcessedEvent` collection with a unique `eventId`.

```text

RabbitMQ Event

      │

      ▼

Check eventId

      │

 ┌────┴────┐

 │         │

New      Duplicate

 │         │

 ▼         ▼

Process   Ignore

```

Search Service performs event registration and its business operation inside the same MongoDB transaction.

This prevents a duplicate event from producing duplicate search records.

Media Service additionally uses deterministic BullMQ job IDs when queuing media deletion jobs.

## Background Processing
BullMQ is used for work that does not need to complete synchronously with an HTTP request.

The Media Service uses background jobs for media deletion and cleanup.

```text

Post deleted

     │

     ▼

RabbitMQ

     │

     ▼

Media Service

     │

     ▼

BullMQ

     │

     ▼

Media Delete Worker

     │

     ├──► Cloudinary

     │

     └──► MongoDB

```

Jobs support:

* Concurrent processing.

* Retries.

* Exponential backoff.

* Deterministic job IDs.

* Completion/failure events.

* Prometheus metrics.

* OpenTelemetry tracing.

* Graceful worker shutdown.

## Caching
Redis is used by the Post Service for response caching.

Cached data includes:

* Post lists.

* Individual posts.

Cache invalidation uses Redis `UNLINK` rather than blocking deletion.

For post-list invalidation, the implementation uses Redis incremental scanning rather than the blocking `KEYS` command.

Cached entries have explicit expiration periods.

Redis is also used for authentication rate limiting and BullMQ infrastructure.

## Authentication
Authentication is JWT-based.

```text

Client

  │

  │ Authorization: Bearer <JWT>

  ▼

API Gateway

  │

  ├── verify JWT

  │

  └── extract user identity

          │

          ▼

      downstream service

```

The gateway validates the access token and forwards authenticated identity information to protected services.

The Identity Service uses:

* Argon2 password hashing.

* Access tokens.

* Refresh tokens.

* Refresh-token rotation.

* MongoDB TTL indexes.

* Redis-backed login/register rate limiting.

## Observability
Observability is built into the application and infrastructure rather than being added only at deployment time.

### Metrics
Each service exposes Prometheus metrics through `/metrics`.

All services collect Node.js default metrics as well as service-specific application metrics.

Common HTTP metrics include:

* `http_request_duration_seconds`

* `http_requests_total`

Service-specific metrics include metrics for operations such as:

* Outbox publication.

* RabbitMQ event processing.

* BullMQ job processing.

* Cloudinary uploads.

This means the metrics exposed by `metrics.js` are **service-specific** rather than one identical metrics module copied across every service.

### Distributed Tracing
OpenTelemetry is used for distributed tracing.

The tracing path can span:

```text

HTTP Request

     │

     ▼

API Gateway

     │

     ▼

Post Service

     │

     ▼

Outbox Worker

     │

     ▼

RabbitMQ

     │

     ▼

Search / Media Service

     │

     ▼

BullMQ Worker

     │

     ▼

Cloudinary

```

Trace context is propagated through asynchronous boundaries using OpenTelemetry propagation headers.

The application also maintains correlation IDs using Node.js `AsyncLocalStorage`.

Production logs include:

* Service name.

* Correlation ID.

* Trace ID.

* Span ID.

* Timestamp.

* Structured metadata.

* Error stack traces.

### Logging
Winston provides application logging.

Development logs are human-readable, while production logs are emitted as structured JSON suitable for centralized collection.

### Centralized Logging
The logging pipeline uses:

```text

Kubernetes Pods

      │

      ▼

   Promtail

      │

      ▼

     Loki

      │

      ▼

   Grafana

```

The current Promtail configuration uses Kubernetes pod discovery and CRI log parsing.

An earlier Docker discovery configuration is retained as historical configuration for the pre-Kubernetes environment.

### Metrics and Alerting
Prometheus scrapes each service's `/metrics` endpoint.

```text

Services

   │

   ▼

Prometheus

   │

   ├──► Grafana

   │

   └──► Alertmanager

             │

             ▼

          Discord

```

Configured alerts include:

* Service downtime.

* High HTTP latency.

* High HTTP 5xx rates.

* RabbitMQ consumer failures.

* BullMQ job failures.

* Outbox publication failures.

Alertmanager sends alerts to Discord and can also send resolved notifications.

### Distributed Trace Visualization
OpenTelemetry Collector receives OTLP traces and exports them to Jaeger.

```text

Node.js Services

      │

      │ OTLP

      ▼

OpenTelemetry Collector

      │

      ▼

    Jaeger

```

## Health and Readiness
Services expose health/readiness endpoints.

Health answers whether the process itself is alive.

Readiness additionally considers service dependencies.

For services with RabbitMQ/MongoDB dependencies, readiness checks dependency state before returning `READY`.

This allows an orchestrator to distinguish:

```text

Process is alive

        ≠

Process is ready to receive traffic

```

## Graceful Shutdown
Services handle `SIGINT` and `SIGTERM`.

The shutdown sequence closes active resources before the process exits.

Depending on the service, this includes:

* HTTP server.

* MongoDB connections.

* Redis connections.

* RabbitMQ channels/connections.

* BullMQ workers.

* Outbox workers.

* Background cleanup intervals.

* OpenTelemetry SDK.

A shutdown timeout prevents a process from remaining indefinitely stuck during termination.

## Resilience
The project incorporates several layers of failure handling:

* Startup dependency retries.

* HTTP request timeouts.

* Redis retry/reconnection behavior.

* RabbitMQ connection monitoring.

* RabbitMQ publisher confirms.

* RabbitMQ dead-lettering.

* Event-processing retries.

* Outbox retries.

* Outbox stale-processing recovery.

* BullMQ retries.

* Exponential backoff.

* Cloudinary operation timeouts.

* Cloudinary compensating actions.

* Idempotent event processing.

* Health/readiness checks.

* Graceful shutdown.

## Security
Security-related measures include:

* JWT authentication.

* Argon2 password hashing.

* Helmet security headers.

* CORS.

* Redis-backed rate limiting.

* Login attempt limiting.

* Registration attempt limiting.

* Environment-based secrets.

* Containerized service isolation.

* Protected internal service communication through the gateway architecture.

## Docker
The services use **multi-stage Docker builds** with separate development and production targets.

Example structure:

```dockerfile

FROM node:24-alpine AS base

WORKDIR /app

COPY package*.json ./

FROM base AS development

ENV NODE_ENV=development

RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM base AS production

ENV NODE_ENV=production

RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]

```

The development target provides the development dependencies and development command, while the production target installs only production dependencies.

## Deployment Architecture
Kubernetes manifests exist in the repository, but the project uses **Helm as its Kubernetes deployment/package management mechanism**.

The Kubernetes deployment path includes:

```text

GitHub

  │

  ▼

GitHub Actions

  │

  ├── Build images

  │

  ├── Push images to GHCR

  │

  └── Update Helm values

             │

             ▼

          Git commit

             │

             ▼

          Argo CD

             │

             ▼

        Kubernetes

```

The repository therefore separates application image building from Kubernetes deployment through a GitOps workflow.

## CI/CD
### Continuous Integration
GitHub Actions runs CI on pushes and pull requests targeting `main` and `develop`.

The CI workflow:

1. Checks out the repository.

2. Installs Node.js 24.

3. Installs dependencies for all services.

4. Installs E2E test dependencies.

5. Builds and starts the Docker Compose environment.

6. Waits for the API Gateway.

7. Verifies containers.

8. Creates an E2E test user.

9. Runs Jest E2E tests.

10. Collects Docker logs on failure.

11. Uploads logs as GitHub Actions artifacts.

12. Shuts down the environment.

### Kubernetes GitOps Deployment
After successful CI on `main`, the Kubernetes deployment workflow:

1. Identifies whether application code changed.

2. Builds production images for the affected application services.

3. Pushes images to GHCR.

4. Updates the development Helm image tag.

5. Commits the Helm change.

6. Pushes the change back to Git.

Argo CD can then reconcile the desired Kubernetes state from Git.

### Container Registry
Production images are published to GitHub Container Registry under the project's GitHub organization/account namespace.

## End-to-End Testing
The E2E suite verifies an asynchronous business workflow rather than testing isolated endpoints only.

The main flow is:

```text

Register

   │

   ▼

Login

   │

   ▼

Upload Media

   │

   ▼

Create Post

   │

   ├──────────────► Outbox

   │                    │

   │                    ▼

   │                 RabbitMQ

   │                    │

   │                    ▼

   │              Search Service

   │

   ▼

Verify Search Index

   │

   ▼

Delete Post

   │

   ├──────────────► Outbox

   │                    │

   │                    ▼

   │                 RabbitMQ

   │                    │

   │                    ▼

   │              Media Service

   │                    │

   │                    ▼

   │                  BullMQ

   │                    │

   │                    ▼

   │                Cloudinary

   │

   ▼

Verify Media Cleanup

```

Because the search indexing and media cleanup operations are asynchronous, the tests explicitly wait for eventual completion rather than assuming i**# Deployment**

The project can be reproduced at three infrastructure levels:

```text

Docker Compose

      ↓

Kubernetes / Kind

      ↓

AWS / EKS

```

The application and service architecture remains the same; each level adds
more infrastructure and operational capabilities.

<details>

<summary><strong>1. Docker Compose — local development / complete local stack</strong></summary>

## Prerequisites
Install:

* Git

* Node.js 24

* Docker Desktop / Docker Engine with Docker Compose

Clone the repository:

```bash

git clone https://github.com/kippytech/nodejs-microservices

cd nodejs-microservices

```

Install dependencies for the services and E2E tests:

```bash

cd api-gateway && npm ci && cd ..

cd identity-service && npm ci && cd ..

cd post-service && npm ci && cd ..

cd media-service && npm ci && cd ..

cd search-service && npm ci && cd ..

cd tests && npm ci && cd ..

```

Configure the required environment variables in the service `.env` files.

The Compose environment provides the infrastructure services:

* MongoDB

* Redis

* RabbitMQ

* Prometheus

* Grafana

* Alertmanager

* Jaeger

* OpenTelemetry Collector

* Loki

* Promtail

Start the complete development environment:

```bash

docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  up -d --build

```

Check the running services:

```bash

docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  ps

```

The API Gateway is available on:

```text

http://localhost:3000

```

Health:

```text

http://localhost:3000/api/health

```

The local observability interfaces include:

```text

Prometheus   → http://localhost:9090

Grafana      → http://localhost:3005

Alertmanager → http://localhost:9093

Jaeger       → http://localhost:16686

```

Run the E2E tests:

```bash

cd tests

npm test

```

Stop the environment:

```bash

docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  down -v

```

</details>
<details>

<summary><strong>2. Kubernetes + Helm — Kubernetes deployment / GitOps environment</strong></summary>

## Prerequisites
Install/configure:

* Docker

* Kubernetes

* `kubectl`

* Helm

* access to the target Kubernetes cluster

* access to the project's GitHub Container Registry images

* Argo CD for the GitOps deployment path

The repository contains Kubernetes resources, but **Helm is used as the project's Kubernetes packaging and deployment mechanism**.

The Helm chart is located under:

```text

helm/nodejs-microservices/

```

The chart contains environment-specific values, including development configuration.

## Build and publish images
Production images are built from the production stage of each service's multi-stage Dockerfile:

```bash

docker build \
  --target production \
  -t ghcr.io/<namespace>/api-gateway:<tag> \
  ./api-gateway

```

The same pattern applies to:

```text

identity-service

post-service

media-service

search-service

```

Images are pushed to GHCR.

The project's GitHub Actions deployment workflow automates this image-building and publishing process.

## Helm deployment
The Helm chart is used to render/deploy the Kubernetes resources.

A typical Helm workflow is:

```bash

helm lint helm/nodejs-microservices

```

Render the manifests:

```bash

helm template nodejs-microservices \
  helm/nodejs-microservices

```

Install or upgrade the release:

```bash

helm upgrade --install nodejs-microservices \
  helm/nodejs-microservices

```

Environment-specific values are supplied through the project's Helm values files.

## GitOps deployment
The preferred project deployment flow is GitOps:

```text

Application change

       │

       ▼

GitHub Actions

       │

       ├── CI

       │

       ├── Build production images

       │

       ├── Push images to GHCR

       │

       └── Update Helm image tag

                    │

                    ▼

                  Git

                    │

                    ▼

                 Argo CD

                    │

                    ▼

               Kubernetes

```

Argo CD continuously reconciles the Kubernetes environment against the desired state stored in Git.

## Verify deployment
List Helm releases:

```bash

helm list

```

List Kubernetes workloads:

```bash

kubectl get pods

```

List services:

```bash

kubectl get services

```

Inspect deployment state:

```bash

kubectl get deployments

```

Inspect a particular pod:

```bash

kubectl describe pod <pod-name>

```

View logs:

```bash

kubectl logs <pod-name>

```

</details>

<details>

<summary><strong>3. AWS / EKS — cloud deployment with Terraform + ALB + EBS + Argo CD</strong></summary>

The project can be deployed to AWS using **Terraform + Amazon EKS + Kubernetes + Argo CD**.

The AWS environment takes the Kubernetes deployment used locally with Kind and moves it into a real cloud environment with a production-style VPC, private worker nodes, managed Kubernetes, persistent EBS storage, AWS Load Balancer Controller, and a public Application Load Balancer.

### AWS Architecture
```text

                         Internet

                            │

                            ▼

                 ┌─────────────────────┐

                 │   AWS ALB            │

                 │  Public Subnets      │

                 └──────────┬──────────┘

                            │

                            ▼

                 ┌─────────────────────┐

                 │       EKS           │

                 │  Kubernetes API     │

                 └──────────┬──────────┘

                            │

             ┌──────────────┴──────────────┐

             │                             │

             ▼                             ▼

     ┌────────────────┐            ┌────────────────┐

     │ Private        │            │ Private        │

     │ Subnet 1       │            │ Subnet 2       │

     │                │            │                │

     │ EC2 / EKS      │            │ EC2 / EKS      │

     │ worker nodes   │            │ worker nodes   │

     └────────────────┘            └────────────────┘

             │                             │

             └──────────────┬──────────────┘

                            │

                            ▼

                    ┌──────────────┐

                    │ NAT Gateway  │

                    │ Public subnet │

                    └──────┬───────┘

                           │

                           ▼

                    ┌──────────────┐

                    │ Internet     │

                    │ Gateway      │

                    └──────────────┘

```

### AWS Components
The Terraform configuration provisions and configures:

* **VPC** with a `10.0.0.0/16` CIDR

* **Two Availability Zones**

* **Two public subnets**

* **Two private subnets**

* **Internet Gateway**

* **NAT Gateway**

* **Elastic IP** for the NAT Gateway

* **Amazon EKS cluster**

* **EC2-based EKS worker nodes**

* EKS node autoscaling configuration

* **AWS Load Balancer Controller**

* **Application Load Balancer**

* **EBS CSI Driver**

* **EKS Pod Identity Agent**

* IAM roles and policies for EKS components

* Kubernetes workloads deployed through **Helm**

* **Argo CD** for GitOps-based deployment

* Persistent storage backed by **Amazon EBS gp3**

### Network Design
The VPC separates public-facing infrastructure from Kubernetes worker nodes.

```text

VPC: 10.0.0.0/16

├── Public Subnet

│   └── eu-north-1a

│       └── ALB / NAT Gateway

│

├── Public Subnet

│   └── eu-north-1b

│       └── ALB

│

├── Private Subnet

│   └── eu-north-1a

│       └── EKS worker nodes

│

└── Private Subnet

    └── eu-north-1b

        └── EKS worker nodes

```

Public subnets have a default route through the Internet Gateway.

Private subnets use the NAT Gateway for outbound internet access without exposing the worker nodes directly to the public internet.

The Kubernetes worker nodes are therefore placed in **private subnets**, while the public Application Load Balancer is placed in the public subnets.

### Infrastructure as Code
AWS infrastructure is defined using Terraform.

The configuration is organized into reusable modules:

```text

terraform/

├── environments/

│   └── dev/

│       └── main.tf

│

└── modules/

    ├── network/

    │   ├── main.tf

    │   ├── outputs.tf

    │   └── variables.tf

    │

    └── eks/

        ├── main.tf

        ├── outputs.tf

        ├── variables.tf

        ├── ebs-csi.tf

        ├── load-balancer-controller.tf

        └── aws-load-balancer-controller-iam-policy.json

```

The development environment composes the network and EKS modules:

```hcl

module "network" {

  source = "../../modules/network"

  environment = "dev"

  vpc_cidr = "10.0.0.0/16"

  availability_zones = [

    "eu-north-1a",

    "eu-north-1b",

  ]

  public_subnet_cidrs = [

    "10.0.1.0/24",

    "10.0.2.0/24",

  ]

  private_subnet_cidrs = [

    "10.0.101.0/24",

    "10.0.102.0/24",

  ]

  enable_nat_gateway = true

}

```

The EKS cluster is then deployed into the private subnets:

```hcl

module "eks" {

  source = "../../modules/eks"

  environment = "dev"

  cluster_name       = "nodejs-microservices-dev"

  kubernetes_version = "1.35"

  private_subnet_ids = module.network.private_subnet_ids

  node_instance_types = [

    "t3.small"

  ]

  node_min_size     = 1

  node_max_size     = 3

  node_desired_size = 3

}

```

This allows the infrastructure to be recreated rather than manually configured through the AWS console.

### Amazon EKS
The Kubernetes cluster runs on **Amazon EKS** with EC2 worker nodes.

The current development configuration uses:

```text

Kubernetes: 1.35

Instance type: t3.small

Desired nodes: 3

Minimum nodes: 1

Maximum nodes: 3

```

The worker nodes are deployed exclusively into the private subnets.

The EKS configuration also establishes the required IAM roles for:

* EKS control plane

* EC2 worker nodes

* EBS CSI

* AWS Load Balancer Controller

### EKS Pod Identity
AWS IAM permissions for Kubernetes workloads are provided through **EKS Pod Identity**.

The infrastructure enables the:

```text

eks-pod-identity-agent

```

and associates IAM roles with Kubernetes service accounts.

This is used for components such as:

* EBS CSI Driver

* AWS Load Balancer Controller

This avoids giving broad AWS credentials directly to application containers.

### EBS CSI and Persistent Storage
The cluster uses the **AWS EBS CSI Driver** to allow Kubernetes workloads to provision persistent EBS-backed storage.

The EBS CSI driver is installed as an EKS add-on and receives its AWS permissions through EKS Pod Identity.

The project uses **gp3 EBS volumes** for persistent Kubernetes storage.

This provides a transition from ephemeral container storage in the local environment to cloud-backed persistent storage in AWS.

### Public Application Load Balancer
The Kubernetes application is publicly accessible through an **AWS Application Load Balancer**.

The AWS Load Balancer Controller integrates Kubernetes `Ingress` resources with AWS and provisions/manages the ALB.

The flow is:

```text

Internet

   │

   ▼

Public ALB

   │

   ▼

Kubernetes Ingress

   │

   ▼

Kubernetes Service

   │

   ▼

API Gateway

   │

   ├── Identity Service

   ├── Post Service

   ├── Media Service

   └── Search Service

```

The ALB is therefore the public entry point while the underlying EKS worker nodes remain in private subnets.

The deployed application is accessible through the ALB's public DNS endpoint.

### Argo CD / GitOps
AWS Kubernetes deployment is managed through **Argo CD**.

The cloud environment has a dedicated Argo CD `ApplicationSet`:

```text

argocd/

└── cloud-lab-applicationset.yaml

```

The ApplicationSet points Argo CD at the project's Helm chart:

```text

helm/nodejs-microservices

```

and uses environment-specific values:

```text

values.yaml

values-dev.yaml

```

The cloud application is configured for automated synchronization:

```yaml

syncPolicy:

  automated:

    prune: true

    selfHeal: true

```

Therefore, the AWS deployment follows the GitOps flow:

```text

Developer

    │

    ▼

GitHub

    │

    ▼

Argo CD

    │

    ▼

Helm

    │

    ▼

Amazon EKS

    │

    ▼

Application

```

With automated pruning and self-healing enabled, Argo CD continuously works to keep the Kubernetes cluster synchronized with the desired state stored in Git.

### Local → Kubernetes → AWS
The project deliberately supports multiple deployment environments.

#### Docker Compose
```text

Developer machine

      │

      ▼

Docker Compose

      │

      ├── API Gateway

      ├── Identity

      ├── Post

      ├── Media

      ├── Search

      ├── MongoDB

      ├── Redis

      ├── RabbitMQ

      └── Observability stack

```

Used for local development and reproducing the complete system.

#### Kubernetes / Kind
```text

Developer machine

      │

      ▼

Kind Kubernetes cluster

      │

      ├── Deployments

      ├── Services

      ├── ConfigMaps / Secrets

      ├── Persistent storage

      ├── Probes

      └── Observability

```

Used to demonstrate Kubernetes orchestration locally before moving to the cloud.

#### AWS / EKS
```text

Internet

   │

   ▼

AWS ALB

   │

   ▼

EKS

   │

   ├── Private EC2 worker nodes

   ├── Kubernetes workloads

   ├── EBS persistent storage

   └── Argo CD GitOps

```

Used to demonstrate actual cloud deployment, AWS networking, managed Kubernetes, IAM integration, persistent storage, public ingress, and GitOps deployment.

### Reproducing the AWS Deployment
> **Warning:** The AWS environment creates billable resources. Do not apply the Terraform configuration unless you understand the AWS resources being created and intend to incur the associated costs.

From the Terraform environment:

```bash

cd terraform/environments/dev

```

Initialize Terraform:

```bash

terraform init

```

Review the infrastructure:

```bash

terraform plan

```

Apply the infrastructure:

```bash

terraform apply

```

After Terraform provisions the VPC and EKS infrastructure, configure `kubectl` for the cluster and deploy the Kubernetes/Argo CD components according to the cloud deployment manifests.

Verify the EKS cluster:

```bash

kubectl get nodes

```

Verify the workloads:

```bash

kubectl get pods -A

```

Verify the ingress:

```bash

kubectl get ingress -A

```

The ALB provisioned by the AWS Load Balancer Controller provides the public endpoint for the application.

### What the AWS Deployment Demonstrates
The AWS deployment demonstrates practical experience with:

* AWS VPC design

* CIDR allocation

* Availability Zones

* public/private subnet architecture

* Internet Gateway routing

* NAT Gateway and outbound private-subnet connectivity

* EKS cluster provisioning

* EC2 worker nodes

* Kubernetes networking

* IAM roles and policies

* EKS Pod Identity

* AWS Load Balancer Controller

* public ALB ingress

* EBS persistent storage

* EBS CSI

* gp3 storage

* Terraform modules

* infrastructure as code

* Helm-based application deployment

* Argo CD GitOps

* automated synchronization

* Kubernetes self-healing

* cloud deployment of a distributed Node.js microservices system

The result is not simply a local Kubernetes demo: the same application architecture has been taken from **Docker Compose → Kubernetes → AWS EKS**, with the cloud environment exposed through a real public Application Load Balancer.

</details>

## Deployment Model
| Environment | Main purpose | Orchestration | Infrastructure |
|---|---|---|---|
| Docker Compose | Local development and E2E testing | Docker Compose | Local machine |
| Kubernetes / Kind | Kubernetes development and GitOps validation | Kubernetes + Helm + Argo CD | Local Kind cluster |
| AWS / EKS | Real cloud deployment | EKS + Helm + Argo CD | Terraform + AWS |

The progression is:

```text

Local application

      ↓

Containerized application

      ↓

Kubernetes workloads

      ↓

GitOps deployment

      ↓

AWS networking

      ↓

Managed Kubernetes

      ↓

AWS load balancing

      ↓

Cloud persistent storage

      ↓

Publicly accessible cloud deployment

```

---

# Project Structure
```text

.

├── api-gateway/

├── identity-service/

├── post-service/

├── media-service/

├── search-service/

├── tests/

├── helm/

│   └── nodejs-microservices/

├── k8s/

├── argocd/

│   └── cloud-lab-applicationset.yaml

├── monitoring/

├── terraform/

│   ├── environments/

│   │   └── dev/

│   │       └── main.tf

│   │

│   └── modules/

│       ├── network/

│       │   ├── main.tf

│       │   ├── outputs.tf

│       │   └── variables.tf

│       │

│       └── eks/

│           ├── main.tf

│           ├── outputs.tf

│           ├── variables.tf

│           ├── ebs-csi.tf

│           ├── load-balancer-controller.tf

│           └── aws-load-balancer-controller-iam-policy.json

├── docker-compose.yml

├── docker-compose.dev.yml

├── docker-compose.prod.yml

└── .github/

    └── workflows/

        ├── ci.yml

        ├── deploy.yml

        └── deploy-kubernetes.yml

```

The repository is organized into application, Kubernetes, GitOps,
observability, and cloud-infrastructure layers.

* `api-gateway/`, `identity-service/`, `post-service/`, `media-service/`, and `search-service/`
  contain the independently deployable backend services.
* `helm/` contains Kubernetes packaging and environment values.
* `k8s/` contains Kubernetes resources used by the project.
* `argocd/` contains GitOps configuration, including the AWS ApplicationSet.
* `monitoring/` contains observability configuration.
* `terraform/` contains AWS infrastructure-as-code modules and environment composition.
* `.github/workflows/` contains CI/CD automation.

Each service follows its own service-specific implementation while sharing common architectural patterns such as:

* Express.

* MongoDB/Mongoose where required.

* Redis where required.

* Structured logging.

* Correlation IDs.

* OpenTelemetry.

* Prometheus metrics.

* Health/readiness endpoints.

* Graceful shutdown.

* Docker multi-stage builds.

---

# Key Engineering Patterns
| Pattern              | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| API Gateway          | Centralized external entry point and request routing |
| Microservices        | Independent service ownership and deployment         |
| Transactional Outbox | Reliable database-to-event publication               |
| RabbitMQ             | Asynchronous service communication                   |
| Idempotent Consumers | Safe duplicate event handling                        |
| Dead-Letter Queues   | Isolation of repeatedly failed messages              |
| BullMQ               | Background job processing                            |
| Redis                | Caching, rate limiting, and job infrastructure       |
| MongoDB Transactions | Atomic multi-document operations                     |
| OpenTelemetry        | Distributed tracing                                  |
| Prometheus           | Metrics collection                                   |
| Grafana              | Metrics visualization                                |
| Loki                 | Centralized logging                                  |
| Promtail             | Kubernetes log collection                            |
| Jaeger               | Trace visualization                                  |
| Alertmanager         | Alert routing                                        |
| Discord              | Operational notifications                            |
| Docker               | Containerization                                     |
| Multi-stage Builds   | Separate development and production images           |
| Kubernetes           | Container orchestration                              |
| Helm                 | Kubernetes packaging/deployment                      |
| Argo CD              | GitOps continuous delivery                           |
| GitHub Actions       | CI/CD automation                                     |
| E2E Testing          | Verification of complete asynchronous workflows      |

# Reliability Philosophy
The architecture deliberately separates synchronous user-facing operations from asynchronous work.

For example, deleting a post does not require the HTTP request to synchronously complete every downstream operation:

```text

DELETE /posts/:id

       │

       ▼

MongoDB transaction

       │

       ├── Delete post

       └── Store post.deleted event

       │

       ▼

    Commit

       │

       ▼

 HTTP response

       │

       ▼

 Outbox worker

       │

       ▼

 RabbitMQ

       │

       ├── Search Service

       │

       └── Media Service

                 │

                 ▼

              BullMQ

                 │

                 ▼

             Cloudinary

```

This allows downstream failures to be retried independently while preserving the original database operation.

# Development Principles
The project emphasizes:

* Failure isolation.

* Eventual consistency where appropriate.

* Idempotency.

* Explicit dependency health.

* Observability across synchronous and asynchronous boundaries.

* Graceful resource management.

* Automated testing.

* Reproducible containerized environments.

* Infrastructure-as-code/declarative deployment.

* GitOps-based Kubernetes delivery.

* Separation between development and production container environments.

* Independent service ownership.