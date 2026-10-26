import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ReadAloudLanguage } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { readAloudPlayback } from "../../lib/readAloudPlayback";
import { readAloudEnvironment } from "../../state/readAloud";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentPresentation } from "../../state/presentation";

function Action(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled ?? false }}
      disabled={props.disabled}
      onPress={props.onPress}
      className="min-h-11 justify-center px-2 active:opacity-60"
    >
      <AppText className="text-xs text-foreground-secondary">{props.label}</AppText>
    </Pressable>
  );
}

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
  const start = (language: ReadAloudLanguage) => {
    void readAloudPlayback.start(key, { text: props.text, language }, async (input) => {
      const result = await generate({ environmentId: props.environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    });
  };
  if (presentation?.serverConfig?.environment.capabilities.readAloud !== true) return null;
  return (
    <View>
      <View className="flex-row items-center">
        {active && state.phase !== "error" ? (
          <>
            <Action
              label={
                state.phase === "loading"
                  ? "Generating voice…"
                  : state.phase === "playing"
                    ? "Pause voice"
                    : "Play voice"
              }
              disabled={state.phase === "loading"}
              onPress={() =>
                state.phase === "playing"
                  ? readAloudPlayback.pause()
                  : void readAloudPlayback.resume()
              }
            />
            <Action label="Stop voice" onPress={readAloudPlayback.stop} />
          </>
        ) : (
          <>
            <Action label="Read English" disabled={!allowed} onPress={() => start("en")} />
            <Action label="Read German" disabled={!allowed} onPress={() => start("de")} />
          </>
        )}
      </View>
      {active && state.error ? (
        <AppText accessibilityRole="alert" className="text-xs text-foreground-secondary">
          {state.error}
        </AppText>
      ) : null}
    </View>
  );
}
