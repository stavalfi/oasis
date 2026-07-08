# Migration to cass-operator (k8ssandra)

## What changes

| Area                                | Current (Bitnami Helm chart)                                                                                | cass-operator — what it can do                                                                                                                   | Our decision                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Deployment**                      | We define and manage Cassandra pods ourselves via Helm                                                      | We describe what we want (cluster name, node count, config) in a YAML resource — the operator creates and manages the pods for us                | Use the operator                                      |
| **Scaling**                         | Change node count in Pulumi, run `pulumi up`, then manually move data between nodes                         | Change the node count in the YAML — the operator adds/removes nodes and moves data automatically                                                 | Let the operator handle it                            |
| **Backups**                         | EBS snapshots via snapscheduler                                                                             | Same EBS snapshots, or optionally Medusa (scheduled backups to S3 with point-in-time restore)                                                    | Keep EBS snapshots as-is                              |
| **Repairs**                         | We don't run repairs                                                                                        | Reaper: automatically fixes data inconsistencies between replicas on a schedule                                                                  | Disable Reaper                                        |
| **Monitoring**                      | Separate exporter container scrapes metrics → VictoriaMetrics                                               | Metrics are built into the Cassandra image — no extra container needed. **Metric names change**, so Grafana dashboards and alerts need remapping | Use the built-in metrics, remap dashboards and alerts |
| **Alerts**                          | 1 alert (high IOWait)                                                                                       | Same alerting system, just different metric names and pod labels                                                                                 | Remap existing alert expressions                      |
| **Updates**                         | We manually restart pods one by one                                                                         | Same by default. Can be switched to automatic — the operator restarts pods one by one, waits for each to be healthy before moving to the next    | Keep manual for now, switch to automatic later        |
| **Multi-DC**                        | Not supported                                                                                               | Deploy one Cassandra datacenter per region, the operator connects them together                                                                  | Use when we need multi-DC                             |
| **PVC naming**                      | Bitnami names PVCs `data` — we run a `cassandra-helm-postrender.sh` hook to rename them to `cassandra-data` | We control PVC names directly in Pulumi and the operator binds to them — no post-render hack needed                                              | Drop the postrender hook                              |
| **Configuration**                   | Config via env vars (`CASSANDRA_CFG_YAML_*`)                                                                | Config via structured `cassandra-yaml` block in the CRD spec — type-safe, validated by the operator                                              | Use the CRD config                                    |
| **Keyspace mgmt**                   | Custom resource + cron every 6h via Shell service                                                           | Not related to the operator                                                                                                                      | Keep as-is                                            |
| scale up while some sts pod is down | in bitnami, we can scale up                                                                                 | here, the cas operator DC CRD will be in not-ready state and wont pick up CRD changes until all pods are ready                                   |
| seeders                             | we control the number                                                                                       | the operator control it, cant modify - we will have 1-3 but it doesn't matter due to the above point                                             |
| docker image - each has it's own    | bitnami image                                                                                               | cas-operator image                                                                                                                               |

- need to make sure the zdm does nto cotnains any user/pass in it's config yaml and if yes, what it is and why we need it.
  > the zdm needs a user/pass for the origin and target for discovery of cas pods. read and write ops are using the server creds.
- need to make sure we can connect to 2 cas clusters - each contain 2 keyspaces - each cotnain different user/pass (sum 4 user/pass) - each for dsifferent keyapace only. and it's working and if we mix its not working (try to connect to keyspace1 with card of keyspace2 and so on)
  > OKAY!

```
  ~/projects   cassandra-multi-dc-poc:main wip +1 !3 ?6 ❯ cqlsh 127.0.0.1 19042 -u keyspaceorigin1 -p keyspaceorigin1 -e "SELECT * FROM keyspaceorigin2.table1"                                                                                          ▼ 󱃾 kind-zdm-demo   15:24:33

Warning: Using a password on the command line interface can be insecure.
Recommendation: use the credentials file to securely provide the password.

<stdin>:1:Unauthorized: Error from server: code=2100 [Unauthorized] message="User keyspaceorigin1 has no SELECT permission on <table keyspaceorigin2.table1> or any of its parents"
  ~/projects   cassandra-multi-dc-poc:main wip +1 !3 ?6 ❯ cqlsh 127.0.0.1 19042 -u keyspaceorigin1 -p keyspaceorigin1 -e "SELECT * FROM keyspaceorigin1.table1"                                                                                          ▼ 󱃾 kind-zdm-demo   15:24:35

Warning: Using a password on the command line interface can be insecure.
Recommendation: use the credentials file to securely provide the password.


 id                                   | first_name | last_name
--------------------------------------+------------+-----------
 452f2747-b7ef-4a5f-aa6a-50181c9c0147 |      Alice |   Origin1
 0b40f4b9-8d73-4cd4-93f7-cde532373730 |      Alice |   Origin1

(2 rows)
  ~/projects   cassandra-multi-dc-poc:main wip +1 !3 ?6 ❯
```

- need to make sure that we can scale up the EBS of casandra (we use annotations for that ) - nee dto make sure its still workign with cas operator
  > all good

