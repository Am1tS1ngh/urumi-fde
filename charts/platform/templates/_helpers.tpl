{{- define "platform.labels" -}}
app.kubernetes.io/part-of: urumi-platform
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "platform.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "platform.podSecurity" -}}
automountServiceAccountToken: false
securityContext:
  runAsNonRoot: true
  seccompProfile: { type: RuntimeDefault }
{{- end -}}

{{- define "platform.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: [ALL] }
{{- end -}}

{{/* The in-cluster host name of an upstream, from its slug. */}}
{{- define "platform.upstreamHost" -}}
{{ .slug }}-mcp.{{ .root.Release.Namespace }}.svc.cluster.local
{{- end -}}

{{- define "platform.credentialEnv" -}}
UPSTREAM_{{ upper . }}_CREDENTIAL
{{- end -}}
