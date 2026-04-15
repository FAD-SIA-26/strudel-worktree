// Classic House Groove - Pump Up The Jam Style
// Genre: House | Key: Cm | BPM: 124.5 | Energy: 8/10
// Source: Pump Up The Jam inspired arrangement

setcpm(124.5/4)

stack(
  // Four-on-floor kick
  s("bd*4").bank("RolandTR909").lpf(150).gain(1),

  // Open hats
  s("oh*16").bank("RolandTR909").pan(0.45)
    .gain("[0.08 0.16]*4").release(0),

  // Clap on 2 and 4
  s("[~ cp]*2").bank("RolandTR909").gain(0.5).pan(0.25),

  // Ride for texture
  s("[~ rd]*4").bank("RolandTR909").gain(0.15)
    .release(0).hpf(1500).pan(0.75),

  // House bass
  "[0 ~@23]/2".scale("c2:minor").note().clip(0.9)
    .s("z_sawtooth").lpf(300).lpe(2).gain(1)
).room(0.3)
