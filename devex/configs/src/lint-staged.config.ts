import { type Configuration } from "lint-staged";

const config: Configuration = {
  // Lint runs FIRST (catches semantic / correctness issues), then format
  // (applies whitespace + style fixes). The split is: lint never touches
  // anything that format can normalize, so the two never race or conflict.
  "*": ["bun run lint", () => "bun run build", "bun run format"],
  "{package.json,bun.lock,bunfig.toml}": (): string => "bun install",
};

export default config;
