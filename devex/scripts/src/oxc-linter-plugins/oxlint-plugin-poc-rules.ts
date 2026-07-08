import type { Rule } from "eslint";
import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  ImportDeclaration,
  Literal,
  MethodDefinition,
  NewExpression,
  Node,
  Program,
  PropertyDefinition,
  TemplateLiteral,
  VariableDeclarator,
} from "estree";

interface TsAccessibility {
  accessibility?: "public" | "protected" | "private";
}
import { z } from "zod";

const NoBannedWordsGroupSchema = z.object({
  message: z.string(),
  words: z.array(z.string()),
});

const NoBannedWordsOptionsSchema = z
  .object({
    groups: z.array(NoBannedWordsGroupSchema),
  })
  .optional();

const noBannedWords: Rule.RuleModule = {
  meta: {
    schema: [
      {
        additionalProperties: false,
        properties: {
          groups: {
            items: {
              additionalProperties: false,
              properties: {
                message: { type: "string" },
                words: { items: { type: "string" }, type: "array" },
              },
              required: ["message", "words"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["groups"],
        type: "object",
      },
    ],
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const args = NoBannedWordsOptionsSchema.parse(context.options[0]);
    const compiledGroups = (args?.groups ?? []).map((group) => ({
      message: group.message,
      patterns: group.words.map((word) => new RegExp(`\\b${word}\\b`, "iu")),
    }));

    const checkValue = (value: string, node: Literal | TemplateLiteral): void => {
      for (const group of compiledGroups) {
        for (const pattern of group.patterns) {
          if (pattern.test(value)) {
            context.report({ message: group.message, node });
            return;
          }
        }
      }
    };

    return {
      Literal(node: Literal): void {
        if (typeof node.value === "string") {
          checkValue(node.value, node);
        }
      },
      TemplateLiteral(node: TemplateLiteral): void {
        for (const quasi of node.quasis) {
          const value = quasi.value.cooked ?? quasi.value.raw;
          checkValue(value, node);
        }
      },
    };
  },
};

const NoCurlGroupSchema = z.object({
  commands: z.array(z.string()),
  message: z.string(),
});

const NoCurlOptionsSchema = z
  .object({
    execFunctions: z.array(z.string()).optional(),
    groups: z.array(NoCurlGroupSchema).optional(),
  })
  .optional();

const noCurl: Rule.RuleModule = {
  meta: {
    schema: [
      {
        additionalProperties: false,
        properties: {
          execFunctions: { items: { type: "string" }, type: "array" },
          groups: {
            items: {
              additionalProperties: false,
              properties: {
                commands: { items: { type: "string" }, type: "array" },
                message: { type: "string" },
              },
              required: ["commands", "message"],
              type: "object",
            },
            type: "array",
          },
        },
        type: "object",
      },
    ],
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const args = NoCurlOptionsSchema.parse(context.options[0]);
    const execFuns = new Set(args?.execFunctions ?? ["execFile", "execFileAsync", "spawn"]);
    const compiledGroups = (args?.groups ?? []).map((g) => ({
      commands: new Set(g.commands),
      message: g.message,
    }));

    return {
      CallExpression(node: CallExpression): void {
        const callee = node.callee;
        let name;
        if (callee.type === "Identifier") {
          name = callee.name;
        } else if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
          name = callee.property.name;
        }
        if (!name || !execFuns.has(name)) return;

        const firstArg = node.arguments[0];
        if (firstArg?.type !== "Literal" || typeof firstArg.value !== "string") return;

        for (const group of compiledGroups) {
          if (group.commands.has(firstArg.value)) {
            context.report({ message: group.message, node: firstArg });
            return;
          }
        }
      },
    };
  },
};

const noTsConfigEmit: Rule.RuleModule = {
  meta: {
    schema: [
      {
        additionalProperties: false,
        properties: {
          exclude: { items: { type: "string" }, type: "array" },
        },
        type: "object",
      },
    ],
  },
  create(): Rule.RuleListener {
    return {};
  },
};

const noAnonymousFunctions: Rule.RuleModule = {
  meta: { schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: CallExpression): void {
        const { callee } = node;
        if (callee.type === "ArrowFunctionExpression" || callee.type === "FunctionExpression") {
          context.report({
            node: callee as ArrowFunctionExpression | FunctionExpression,
            message:
              "Anonymous immediately-invoked functions are banned. Extract to a named function or class method.",
          });
        }
      },
    };
  },
};

const noCustomResource: Rule.RuleModule = {
  meta: { schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const localNames = new Set<string>();

    return {
      ImportDeclaration(node: ImportDeclaration): void {
        if (!String(node.source.value).startsWith("@pulumi/kubernetes/apiextensions")) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "CustomResource"
          ) {
            localNames.add(specifier.local.name);
          }
        }
      },
      NewExpression(node: NewExpression): void {
        if (node.callee.type === "Identifier" && localNames.has(node.callee.name)) {
          context.report({
            node,
            message:
              "Do not use CustomResource from @pulumi/kubernetes/apiextensions. find the crd yaml online, move it to devops/crds/external and then run: bun run codegen",
          });
        }
      },
    };
  },
};

