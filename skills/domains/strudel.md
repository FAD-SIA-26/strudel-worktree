# Strudel Worker Contract

Follow these rules for Strudel tasks in this lane.

## Lane Boundaries

- Change only files in your assigned lane unless the task explicitly says otherwise.
- Do not rewrite other lanes to "help" composition; communicate via exported lane output.
- Keep lane output deterministic and composable.

## Export One Lane

- Each lane file should export exactly one named lane pattern: `export const <lane> = <pattern>`.
- Match the exported name to the lane file, for example `src/bass.js` must export `bass`.
- Keep the lane focused: rhythm lane exports rhythm, bass lane exports bass, melody lane exports melody.
- If you need variations, do them inside the lane expression and still export one lane result.

## No Imports In Lane Files

- Do not use `import` statements inside lane files.
- Keep lane files self-contained so preview tooling can evaluate them safely.
- Use local constants/functions in the same file when needed.

## Preview-Safe Output

- Output plain Strudel/JavaScript expressions that run in preview.
- Avoid Node-only APIs, filesystem access, process/env usage, and runtime side effects.
- Keep tempo/pattern values bounded so preview is audible and stable.

## Arrangement Exception

- `src/index.js` is the only file allowed to compose multiple lane exports.
- Cross-lane mixing, layering, and timeline arrangement belong in `src/index.js`, not inside lane files.

## Short Examples

Good lane file:

```js
export const drums = s("bd ~ sd ~").bank("RolandTR909")
```

Bad lane file (cross-lane + import):

```js
import { bass } from "./bass.js"
export const drums = stack(s("bd ~ sd ~"), bass)
```

Good arrangement in `src/index.js`:

```js
import { drums } from "./drums.js"
import { bass } from "./bass.js"

stack(drums, bass)
```
