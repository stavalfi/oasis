---
name: node-ssm
description: Connect to an EKS node via SSM. Lists nodes and opens a shell session on the selected one. Use when the user asks to SSH/connect/get a shell on an EKS or EC2 node.
argument-hint: [node-name-or-ip]
allowed-tools: Bash
---

Open an SSM shell session on an EKS node.

## Step 1 — Select the cluster

List available kubectl contexts:

```bash
kubectl ctx
```

Show the user the options and ask which cluster to connect to. Switch to it:

```bash
kubectl ctx <context-name>
```

## Step 2 — Identify the node

If the user provided a node name or IP, use that.

Otherwise, list the available nodes:

```bash
kubectl get nodes -o wide
```

Present the list and ask which node to connect to.

## Step 3 — Ensure AWS SSO session is active

Determine the AWS profile from the selected context:

```bash
kubectl config view --minify -o jsonpath='{.users[0].user.exec.env[?(@.name=="AWS_PROFILE")].value}'
```

Then test credentials:

```bash
aws sts get-caller-identity --profile <profile> 2>&1
```

If it fails, run:

```bash
aws sso login --profile <profile>
```

## Step 4 — Connect

```bash
kubectl node-ssm start-session --target <node-name>
```

Where `<node-name>` is the full node name from `kubectl get nodes` (e.g. `ip-10-1-11-15.us-east-2.compute.internal`).

If the user provided just an IP like `10.1.11.15`, convert it to the node name format: `ip-<ip-with-dashes>.us-east-2.compute.internal` (e.g. `ip-10-1-11-15.us-east-2.compute.internal`).

## Notes

- Requires `kubectl-node-ssm` plugin (`kubectl krew install node-ssm`)
- Requires `session-manager-plugin` installed on the system
- Once connected, you're on the actual EC2 instance — run `ps -Af`, `top`, `journalctl`, etc.
