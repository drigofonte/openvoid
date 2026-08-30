// Emits the Kubernetes objects for one app database as a JSON List, ready for
// `kubectl apply -f -`. Used by scripts/check-app-db-isolation.sh.
//
// The generated client names NetworkPolicy's `from` field `_from` and maps it
// back through its own serializer when sending via the typed API. Dumping the
// object with JSON.stringify skips that, emitting `_from` — which the API
// server ignores, silently leaving an ingress rule that matches no sources and
// therefore denies everything. The rename below is that mapping, done
// explicitly so it is visible rather than buried in a serializer.
//
// Usage: tsx scripts/emit-app-db-manifests.ts <appId> <password>
import { buildAppDbResources } from "../src/k8s/app-db.js";

const [appId, password] = process.argv.slice(2);
if (!appId || !password) {
  console.error("usage: emit-app-db-manifests.ts <appId> <password>");
  process.exit(1);
}

function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k === "_from" ? "from" : k,
        toWire(v),
      ]),
    );
  }
  return value;
}

const r = buildAppDbResources(appId, password);
const items = [r.secret, r.statefulSet, r.service, r.networkPolicy].map(toWire);

console.log(JSON.stringify({ apiVersion: "v1", kind: "List", items }, null, 2));
