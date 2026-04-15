// Filtered Disco House - Funky Chord Stabs
// Genre: House | Key: Cm | BPM: 120 | Energy: 7/10
// Source: Disco-influenced house pattern

setcpm(120/4)

stack(
  // Funky chord stabs
  n("<[2,4,6] [-3,-1,1]>/2").scale('c4:minor')
    .s("gm_synth_brass_1").lpf(1500)
    .struct("x ~ x ~").gain(.8),

  // Walking bass
  n("<0 2 4 5>/4").scale("c2:minor")
    .s("gm_synth_bass_1").lpf(400).gain(1),

  // Four-on-floor with swing
  s("bd*4").gain(0.9).lpf(200),
  s("[~ sd]*2").gain(0.6).hpf(300),
  s("[oh ~ oh oh]").gain(0.12)
).bank("RolandTR909").room(0.4)