const noProcessStreamWrite: Rule.RuleModule = {
  meta: { fixable: "code", schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: CallExpression): void {
        const { callee } = node;
        if (callee.type !== "MemberExpression") return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "write") return;
        const obj = callee.object;
        if (
          obj.type === "MemberExpression" &&
          obj.object.type === "Identifier" &&
          obj.object.name === "process" &&
          obj.property.type === "Identifier"
        ) {
          const stream = obj.property.name;
          if (stream === "stdout") {
            context.report({
              fix: (fixer: Rule.RuleFixer) => fixer.replaceText(callee, "console.log"),
              message: "Use console.log instead of process.stdout.write.",
              node,
            });
          } else if (stream === "stderr") {
            context.report({
              fix: (fixer: Rule.RuleFixer) => fixer.replaceText(callee, "console.error"),
              message: "Use console.error instead of process.stderr.write.",
              node,
            });
          }
        }
      },
    };
  },
};

const noZodPassthrough: Rule.RuleModule = {
  meta: { schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: CallExpression): void {
        const { callee } = node;
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "passthrough" &&
          node.arguments.length === 0
        ) {
          context.report({
            node,
            message:
              "ZodObject.passthrough() is deprecated in zod v4. Use z.looseObject({...}) or .loose() instead.",
          });
        }
      },
    };
  },
};

const noProtected: Rule.RuleModule = {
  meta: { schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      MethodDefinition(node: MethodDefinition & TsAccessibility): void {
        if (node.accessibility === "protected") {
          context.report({
            node,
            message: "`protected` is not allowed. Use `#` prefix instead.",
          });
        }
      },
      PropertyDefinition(node: PropertyDefinition & TsAccessibility): void {
        if (node.accessibility === "protected") {
          context.report({
            node,
            message: "`protected` is not allowed. Use `#` prefix instead.",
          });
        }
      },
    };
  },
};

const noPrivateKeyword: Rule.RuleModule = {
  meta: { schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      MethodDefinition(node: MethodDefinition & TsAccessibility): void {
        if (node.kind === "constructor") return;
        if (node.accessibility === "private") {
          context.report({
            node,
            message: "`private` keyword is not allowed. Use `#` prefix instead.",
          });
        }
      },
      PropertyDefinition(node: PropertyDefinition & TsAccessibility): void {
        if (node.accessibility === "private") {
          context.report({
            node,
            message: "`private` keyword is not allowed. Use `#` prefix instead.",
          });
        }
      },
    };
  },
};

const requireAccessModifiers: Rule.RuleModule = {
  meta: { fixable: "code", schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const check = (node: (MethodDefinition | PropertyDefinition) & TsAccessibility): void => {
      if ((node.accessibility as unknown) !== null) return;
      if (node.key.type === "PrivateIdentifier") return;
      context.report({
        fix: (fixer: Rule.RuleFixer) => fixer.insertTextBefore(node, "public "),
        message:
          "Class members must declare an explicit `public` access modifier (or use `#` prefix for private).",
        node,
      });
    };
    return {
      MethodDefinition: check,
      PropertyDefinition: check,
    };
  },
};

type WithParent<T> = T & { parent?: { type: string } };

