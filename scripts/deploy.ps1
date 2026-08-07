Write-Host "Loading Docker images..."

kind load docker-image nodejs-microservices-2025-api-gateway:latest --name microservices

kind load docker-image nodejs-microservices-2025-identity-service:latest --name microservices

kind load docker-image nodejs-microservices-2025-post-service:latest --name microservices

kind load docker-image nodejs-microservices-2025-media-service:latest --name microservices

kind load docker-image nodejs-microservices-2025-search-service:latest --name microservices

Write-Host ""

Write-Host "Deploying Helm chart..."

helm upgrade --install nodejs-microservices `
    ./helm/nodejs-microservices `
    --namespace development `
    --create-namespace

if ($LASTEXITCODE -ne 0) {
    Write-Error "Helm deployment failed."
    exit 1
}

kubectl get pods -n development

Write-Host ""
Write-Host "Deployment complete."

# kubectl create namespace argocd
# kubectl apply --server-side -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# kubectl port-forward svc/argocd-server -n argocd 8080:443
# [System.Text.Encoding]::UTF8.GetString(
#     [System.Convert]::FromBase64String(
#         (kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}")
#     )
# )
# winget install ArgoCD.ArgoCD --this fails so use below
# $version = (Invoke-RestMethod https://api.github.com/repos/argoproj/argo-cd/releases/latest).tag_name

# $url = "https://github.com/argoproj/argo-cd/releases/download/$version/argocd-windows-amd64.exe"

# Invoke-WebRequest -Uri $url -OutFile argocd.exe

# argocd login localhost:8080 --insecure
# argocd account get-user-info

# argocd repo add https://github.com/kippytech/nodejs-microservices.git

# create application.yaml

# test pruning --> kubectl delete statefulset redis -n development
# test self-healing --> kubectl scale deployment post-service  --replicas=3 -n development