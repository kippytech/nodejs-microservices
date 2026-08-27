output "cluster_id" {
  value = aws_eks_cluster.this.id
}

output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "cluster_certificate_authority" {
  value     = aws_eks_cluster.this.certificate_authority[0].data
  sensitive = true
}

output "node_group_name" {
  value = aws_eks_node_group.this.node_group_name
}