export class CommandRewriter {
  readonly #knownClis = new Set(["ls", "git", "gh", "docker", "kubectl", "curl", "grep", "diff"]);

  public rewrite(command: string): string {
    // Split on &&, ||, ;, | (in that order so || beats |)
    const parts = command.split(/(?<op>&&|\|\||;|\|)/u);
    return parts
      .map((part, i) => {
        if (i % 2 === 1) {
          return part;
        }
        return this.#rewriteSegment(part);
      })
      .join("");
  }

  #rewriteSegment(segment: string): string {
    const trimmed = segment.trimStart();
    const firstToken = trimmed.split(/\s+/u)[0] ?? "";

    if (firstToken === "rtk") {
      return segment;
    }
    if (firstToken.includes("/")) {
      return segment;
    }
    if (!this.#knownClis.has(firstToken)) {
      return segment;
    }

    const leadingWhitespace = segment.slice(0, segment.length - trimmed.length);
    return `${leadingWhitespace}rtk ${trimmed}`;
  }
}
