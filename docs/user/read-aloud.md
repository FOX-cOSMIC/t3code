# Read agent replies aloud

Under a completed agent reply, select **Read aloud**. The environment detects whether the
reply is English or German and reads it with the matching local voice; it does not
translate. Pause, resume or stop using the same controls. If your browser blocks automatic
playback, press **Play** once the audio is ready.

Speech is generated locally by neural voice models on the environment hosting the thread:
Kokoro for English and Piper "Thorsten" for German. No cloud speech service or microphone is
used. The audio plays only on the device where you pressed the button, including a phone
connected to that environment. The Windows PC must be on and connected. Mac and Linux speech
generation are not supported in this version.

The first time you use it, the environment downloads the voices (about 430 MB, checked
against pinned hashes) and shows the progress as a message; press **Read aloud** again once it
finishes. Read aloud uses the same local speech runtime as dictation, so turn dictation on once
if the message asks for it. Voices are stored under `read-aloud` in the server state folder.

Code blocks, images, tables and raw HTML are skipped. Up to 4,000 characters of spoken text
are supported per reply; longer replies show an error instead of silently omitting the end.
One reply plays at a time per device. Generated audio is not saved on the server; the native
phone client uses a temporary cache file that is removed when playback is closed or replaced.

Voice credits: Kokoro (Apache-2.0) via sherpa-onnx; the German voice is a Piper model trained
on the CC0 Thorsten-Voice dataset by Thorsten Müller.
