{{- define "store.name" -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- define "store.labels" -}}
app.kubernetes.io/name: urumi-store
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
