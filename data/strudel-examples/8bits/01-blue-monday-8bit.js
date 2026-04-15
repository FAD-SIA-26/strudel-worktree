// Blue Monday Style - New Order Inspired
// Genre: Synthwave | Key: Dm | BPM: 130 | Energy: 7/10
// Source: Adapted from Blue Monday cover (eefano's collection)

setcpm(130/4)

const kick1 = sound("<[bd bd [bd*4] [bd*4]] [bd*4]>").bank("linn").decay(0.15)
const hats1 = sound("[oh oh*2]*4").bank("dmx").decay(.1).gain(.12)
const snare = stack(
  sound("[~ sd]*2").bank("linn").gain(.5),
  sound("[~ cp]*2").bank("linn").gain(1)
)

const bass1 = stack(
  note("<<[f1 f2*2]*2 [g1 g2*2]*2> [c1 c2*2]*2 [d1 d2*2]*2 [d1 d2*2]*2>*2")
).sound("<sine, gm_synth_bass_1>").decay(.2).sustain(.1)

const synth = stack(
  n("<[[2 ~] [2 ~] 2 3] [[3 ~] [3 ~] 3 3]>@4 [-1 ~] -1 -1 [0 ~] 0 0 [0 ~] 0 0 [0 ~] 0 0")
).sound("gm_lead_2_sawtooth").slow(2).scale("d4:minor").attack(.05).hpf("<1000 2000>*12").gain(.4)

stack(kick1, hats1, snare, bass1, synth).room(0.1)
