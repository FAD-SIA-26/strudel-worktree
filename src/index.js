import { drums } from "./drums.js";
import { bass } from "./bass.js";
import { chords } from "./chords.js";
import { melody } from "./melody.js";

setcpm(90 / 4);

$: stack(
  drums.gain(0.95),
  bass.gain(0.9),
  chords.gain(0.78),
  melody.gain(0.72),
)
  .gain(0.8)
  .lpf(2200)
  .room(0.24)
  .delay(0.1)
  .delayfeedback(0.22);
