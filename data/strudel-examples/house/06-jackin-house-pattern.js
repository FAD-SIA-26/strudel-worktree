// Jackin' House Pattern - High Energy Groove
// Genre: House | Key: Gm | BPM: 128 | Energy: 9/10
// Source: High energy house arrangement

setcpm(128/4)

stack(
  // Punchy kick
  s("bd ~ bd bd ~ bd ~ bd").bank("tr909")
    .gain("<.9 1 .85 1>*2").lpf(150),

  // Snare hits
  s("~ sd ~ ~ ~ sd ~ sd").gain(.7).hpf(200),

  // Constant hats
  s("hh*16").gain(".08 .12 .08 .15".slow(4)).hpf(5000),

  // House stabs
  n("<[0,2,4] [2,4,6]>").scale("g3:minor")
    .s("gm_synth_brass_2").struct("~ x x ~")
    .gain(.9).room(.5)
).bank("RolandTR909").room(0.3)
