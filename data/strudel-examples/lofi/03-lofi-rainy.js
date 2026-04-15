setcpm(70 / 4)

let supersaw = note("c3 e3 g3 b3").s("supersaw")
  .room("<<0.4@3 0.3@2>*2 <1@4 0.8@1>*2>")
  .size(10)
  .delay(1)
  .pan(rand)
  .lpf("<500@2 1000@3>")
  .delayfeedback("<.25 .85>")
  .detune("<.2 .1>")

let rain = s("white@8").cutoff(1800).hpq(1000).gain(.2).room("3").size(10)

let rainDroplets = s("~ white white ~ white ~ ~ white")
  .cutoff(3000)
  .speed(rand.range(1, 2))
  .gain(rand.range(0.1, 0.2))

let kickDrums = s("bd ~ ~ ~bd ~ ~").bank("RolandTR808")
let snareDrum = s("sd sd ~ ~ sd ~").bank("RolandTR808").gain(0.6)
let rim = s("~ ~ ~ rim ~").bank("RolandTR808").gain(0.35)

$: stack(
  rim,
  kickDrums,
  snareDrum,
  supersaw,
  rain,
  // vocals,
).color("#b19cd9")._pianoroll()