const noGlobalFunctions: Rule.RuleModule = {
  meta: { schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const MSG_FN = "Global functions are banned. Use a class with static methods instead.";
    const MSG_ARROW = "Global arrow functions are banned. Use a class with static methods instead.";
    const MSG_EXPR =
      "Global function expressions are banned. Use a class with static methods instead.";

    const globalFuncDecls = new Set<object>();
    const globalArrows = new Set<object>();
    const globalFuncExprs = new Set<object>();

    const collectVarInits = (declarations: VariableDeclarator[]): void => {
      for (const declarator of declarations) {
        const { init } = declarator;
        if (init && init.type === "ArrowFunctionExpression") {
          globalArrows.add(init);
        } else if (init && init.type === "FunctionExpression") {
          globalFuncExprs.add(init);
        }
      }
    };

    return {
      Program(node: Program): void {
        for (const stmt of node.body) {
          if (stmt.type === "FunctionDeclaration") {
            globalFuncDecls.add(stmt);
          } else if (stmt.type === "VariableDeclaration") {
            collectVarInits(stmt.declarations);
          } else if (stmt.type === "ExportNamedDeclaration") {
            const { declaration: decl } = stmt;
            if (decl) {
              if (decl.type === "FunctionDeclaration") {
                globalFuncDecls.add(decl);
              } else if (decl.type === "VariableDeclaration") {
                collectVarInits(decl.declarations);
              }
            }
          } else if (stmt.type === "ExportDefaultDeclaration") {
            const { declaration: decl } = stmt;
            if (decl.type === "FunctionDeclaration") {
              globalFuncDecls.add(decl);
            } else if (decl.type === "ArrowFunctionExpression") {
              globalArrows.add(decl);
            } else if (decl.type === "FunctionExpression") {
              globalFuncExprs.add(decl);
            }
          }
        }
      },
      FunctionDeclaration(node: FunctionDeclaration): void {
        if (globalFuncDecls.has(node)) {
          context.report({ node, message: MSG_FN });
        }
      },
      ArrowFunctionExpression(node: ArrowFunctionExpression): void {
        if (globalArrows.has(node)) {
          context.report({ node, message: MSG_ARROW });
        }
      },
      FunctionExpression(node: FunctionExpression): void {
        if (globalFuncExprs.has(node)) {
          context.report({ node, message: MSG_EXPR });
        }
      },
    };
  },
};

const requireObjectParams: Rule.RuleModule = {
  meta: { schema: [] },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const reportIfMultipleParams = (params: unknown[], node: Node, label: string): void => {
      if (params.length > 1) {
        context.report({
          node,
          message: `${label} has ${params.length} parameters. Use a single object parameter instead.`,
        });
      }
    };

    return {
      FunctionDeclaration(node: FunctionDeclaration): void {
        reportIfMultipleParams(node.params, node, `Function '${node.id?.name ?? "anonymous"}'`);
      },
      ArrowFunctionExpression(node: ArrowFunctionExpression): void {
        const parent = (node as WithParent<ArrowFunctionExpression>).parent;
        if (parent?.type !== "VariableDeclarator") return;
        const name = (parent as { id?: { name?: string } }).id?.name ?? "anonymous";
        reportIfMultipleParams(node.params, node, `Function '${name}'`);
      },
      FunctionExpression(node: FunctionExpression): void {
        const parent = (node as WithParent<FunctionExpression>).parent;
        if (parent?.type !== "VariableDeclarator") return;
        const name = (parent as { id?: { name?: string } }).id?.name ?? "anonymous";
        reportIfMultipleParams(node.params, node, `Function '${name}'`);
      },
      MethodDefinition(node: MethodDefinition): void {
        if (node.kind === "get" || node.kind === "set") return;
        const { params } = node.value;
        const label = node.kind === "constructor" ? "Constructor" : "Method";
        reportIfMultipleParams(params, node, label);
      },
    };
  },
};

const plugin = {
  meta: { name: "poc-rules" },
  rules: {
    "no-anonymous-functions": noAnonymousFunctions,
    "no-banned-words": noBannedWords,
    "no-curl": noCurl,
    "no-custom-resource": noCustomResource,
    "no-global-functions": noGlobalFunctions,
    "no-private-keyword": noPrivateKeyword,
    "no-process-stream-write": noProcessStreamWrite,
    "no-protected": noProtected,
    "no-tsconfig-emit": noTsConfigEmit,
    "no-zod-passthrough": noZodPassthrough,
    "require-access-modifiers": requireAccessModifiers,
    "require-object-params": requireObjectParams,
  },
};

export default plugin;
