// Config for @hey-api/openapi-ts: generate a typed Jira Cloud client from the
// vendored Atlassian OpenAPI v3 spec, filtered to only the operations
// IdentityHub calls. Run by backend/scripts/start.ts (and `npm run codegen`).
// Output lands in backend/jira-client/src and is consumed by backend/src/jira
// via the `#jira/*` import map.
//
// Filter entries are applied ONLY when they are regexes (start and end with
// `/`); a plain "METHOD /path" string is treated as a literal key that silently
// matches nothing (@hey-api/openapi-ts 0.98), which is why an unfiltered client
// (the whole Jira API) would otherwise be generated. Anchored with ^…$ so a
// prefix cannot over-match, and `{}` path params are escaped.
export default {
  input: {
    path: "./backend/jira-client/jira-openapi-v3.json",
  },
  // openapi-ts 0.98 reads operation filters from `parser.filters` (they moved
  // from `input.filters`); putting them under `input` silently generates the
  // whole API.
  parser: {
    filters: {
      operations: {
        include: [
          "/^POST /rest/api/3/issue$/",
          "/^POST /rest/api/3/issue/bulkfetch$/",
          "/^GET /rest/api/3/issue/createmeta/\\{projectIdOrKey\\}/issuetypes$/",
          "/^GET /rest/api/3/issue/createmeta/\\{projectIdOrKey\\}/issuetypes/\\{issueTypeId\\}$/",
          "/^GET /rest/api/3/project/search$/",
        ],
      },
    },
  },
  output: {
    path: "backend/jira-client/src",
    // Emit `.ts` import extensions so Node runs the generated source directly
    // (the backend launcher runs `node`, which resolves `.ts` but not `.js`, and
    // only `.ts` files are generated). Otherwise hey-api infers `.js` from the
    // tsconfig's Node16 resolution and Node fails with ERR_MODULE_NOT_FOUND.
    importFileExtension: ".ts",
  },
  plugins: ["@hey-api/client-fetch"],
};
