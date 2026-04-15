// Tech House Groove - Minimal Pattern
// Genre: House | Key: Fm | BPM: 125 | Energy: 6/10
// Source: Minimal tech house arrangement

setcpm(125/4)

stack(
  // Tight kick
  s("bd ~ ~ bd ~ bd ~ ~").bank("tr909")
    .lpf(100).gain(.9),

  // Shuffled hats
  s("hh*8").gain("<.1 .15 .1 .2>*2")
    .speed("<1 1.02>*4").hpf(8000),

  // Clap
  s("~ ~ sd ~").bank("tr909").gain(.5),

  // Minimal bass
  n("<0 ~ 0 3 ~ 0 2 ~>").scale("f1:minor")
    .s("sawtooth").lpf(200).clip(.8).gain(.7)
).room(0.2)