```
        const pvc = range(workloadConfig.count)
            .map(i => {
                return new PersistentVolumeClaim(`${pulumiPrefix}${release}-data-${release}-${i}`, {
                    metadata: {
                        name: `${release}-data-${release}-${i}`,
                        namespace: "infra",
                        annotations: {
                            "pulumi.com/skipAwait": "true",
                            "resize.topolvm.io/enabled": "true",
                            "resize.topolvm.io/increase": workloadConfig.diskSizeIncrease,
                            "resize.topolvm.io/storage_limit": "10Ti",
                            "volume.beta.kubernetes.io/storage-provisioner": "ebs.csi.aws.com",
                            "volume.kubernetes.io/storage-provisioner": "ebs.csi.aws.com",
                            "ebs.csi.aws.com/type": workloadConfig.diskType,
                            "ebs.csi.aws.com/iops": workloadConfig.diskIops.toString(),
                            "ebs.csi.aws.com/throughput": workloadConfig.diskThroughput.toString(),
                        },
                        labels: {
                            app: release,
                        },
                        finalizers: [
                            "kubernetes.io/pvc-protection",
                        ],
                    },
                    spec: {
                        storageClassName: storageClass.metadata.name,
                        accessModes: ["ReadWriteOnce"],
                        volumeMode: "Filesystem",
                        resources: {
                            requests: {
                                storage: Array.isArray(workloadConfig.diskSize) ? workloadConfig.diskSize[i] : workloadConfig.diskSize,
                            },
                        },
                        ...(workloadConfig.snapshot?.[i] ? {
                            dataSource: {
                                name: workloadConfig.snapshot[i]!,
                                kind: "VolumeSnapshot",
                                apiGroup: "snapshot.storage.k8s.io",
                            },
                        } : {}),
                    },
                }, {
                    provider: k8sProvider,
                    ignoreChanges: [
                        "spec.volumeName",
                        "spec.resources.requests.storage",
                    ],
                });
            });
```

- need to have cotnrol have io and throuput
  > yes

```
                cassandra: {
                    default: {
                        imageTag: "5e342ef257280ad881d48f8efcb87a422a657f54",
                        count: 1,
                        diskSize: "100Gi",
                        diskSizeIncrease: "100Gi",
                        diskType: "gp3",
                        diskIops: 3000,
                        diskThroughput: 125,
                        cpu: "8",
                        memoryGi: 24,
                        snapshot: ["cassandra-migrate"],
                    },
                    appi: {
                        imageTag: "5.0.8-ubi",
                        count: 1,
                        diskSize: "100Gi",
                        diskSizeIncrease: "100Gi",
                        diskType: "gp3",
                        diskIops: 3000,
                        diskThroughput: 125,
                        cpu: "1",
                        memoryGi: 4,
                    },
                },
```

- need to make sure th auto update of cas operator impl a better readinercheck based on nodetool status to see the pod is fully synced and ready and operational (not just ready for traffic)
  > NOT SURE if cas-oprator readiness check is enough

```from claude:
  Current readiness check (cass-operator default): The Management API sidecar exposes /api/v0/probes/readiness which runs two CQL queries:
  1. SELECT bootstrapped FROM system.local → checks bootstrapped = "COMPLETED"
  2. SELECT * FROM system.local → verifies CQL is responding

  That's it. It does NOT check:
  - nodetool status (is the node UN — Up/Normal in gossip)
  - Pending data streams (is streaming/bootstrap finished)
  - Pending ranges (are all token ranges owned)
```

- need to control gc version & params (but if the image is already containing the new GC (GC1) - it may not be needed)
  > we good

```
● kubectl --context kind-zdm-demo -n zdm-demo exec cassandra-origin-cassandra-origin-rack1-sts-0 -c cassandra -- sh -c "cassandra -v && java -version && ps aux | grep CassandraDaemon | grep -oP '\-XX:\+Use\w+GC'"
```

- do the operator have keyspace CRD so we can remove our code?
  > no
- also the user/password
  > no, they use a k8s secret for that. and we use it same as cas-operator defined.
- do we have custom crd for the user/pass for each additional role ? so we can remove our CRD?
  > no
- need to better udnerstand what the seeder means and what happen if it fail - can clients still connect? who posse the cluster thopology
  > we good with verification in dev & stg. we will probably have 3 seeders. a seeder is a cas sts pod that is ALSO a seeder which helps NEW sts pods to understand the cluster topology. after that the new pod has the full topology and it does not need the seeder at all ebcause he communicate with all sts pods all the time. clients do not need to talk to any seeder because no matter which sts pod the client reached, that pod already have the cluster topology:

```
Labels:           app.kubernetes.io/created-by=cass-operator
                  app.kubernetes.io/instance=cassandra-cassandra-origin
                  app.kubernetes.io/managed-by=cass-operator
                  app.kubernetes.io/name=cassandra
                  app.kubernetes.io/version=5.0.8
                  apps.kubernetes.io/pod-index=0
                  cassandra.datastax.com/cluster=cassandra-origin
                  cassandra.datastax.com/datacenter=cassandra-origin
                  cassandra.datastax.com/node-state=Started
                  cassandra.datastax.com/rack=rack1
                  cassandra.datastax.com/seed-node=true    <<<<<<<<<<<<<<<<--------------------------------------------- HERE <<<------
                  controller-revision-hash=cassandra-origin-cassandra-origin-rack1-sts-5c5f6cf556
                  statefulset.kubernetes.io/pod-name=cassandra-origin-cassandra-origin-rack1-sts-0
```

- is this the cas imagename: `${config.awsAccountId}.dkr.ecr.us-east-2.amazonaws.com/docker-hub/k8ssandra/cass-management-api:${workloadConfig.imageTag}`,

```
k8ssandra/cass-management-api:5.0.8-ubi # it's cass + other stuff that the cas-operator did
```

- can we change the new cassandras sts names?
  > Partially. i did my best: `appi-datacenter1-rack1-sts-0` (cassandra operator dont let me remove any part)
