# scripts/cleanup.ps1

Write-Host "Deleting Kind cluster..." -ForegroundColor Cyan

kind delete cluster --name microservices

Write-Host ""
Write-Host "Pruning Docker build cache..." -ForegroundColor Cyan

docker builder prune -f

Write-Host ""
Write-Host "Removing unused containers, networks and dangling images..." -ForegroundColor Cyan

docker system prune -f

Write-Host ""
Write-Host "Cleanup complete." -ForegroundColor Green