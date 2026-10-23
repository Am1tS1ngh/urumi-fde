# Store foundation: WordPress and MySQL

This checkpoint installs the infrastructure for one store. It does not yet create
a WordPress administrator, install WordPress tables, activate WooCommerce, or
connect the MCP adapter to real data.

## Understand the request path

Your browser opens `http://store.localhost:8080`. The k3d port mapping forwards it
to Traefik. The Ingress matches `store.localhost` and chooses the WordPress Service.
That Service sends traffic to a ready WordPress pod. WordPress reaches MySQL using
the internal DNS name `store-mysql` on port 3306.

- A **Deployment** manages a pod and replaces it if it fails. We use one replica
  and `Recreate` to avoid concurrent writers against these single-instance volumes.
- A **Service** supplies a stable internal address even when a pod's IP changes.
- A **PVC** requests a disk. The MySQL disk stores database files; the WordPress
  disk stores its files, configuration, themes, uploads and future plugins.
- A **Secret** holds database passwords. The chart contains only its name and key
  references. WordPress uses the dedicated `wordpress` database user, not root.
- **Ingress** selects a Service based on the request's hostname.

`store.localhost` uses local loopback resolution; no public DNS or hosting account
is needed. Port 8080 is the local HTTP entry point. If your browser cannot resolve
the hostname, diagnose DNS before changing it; `curl.exe --resolve
store.localhost:8080:127.0.0.1 http://store.localhost:8080/` can test the route.

## Files to read

1. `charts/store/Chart.yaml`: chart identity/version.
2. `charts/store/values.yaml`: shared settings; no passwords.
3. `values-local.yaml`: small disks/memory limits and local hostname.
4. `templates/mysql.yaml`: internal Service, database Deployment, probes and Secret
   references. The startup/readiness probes execute `SELECT 1` as the application
   user; the TCP liveness check does not restart MySQL merely for a failed query.
5. `templates/wordpress.yaml`: WordPress's DB configuration, volume mounts and probes.
6. `templates/health-configmap.yaml`: PHP liveness and database readiness checks.
7. `templates/storage.yaml` and `ingress.yaml`: persistent disks and browser routing.

The health endpoints verify PHP/process and DB availability. They do not prove a
WooCommerce checkout works. Startup probes allow initialization time before normal
liveness checks start. Resource requests guide scheduling; limits cap consumption.

## Install and inspect (PowerShell, project directory)

Docker Desktop must be running and the `urumi` cluster must be started first.
After a Windows restart or closing Docker Desktop, follow the restart section
below before running deployment commands. Run commands one at a time so you can
see which step fails.

```powershell
.\scripts\deploy-store-foundation.ps1
kubectl --kubeconfig .local/kubeconfig -n urumi get pods,pvc,svc,ingress
.\.local\tools\helm.exe status store --kubeconfig .local/kubeconfig -n urumi
curl.exe --resolve store.localhost:8080:127.0.0.1 http://store.localhost:8080/ready.php
```

Expected after installation: both Deployments available; two PVCs `Bound`; MySQL
and WordPress Services `ClusterIP`; readiness returns `{"status":"ready"}`; the
browser redirects to the WordPress installation form. Do not enter public or reused
credentials. Administrator creation and WooCommerce activation are the next step.

The script generates random credentials in ignored `.local/store-database.env`
and creates `store-database` in namespace `urumi`. It reuses existing credentials
on rerun. Never paste the file, Secret data, or kubeconfig into an issue/chat/Git.
Kubernetes Secrets are not automatically encrypted at rest just because they use
base64; production needs restricted access and an explicit secrets/encryption plan.

## Resume after a reboot or Docker shutdown

The deployment script installs/updates resources in a running cluster; it does not
start Docker or Kubernetes. The data can remain on disk while the entire stack is
stopped. In that state both `Cannot connect to Kubernetes` and browser
`ERR_CONNECTION_REFUSED` are expected.

1. Open Docker Desktop and wait until it shows **Engine running**. If it reports
   an error, resolve that error before continuing. The command-line alternative is
   `docker desktop start --timeout 120`.
2. From this project directory, run:

