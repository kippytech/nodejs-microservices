kind create cluster --name microservices --config kind-config.yaml

# Load images
kind load docker-image nodejs-microservices-2025-api-gateway:latest --name microservices
kind load docker-image nodejs-microservices-2025-identity-service:latest --name microservices
kind load docker-image nodejs-microservices-2025-post-service:latest --name microservices
kind load docker-image nodejs-microservices-2025-media-service:latest --name microservices
kind load docker-image nodejs-microservices-2025-search-service:latest --name microservices

# Install ingress
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Install Metrics Server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch Metrics Server (Kind)
kubectl patch deployment metrics-server \
  -n kube-system \
  --type=json \
  --patch='[...]'

# Wait
kubectl rollout status deployment metrics-server -n kube-system

# Deploy your application
helm install nodejs-microservices \
  ./helm/nodejs-microservices \
  --namespace development \
  --create-namespace

# #raw manifests

# # Create cluster
# kind create cluster --name microservices --config kind-config.yaml

# # Load images
# kind load docker-image nodejs-microservices-2025-api-gateway:latest --name microservices
# kind load docker-image nodejs-microservices-2025-identity-service:latest --name microservices
# kind load docker-image nodejs-microservices-2025-post-service:latest --name microservices
# kind load docker-image nodejs-microservices-2025-media-service:latest --name microservices
# kind load docker-image nodejs-microservices-2025-search-service:latest --name microservices

# # Create namespace FIRST
# kubectl apply -f k8s/namespace.yaml

# # Wait until namespace exists
# kubectl wait --for=jsonpath='{.metadata.name}'=development namespace/development --timeout=60s

# # Apply everything else recursively
# kubectl apply -R -f k8s


# # Apply namespace first
# kubectl apply -f "k8s/00-namespace.yaml"

# # Wait until namespace exists
# kubectl wait --for=jsonpath='{.status.phase}'=Active namespace/development --timeout=30s

# # Apply every other yaml file automatically
# Get-ChildItem "k8s" -Recurse -Filter *.yaml |
# Where-Object { $_.Name -ne "00-namespace.yaml" } |
# Sort-Object FullName |
# ForEach-Object {
#     Write-Host "Applying $($_.FullName)"
#     kubectl apply -f $_.FullName
# }

#.\scripts\setup-kind.ps1

# docker compose build post-service
# kind load docker-image nodejs-microservices-2025-post-service:latest --name microservices
# kubectl rollout restart deployment post-service -n development

# kind create cluster --config kind-config.yaml
# helm install social-network ./helm


# metrics server
# kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# kubectl edit deployment metrics-server -n kube-system and add the following args under spec.template.spec.containers.args:
# - --kubelet-insecure-tls
# kubectl top pods
# kubectl top pods -n development

# hpa load test
# kubectl run load-generator --rm -it --image=busybox --restart=Never -- sh
# while true; do wget -qO- http://api-gateway.development.svc.cluster.local:3000/api/health; done