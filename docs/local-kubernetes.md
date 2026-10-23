# Local Kubernetes: first checkpoint

Docker runs Linux containers. **k3d** puts a small Kubernetes distribution (K3s)
inside those containers. Kubernetes will keep our application processes running;
**Helm** will install their Kubernetes configuration as a versioned package called
a chart. This script creates only the cluster, not the store or gateway.

## Storage first

Docker's Linux images, containers and named volumes live inside its virtual disk.
On this machine, use Docker Desktop **Settings > Resources > Advanced > Disk image
location** to select D:. Let Docker complete its supported move and restart before
pulling application images. A copied VHDX file alone does not verify a successful
move: check the saved location, the engine, and existing containers afterward.

Do not manually delete either disk copy while migration is unresolved. Do not run
`docker system prune` or reset Docker to solve this; existing projects use it too.

On 18 October the supported move completed to
`D:\DockerData\Active\DockerDesktopWSL`. Docker's engine responded afterward,
all 10 pre-existing container entries remained listed, and the original C: data
VHDX no longer existed. An earlier interrupted copy remains separately at
`D:\DockerData\DockerDesktopWSL`; it is not the active location. No project data
was deliberately deleted. The Desktop program itself remains installed on C:.

## Create the cluster

From the project directory in PowerShell:

```powershell
.\scripts\install-local-tools.ps1
.\scripts\create-local-cluster.ps1
```

The tool installer downloads pinned official releases and verifies SHA-256 checksums.
The cluster script reuses a cluster named `urumi` if one already exists. It does not
delete clusters, replace the global kubeconfig, or switch your global context.

Expected results after a successful run:

- One node named `k3d-urumi-server-0` reports `Ready`.
- `.local/kubeconfig` contains local cluster-admin credentials. Keep it private.
- The Kubernetes API listens at `127.0.0.1:6550`.
- Ports 8080 and 8443 are reserved for applications reached through Ingress.
  They do not serve a store until we install one.

```powershell
kubectl --kubeconfig .local/kubeconfig get nodes
kubectl --kubeconfig .local/kubeconfig get pods -A
.\.local\tools\helm.exe version --short
```

The startup entry point is `scripts/create-local-cluster.ps1`. Its JSON discovery
helper is `scripts/lib/find-k3d-cluster.ps1`. Explicit array iteration supports both
Windows PowerShell 5.1 and PowerShell 7. A regression check covers no clusters, one
cluster, multiple clusters and a different cluster:

```powershell
powershell.exe -NoProfile -File test/cluster-detection.test.ps1
```

The script also refuses to create a replacement when Docker reports existing
`urumi` containers that k3d discovery did not recognize. A running load balancer
can own port 6550 while the Kubernetes server container is stopped; that does not
mean the port belongs to an unrelated application.

Kubernetes system pods may need time to download images and become Ready. The
node check does not by itself prove that Traefik, DNS, or future applications work.

Verified on 18 October: cluster creation succeeded; the node became Ready; CoreDNS,
local-path-provisioner, metrics-server and Traefik deployments became available.
The Traefik IngressClass and default local-path StorageClass exist. These checks
verify infrastructure readiness, not WooCommerce or application persistence.

## What each part does

```text
kubectl -> local Kubernetes API -> creates/inspects Kubernetes objects
browser -> localhost:8080 -> k3d load balancer -> Traefik Ingress -> future store
```

`kubectl` is our cluster remote control. The kubeconfig tells it where the API is
and how to authenticate. An Ingress rule will tell Traefik which application should
receive a request for a hostname. The database will have an internal Service;
we will not publish its port on Windows.

One node is appropriate for this local exercise but provides no redundancy if the
node fails. Future persistent volumes will survive a pod replacement, but deleting
the k3d cluster can destroy locally stored application data. A PVC is not a backup.

## Troubleshooting

- Docker pipe or engine error: open Docker Desktop and resolve its startup error
  before rerunning. If an automatic update failed, follow its recovery dialog.
- `ImagePullBackOff`: inspect `kubectl --kubeconfig .local/kubeconfig get events -A
  --sort-by=.lastTimestamp`; check connectivity and available disk space.
- Port conflict: the script names the port. Identify its owner; do not stop unrelated
  software without understanding what it is.
- `kubectl` connects to an unexpected cluster: use the explicit `--kubeconfig`
  argument shown above.
- Slow or Pending pods: inspect `describe pod` and events before raising limits;
  this laptop has limited RAM.

## Explain it back

1. What jobs do Docker, Kubernetes, and Helm each perform here?
2. Why do we keep the kubeconfig outside Git?
3. Why does a Ready node not yet mean that WooCommerce works?

Official references: [k3d Ingress port mapping](https://k3d.io/stable/usage/exposing_services/),
[separate kubeconfigs](https://k3d.io/stable/usage/kubeconfig/), and
[Docker WSL storage](https://docs.docker.com/desktop/features/wsl/).