```powershell
.\scripts\create-local-cluster.ps1
kubectl --kubeconfig .local/kubeconfig -n urumi rollout status deployment/store-mysql --timeout=180s
kubectl --kubeconfig .local/kubeconfig -n urumi rollout status deployment/store-wordpress --timeout=180s
kubectl --kubeconfig .local/kubeconfig -n kube-system rollout status deployment/traefik --timeout=180s
curl.exe --fail --resolve store.localhost:8080:127.0.0.1 http://store.localhost:8080/ready.php
```

The cluster script reuses the existing `urumi` cluster and refreshes the ignored
kubeconfig. Expect a Ready node, successful rollouts and `{"status":"ready"}`.
Then reopen `http://store.localhost:8080`. An existing Helm deployment does not need
reinstallation just because Docker was stopped.

If Docker startup reports the `dockerInference` / `engine.sock` access error,
that is a Docker Desktop runtime problem. Do not reset Docker to factory defaults
or delete PVCs. The runtime-directory workaround used on this machine is recorded
in [Docker's issue tracker](https://github.com/docker/desktop-feedback/issues/531);
it is not a permanent upstream fix and can recur.

## Persistence and limitations

A pod replacement must keep the data in both PVCs. On 18 October this was verified
by writing a temporary SQL row and a temporary WordPress file, restarting both
Deployments, confirming different pod UIDs, and asserting that both values remained.
Both fixtures were removed afterward. The Ingress installation page returned HTTP
200 and the database-backed readiness check returned `{"status":"ready"}` again.
Rerunning the deployment script also succeeded and reused the existing Secret.
On a rerun, `kubectl apply --dry-run=server` may warn about a missing last-applied
annotation on Helm-managed resources. This validation step does not persist those
annotations; Helm remains responsible for installing/upgrading the resources.
Helm uninstall keeps these PVCs; deleting the namespace or k3d cluster can still
destroy local data. A PVC is not a backup. Do not delete disks to repair a password
or rollout problem.

This is a single-node local environment, with no high availability. ClusterIP
prevents direct external exposure; it does not restrict which other pods can reach
the database. Gateway-only MCP network isolation belongs to the adapter deployment.
The official containers start with their standard entrypoints, including initial
file ownership setup; non-root hardening is not claimed by this checkpoint.

Local HTTP is bound to the laptop's loopback interface. The real adapter's store
authentication/TLS path still needs verification. Do not disable certificate
verification. This step does not change the adapter's HTTPS default.

## Production values (configuration example, not a verified VPS deployment)

`values-prod.yaml` uses the same chart. Set your actual DNS hostname, provisioned
storage class/capacity, Ingress class and TLS Secret. Create a database Secret in
the target namespace through your deployment secrets process. A TLS Secret named
in values must already exist; these templates do not issue certificates.
Provide backups/restore, restricted cluster access and a capacity plan before
using real customer data. Disk shrinking and changing MySQL credentials are not
performed automatically by `helm upgrade`. WordPress core files are persisted, so
changing the image tag alone is not a complete core/database upgrade procedure.

## Troubleshooting

```powershell
kubectl --kubeconfig .local/kubeconfig -n urumi get events --sort-by=.lastTimestamp
kubectl --kubeconfig .local/kubeconfig -n urumi describe pod <pod-name>
kubectl --kubeconfig .local/kubeconfig -n urumi logs deployment/store-wordpress --tail=30
kubectl --kubeconfig .local/kubeconfig -n urumi logs deployment/store-mysql --tail=30
```

- PVC Pending: check the storage class/provisioner and node disk space.
- ImagePullBackOff: check the pinned tag, connectivity and registry limits.
- Readiness 503: inspect MySQL readiness, credentials and internal Service endpoints.
  Liveness should remain healthy during a database outage.
- Ingress 404: verify the hostname, port and Ingress class.
- Ingress 503: inspect ready WordPress endpoints.
- OOMKilled: inspect memory usage and capacity before changing resource values.

## Explain it back

1. Why does WordPress use a database Service name rather than a pod IP?
2. Which two things survive a pod replacement, and why?
3. Why should a database outage fail WordPress readiness but not its liveness?

References: [WordPress image](https://hub.docker.com/_/wordpress),
[MySQL image](https://hub.docker.com/_/mysql),
[Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/),
[Helm charts](https://helm.sh/docs/topics/charts/).
