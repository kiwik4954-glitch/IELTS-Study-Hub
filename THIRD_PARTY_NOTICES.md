# Third-Party Notices

IELTS Study Hub is a separate project that orchestrates two upstream applications. It
does not copy their source into this repository; they are referenced as Git submodules
at pinned commits.

## ISTS

- Repository: <https://github.com/aimerfeng/ists>
- Pinned commit: `1088fe0f11391ec0106d5225c40ae310c57a37ba`
- License: MIT — Copyright (c) 2026 Aimer Feng
- License text: [`apps/ists/LICENSE`](apps/ists/LICENSE)

## BandReady (IELTS Prep)

- Repository: <https://github.com/Luxshan2000/ielts-prep>
- Pinned commit: `b2d67d409e69be60962ca2d123733be0d572761e`
- License: MIT — Copyright (c) 2026 Luxshan Thavarasa
- License text: [`apps/bandready/LICENSE`](apps/bandready/LICENSE)
- Bundled practice content is released separately as CC0-1.0.

## Licence risk: voice dependencies in BandReady

BandReady's optional `voice` extra pulls in `pipecat-ai`, `faster-whisper` and
`kokoro-onnx`. `kokoro-onnx` depends on `phonemizer-fork` / `espeakng-loader`, which
carry **GPL-3.0** terms. The Hub distributes **source code only** in its first release
and does not bundle these dependencies or any model weights.

Anyone packaging a binary that includes the voice extra must review the combined
work's licensing themselves. See BandReady's README ("One caveat for anyone
redistributing a build").

## Trademarks

IELTS is a registered trademark of the British Council, IDP: IELTS Australia and
Cambridge University Press & Assessment. This project is independent, unofficial and
not endorsed by or affiliated with those organisations. All practice material belongs
to its respective authors.
