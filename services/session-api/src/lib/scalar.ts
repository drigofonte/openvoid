import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";

function locateOpenApiYaml(): string {
  const candidates = [
    resolve(process.cwd(), "node_modules/@openvoid/protocol/generated/openapi.yaml"),
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../node_modules/@openvoid/protocol/generated/openapi.yaml",
    ),
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../packages/protocol/generated/openapi.yaml",
    ),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p);
      return p;
    } catch {
      // try next
    }
  }
  throw new Error(
    `Cannot locate @openvoid/protocol/generated/openapi.yaml. Tried:\n${candidates.join("\n")}`,
  );
}

export function mountDocs(app: Hono): void {
  const yamlPath = locateOpenApiYaml();
  const yaml = readFileSync(yamlPath, "utf8");

  app.get("/openapi.yaml", (c) => c.body(yaml, 200, { "content-type": "application/yaml" }));
  app.get(
    "/",
    Scalar({
      url: "/openapi.yaml",
      pageTitle: "openvoid Session API",
    }),
  );
}
