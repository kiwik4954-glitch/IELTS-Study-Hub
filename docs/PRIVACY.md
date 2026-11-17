# Privacy

IELTS Study Hub is local-first by design. There is no Hub account, no Hub server and
no telemetry.

## What stays on this computer

| Data | Location |
|---|---|
| ISTS database and uploads | `%APPDATA%\IELTS-Study-Hub\ists\` (Hub default) |
| BandReady database, recordings, models | `%APPDATA%\BandReady\` |
| BandReady launch secret | `%APPDATA%\BandReady\web.json` |
| Hub state and logs | `%APPDATA%\IELTS-Study-Hub\hub\` |
| API keys | each app's own encrypted settings; never in this repository |

## What the Hub does not do

- It does not proxy AI requests and never sees your provider API keys.
- It does not read or merge either app's database in v1.
- It does not upload study records, essays, recordings or uploaded PDFs.
- It does not expose either app to the LAN: all services bind to `127.0.0.1`.

## Network access

- ISTS and BandReady call the AI providers **you** configure, directly from this
  machine.
- BandReady downloads model weights on first run (Kokoro, Whisper) into its data
  directory; those weights are not part of this repository.
- The Hub's own API is loopback-only.

## Deleting your data

Delete the directories above. This removes study history, recordings and settings for
the respective app. The repository itself contains no personal data.

## Exposing beyond localhost

Do not do it with the defaults. If you need remote access, put a reverse proxy with
authentication in front of the apps and review ISTS's `ISTS_BASIC_AUTH_*` options
first. Exposing a local learning system to the internet is an explicit, non-default
choice and outside the support scope of v1.
