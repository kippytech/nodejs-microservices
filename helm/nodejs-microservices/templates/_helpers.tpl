{{/*
Chart name
*/}}
{{- define "nodejs-microservices.name" -}}
{{ .Chart.Name }}
{{- end }}

{{/*
Namespace
*/}}
{{- define "nodejs-microservices.namespace" -}}
{{ .Values.namespace }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "nodejs-microservices.labels" -}}
app.kubernetes.io/managed-by: Helm
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}