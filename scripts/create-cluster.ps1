Write-Host "Creating Kind cluster..."

kind create cluster --name microservices --config kind-config.yaml

Write-Host "Installing NGINX Ingress..."

kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

kubectl rollout status deployment/ingress-nginx-controller `
    -n ingress-nginx `
    --timeout=180s

Write-Host "Installing Metrics Server..."

kubectl apply -f infrastructure/metrics-server.yaml

kubectl rollout status deployment/metrics-server `
    -n kube-system `
    --timeout=180s

Write-Host "Waiting for Metrics API..."

Start-Sleep -Seconds 20

kubectl top nodes

Write-Host ""
Write-Host "Cluster ready."

# mkdir infrastructure

# curl.exe -L `
# https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml `
# -o infrastructure/metrics-server.yaml