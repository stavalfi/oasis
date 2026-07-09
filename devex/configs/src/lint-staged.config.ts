import type { Configuration } from "lint-staged";

const config: Configuration = {
  // Lint runs FIRST (catches semantic / correctness issues), then format
  // (applies whitespace + style fixes). The split is: lint never touches
  // anything that format can normalize, so the two never race or conflict.
  "*": ["npm run lint", () => "npm run build", "npm run format"],
  "{package.json,package-lock.json}": (): string => "npm install",
};

export default config;
