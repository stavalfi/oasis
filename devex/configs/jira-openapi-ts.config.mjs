// Config for @hey-api/openapi-ts: generate a typed Jira Cloud client from the
// vendored Atlassian OpenAPI v3 spec, filtered to only the operations
// IdentityHub calls. Run via `bun run codegen`. Output is committed under
// devex/generated/jira and consumed by backend/src/jira.
export default {
  input: {
    path: "devex/configs/jira-openapi-v3.json",
    filters: {
      operations: {
        include: [
          "POST /rest/api/3/issue",
          "GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes",
          "GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}",
          "GET /rest/api/3/issue/{issueIdOrKey}",
          "GET /rest/api/3/project/search",
        ],
      },
    },
  },
  output: "devex/generated/jira/src",
  plugins: ["@hey-api/client-fetch"],
};
