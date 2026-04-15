setcpm(93 / 4)
stack(
  s("bd ~ ~ ~ bd ~ ~ ~").bank("RolandTR808").gain(1.2),
  s("~ ~ sd ~ ~ ~ sd ~").bank("RolandTR808").gain(0.8),
  s("hh*8").bank("RolandTR808").gain(0.25),
  note("<a2 f2 c2 g2>")
    .s("sawtooth").cutoff(400).release(0.4).gain(1.0),
  note("e5 d5 c5 b4 ~ a4 ~ ~ e5 d5 b4 g4 ~ ~ ~")
    .s("sawtooth")
    .cutoff(2000).resonance(4).release(0.09)
    .detune(12).gain(0.65)
    .room(0.6).delay(0.35)
    .delaytime(0.32).delayfeedback(0.35)
)._pianoroll()