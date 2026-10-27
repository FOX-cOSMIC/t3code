import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Volume2Icon, PauseIcon, SquareIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { readAloudPlayback } from "../../lib/readAloudPlayback";
import { readAloudEnvironment } from "../../state/readAloud";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentPresentation } from "../../state/presentation";
import { Button } from "../ui/button";

export function ReadAloudButton(props: {
  environmentId: EnvironmentId;
  messageId: string;
  text: string;
}) {
  const state = useSyncExternalStore(
    readAloudPlayback.subscribe,
    readAloudPlayback.snapshot,
    readAloudPlayback.snapshot,
  );
  const allowed = useAtomValue(readAloudEnvironment.generate.permissionAtom(props.environmentId));
  const generate = useAtomCommand(readAloudEnvironment.generate, { reportFailure: false });
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  const key = `${props.environmentId}:${props.messageId}`;
  const active = state.key === key;
  const start = () => {
    void readAloudPlayback.start(key, { text: props.text }, async (input) => {
      const result = await generate({ environmentId: props.environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    });
  };
  if (presentation?.serverConfig?.environment.capabilities.readAloud !== true) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {active && state.phase !== "error" ? (
        <>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={state.phase === "loading"}
            onClick={() =>
              state.phase === "playing"
                ? readAloudPlayback.pause()
                : void readAloudPlayback.resume()
            }
          >
            {state.phase === "playing" ? (
              <PauseIcon className="size-3" />
            ) : (
              <Volume2Icon className="size-3" />
            )}
            {state.phase === "loading"
              ? "Generating voice…"
              : state.phase === "playing"
                ? "Pause"
                : "Play"}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Stop reading aloud"
            onClick={readAloudPlayback.stop}
          >
            <SquareIcon className="size-3" />
          </Button>
        </>
      ) : (
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={!allowed}
          aria-label="Read aloud"
          onClick={start}
        >
          <Volume2Icon className="size-3" />
          Read aloud
        </Button>
      )}
      {active && state.error ? (
        <span role="status" className="max-w-sm text-xs text-muted-foreground">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
