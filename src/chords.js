setcpm(90 / 4)

const progression = "<Dm Bb F C>/2"

export const chords = stack(
  chord(progression)
    .anchor("d4")
    .voicing()
    .s("gm_pad_3_polysynth:1")
    .attack(0.08)
    .release(0.9)
    .lpf(1800)
    .room(0.85)
    .gain(0.56),
  chord(progression)
    .anchor("d5")
    .voicing()
    .s("gm_pad_warm")
    .struct("x ~ x ~ x ~ x x")
    .attack(0.01)
    .release(0.28)
    .delay(0.25)
    .gain(0.2)
)
  .slow(2)
  .hpf(180)
