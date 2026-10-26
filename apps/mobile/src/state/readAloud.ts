import { createReadAloudEnvironmentAtoms } from "@t3tools/client-runtime/state/read-aloud";
import { connectionAtomRuntime } from "../connection/runtime";

export const readAloudEnvironment = createReadAloudEnvironmentAtoms(connectionAtomRuntime);
