export const bass = note(`<
  d2@0.75 a1@0.25 d2@0.5 f2@0.5 c2@0.5 a1@0.5 c2@0.5 a1@0.5
  d2@0.75 a1@0.25 d2@0.5 f2@0.5 bb1@0.5 a1@0.5 c2@0.5 a1@0.5
>`)
  .sound("gm_synth_bass_1:9")
  .lpf("<900 1200 980 1150>".slow(2))
  .gain(0.9)
