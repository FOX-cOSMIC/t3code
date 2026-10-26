import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createReadAloudEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    generate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:read-aloud:generate",
      tag: WS_METHODS.readAloudGenerate,
    }),
  };
}
