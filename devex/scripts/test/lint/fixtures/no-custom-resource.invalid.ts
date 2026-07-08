// @ts-nocheck
import { CustomResource } from "@pulumi/kubernetes/apiextensions";

export const cr = new CustomResource("my-cr", {
  apiVersion: "example.com/v1",
  kind: "MyKind",
  metadata: { name: "test" },
});
