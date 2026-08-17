# Tekken Movement Trainer

A browser-based 3D execution trainer for practicing wavedash, Korean backdash, sidestep, and sidewalk timing. It visualizes chronological keyboard or gamepad input on an original low-poly fighter and keeps practice history and settings in browser storage.

The current project is focused on movement practice and visualization; attacks, damage, and online services are outside its scope.

## Requirements

- Node.js 22.13 or newer
- pnpm

## Local development

```bash
git clone <repository-url>
cd <project-folder>
pnpm install
pnpm dev
```

Open the local URL printed by the development server.

## Controls

The default keyboard bindings are:

| Direction | Key |
| --- | --- |
| Up / sidestep | `W` |
| Down / sidestep | `S` |
| Left | `A` |
| Right | `D` |

Movement notation is opponent-relative. On Player 1 side, `D` is forward and `A` is back; Player 2 side reverses those meanings. Tap up or down to sidestep and hold it to transition into sidewalk. Keyboard bindings and player side can be changed in Settings.

Compatible controllers are read through the browser Gamepad API. The default mapping uses the D-pad or left stick, and the in-app calibration flow can capture a custom controller mapping. The app only observes input; it does not send input to games or connected devices.

Recognized practice loops include:

```text
Wavedash: f, n, d, df, f, f, n, d, df, f, f ...
Korean backdash: b, b, db, n, b, b, db, n, b, b ...
```

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm preview
```

`pnpm build` creates the production output through Vite and Nitro. `pnpm preview` starts the generated Nitro server for a local production check.

## Vercel

Import the GitHub repository into Vercel and use:

- Install command: `pnpm install`
- Build command: `pnpm build`
- Output directory: `.output`

Nitro detects Vercel during its CI build and generates the platform output. The project does not require a database, backend service, or environment variables.

## Technology

React, TypeScript, Vinext/Vite, Nitro, React Three Fiber, Drei, and Three.js.
